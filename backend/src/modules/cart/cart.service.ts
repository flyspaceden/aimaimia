import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { verifyClaimToken, claimTokenHash } from '../../common/utils/claim-token.util';
import { BonusConfigService } from '../bonus/engine/bonus-config.service';
import { MergeCartItemDto } from './dto/cart.dto';

type MergeResultStatus =
  | 'MERGED'
  | 'REJECTED_ALREADY_DRAWN_TODAY'
  | 'REJECTED_TOKEN_INVALID'
  | 'REJECTED_TOKEN_EXPIRED'
  | 'REJECTED_TOKEN_USED'
  | 'REJECTED_PRIZE_INACTIVE'
  | 'REJECTED_CLAIM_PROCESSING'
  | 'REJECTED_ITEM_INVALID'
  | 'FAILED';

type MergeResultItem = {
  localKey?: string;
  skuId: string;
  isPrize: boolean;
  status: MergeResultStatus;
  message?: string;
};

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);
  private readonly claimSecret: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private redisCoord: RedisCoordinatorService,
    private bonusConfig: BonusConfigService,
  ) {
    // HC-6: 生产环境强制要求 LOTTERY_CLAIM_SECRET
    const secret = this.config.get<string>('LOTTERY_CLAIM_SECRET');
    const nodeEnv = this.config.get<string>('NODE_ENV');
    if (nodeEnv === 'production' && !secret) {
      throw new Error('生产环境必须配置 LOTTERY_CLAIM_SECRET 环境变量');
    }
    this.claimSecret = secret || 'dev-claim-secret-do-not-use-in-production';
  }

  private buildMergeResult(
    item: MergeCartItemDto,
    status: MergeResultStatus,
    message?: string,
  ): MergeResultItem {
    return {
      localKey: item.localKey,
      skuId: item.skuId,
      isPrize: !!item.isPrize,
      status,
      message,
    };
  }

  private classifyMergeError(item: MergeCartItemDto, message?: string): MergeResultItem {
    if (!item.isPrize) {
      return this.buildMergeResult(item, 'FAILED', message ?? '商品合并失败');
    }
    if (message?.includes('今日抽奖次数已达上限')) {
      return this.buildMergeResult(item, 'REJECTED_ALREADY_DRAWN_TODAY', message);
    }
    if (message?.includes('奖品凭证无效')) {
      return this.buildMergeResult(item, 'REJECTED_TOKEN_INVALID', message);
    }
    if (message?.includes('奖品凭证已过期')) {
      return this.buildMergeResult(item, 'REJECTED_TOKEN_EXPIRED', message);
    }
    if (message?.includes('奖品凭证已使用')) {
      return this.buildMergeResult(item, 'REJECTED_TOKEN_USED', message);
    }
    if (message?.includes('奖品已失效')) {
      return this.buildMergeResult(item, 'REJECTED_PRIZE_INACTIVE', message);
    }
    if (message?.includes('奖品凭证正在处理中')) {
      return this.buildMergeResult(item, 'REJECTED_CLAIM_PROCESSING', message);
    }
    return this.buildMergeResult(item, 'FAILED', message ?? '奖品合并失败');
  }

  /** 获取购物车（含商品信息） */
  async getCart(userId: string) {
    const cart = await this.ensureCart(userId);

    // F3: 每次获取购物车前先清理过期奖品项
    await this.cleanExpiredPrizeItems(cart.id);

    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
        sku: {
          include: {
            product: {
              include: {
                media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1 },
              },
            },
          },
        },
      },
    });

    // 收集所有奖品项的 prizeRecordId，批量查询对应的 LotteryRecord
    const prizeRecordIds = items
      .filter((item) => item.isPrize && item.prizeRecordId)
      .map((item) => item.prizeRecordId as string);

    let prizeRecordMap: Map<string, any> = new Map();
    if (prizeRecordIds.length > 0) {
      const records = await this.prisma.lotteryRecord.findMany({
        where: { id: { in: prizeRecordIds } },
        include: { prize: true },
      });
      for (const record of records) {
        prizeRecordMap.set(record.id, record);
      }
    }

    // F2: 计算选中非奖品商品总额（用于赠品解锁判定）
    const mappedItems = items.map((item) => this.mapCartItem(item, prizeRecordMap));
    const selectedNonPrizeTotal = items
      .filter((item) => !item.isPrize && item.isSelected)
      .reduce((sum, item) => {
        const sku = item.sku;
        return sum + (sku?.price || 0) * item.quantity;
      }, 0);

    // F2: 计算每个锁定赠品的解锁差额
    const lockedGiftsInfo = mappedItems
      .filter((mi) => mi.isPrize && mi.isLocked && mi.threshold != null)
      .map((mi) => ({
        cartItemId: mi.id,
        threshold: mi.threshold,
        deficit: Math.max(0, (mi.threshold || 0) - selectedNonPrizeTotal),
        unlocked: selectedNonPrizeTotal >= (mi.threshold || 0),
      }));

    // 给每个锁定赠品标注 unlockDeficit
    for (const mi of mappedItems) {
      const info = lockedGiftsInfo.find((g) => g.cartItemId === mi.id);
      (mi as any).unlockDeficit = info ? info.deficit : null;
    }

    return {
      id: cart.id,
      items: mappedItems,
      selectedTotal: selectedNonPrizeTotal,
      lockedGiftsInfo,
    };
  }

  /** 添加商品到购物车（事务保护防并发重复行） */
  async addItem(userId: string, skuId: string, quantity: number) {
    if (quantity <= 0) throw new BadRequestException('数量必须大于 0');

    // 验证 SKU 存在且有货
    const sku = await this.prisma.productSKU.findUnique({
      where: { id: skuId },
      include: { product: true },
    });
    if (!sku) throw new NotFoundException('商品规格不存在');
    if (sku.status !== 'ACTIVE') throw new BadRequestException('该规格已下架');
    if (sku.product.status !== 'ACTIVE') throw new BadRequestException('商品已下架');

    // 单笔限购校验（放在事务外做初步检查，事务内做精确检查）
    if (sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
      throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
    }

    const cart = await this.ensureCart(userId);

    // 事务内查+写，防止并发请求创建重复普通商品行
    // 若并发触发唯一索引冲突（P2002），自动重试一次（第二次会走 update 分支）
    const MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.cartItem.findFirst({
            where: { cartId: cart.id, skuId, isPrize: false },
          });

          if (existing) {
            const newQty = existing.quantity + quantity;
            if (sku.maxPerOrder !== null && newQty > sku.maxPerOrder) {
              throw new BadRequestException(
                `该商品每单限购 ${sku.maxPerOrder} 件，购物车已有 ${existing.quantity} 件`,
              );
            }
            if (newQty > sku.stock) throw new BadRequestException('库存不足');

            await tx.cartItem.update({
              where: { id: existing.id },
              data: { quantity: newQty },
            });
          } else {
            if (sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
              throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
            }
            if (quantity > sku.stock) throw new BadRequestException('库存不足');

            await tx.cartItem.create({
              data: { cartId: cart.id, skuId, quantity },
            });
          }
        });
        break; // 成功，退出重试循环
      } catch (error) {
        // 唯一索引冲突 = 并发加购同一 SKU，重试即可（第二次 findFirst 能找到）
        if (
          attempt < MAX_RETRIES &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    return this.getCart(userId);
  }

  /** 更新购物车项数量 */
  async updateItemQuantity(userId: string, skuId: string, quantity: number) {
    if (quantity <= 0) throw new BadRequestException('数量必须大于 0');

    const cart = await this.ensureCart(userId);

    const item = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, skuId, isPrize: false },
    });
    if (!item) throw new NotFoundException('购物车中没有该商品');

    const sku = await this.prisma.productSKU.findUnique({ where: { id: skuId } });
    if (sku && quantity > sku.stock) throw new BadRequestException('库存不足');
    if (sku && sku.maxPerOrder !== null && quantity > sku.maxPerOrder) {
      throw new BadRequestException(`该商品每单限购 ${sku.maxPerOrder} 件`);
    }

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity },
    });

    return this.getCart(userId);
  }

  /** 删除购物车项（普通商品按 skuId 删除） */
  async removeItem(userId: string, skuId: string) {
    const cart = await this.ensureCart(userId);

    const item = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, skuId, isPrize: false },
    });
    if (!item) throw new NotFoundException('购物车中没有该商品');

    await this.prisma.cartItem.delete({ where: { id: item.id } });

    return this.getCart(userId);
  }

  /** 删除购物车奖品项（按 cartItemId 删除）
   *  同时将关联的 LotteryRecord 状态从 IN_CART 恢复为 WON */
  async removePrizeItem(userId: string, cartItemId: string) {
    const cart = await this.ensureCart(userId);

    const item = await this.prisma.cartItem.findFirst({
      where: { id: cartItemId, cartId: cart.id, isPrize: true },
    });
    if (!item) throw new NotFoundException('购物车中没有该奖品');

    // F2: 锁定的赠品禁止删除
    if (item.isLocked) {
      throw new BadRequestException('锁定赠品不可删除，消费满 ¥' + (item.threshold || 0) + ' 后自动解锁');
    }

    // 事务内同时删除购物车项并恢复 LotteryRecord 状态
    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.delete({ where: { id: item.id } });

      // 恢复 LotteryRecord 状态为 WON（仅当前状态为 IN_CART 时才恢复，防止覆盖 EXPIRED/CONSUMED）
      if (item.prizeRecordId) {
        await tx.lotteryRecord.updateMany({
          where: { id: item.prizeRecordId, status: 'IN_CART' },
          data: { status: 'WON' },
        });
      }
    });

    return this.getCart(userId);
  }

  /** 清空购物车
   *  F2: 锁定赠品保留不删，其余全部清除
   *  同时将非锁定奖品项关联的 LotteryRecord 状态从 IN_CART 恢复为 WON */
  async clearCart(userId: string) {
    const cart = await this.ensureCart(userId);

    // F2: 查询非锁定的奖品项，用于恢复 LotteryRecord 状态
    const prizeItems = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id, isPrize: true, isLocked: false },
      select: { prizeRecordId: true },
    });
    const prizeRecordIds = prizeItems
      .map((item) => item.prizeRecordId)
      .filter((id): id is string => !!id);

    await this.prisma.$transaction(async (tx) => {
      // F2: 只删除非锁定的购物车项（锁定赠品保留）
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id, isLocked: false },
      });

      // 批量恢复 LotteryRecord 状态（仅 IN_CART → WON）
      if (prizeRecordIds.length > 0) {
        await tx.lotteryRecord.updateMany({
          where: { id: { in: prizeRecordIds }, status: 'IN_CART' },
          data: { status: 'WON' },
        });
      }
    });

    return this.getCart(userId);
  }

  /** F2: 勾选/取消勾选购物车商品 */
  async toggleSelect(userId: string, skuId: string, isSelected: boolean) {
    const cart = await this.ensureCart(userId);

    const item = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, skuId, isPrize: false },
    });
    if (!item) throw new NotFoundException('购物车中没有该商品');

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { isSelected },
    });

    return this.getCart(userId);
  }

  /** 购物车合并（登录后同步本地购物车到服务端）
   *  普通商品：验证 SKU 有效后合并数量
   *  奖品商品：验证 claimToken 签名 + Redis claim 数据，两阶段提交 */
  async mergeItems(
    userId: string,
    items: MergeCartItemDto[],
    idempotencyKey?: string,
  ) {
    // HC-3: 幂等性检查（SET NX 原子占位，防并发请求同时 miss cache）
    const idempotencyRedisKey = idempotencyKey
      ? `cart:merge:idempotency:${userId}:${idempotencyKey}`
      : null;
    if (idempotencyRedisKey) {
      // 先尝试读取已完成的结果
      const cached = await this.redisCoord.get(idempotencyRedisKey);
      if (cached && cached !== '__processing__') {
        return JSON.parse(cached);
      }
      // 原子占位：SET NX，防止并发请求同时通过
      // acquireLock 返回: true=获得锁, false=被占, null=Redis不可用
      const acquired = await this.redisCoord.acquireLock(
        idempotencyRedisKey, '__processing__', 60 * 1000,
      );
      if (acquired === false) {
        // 另一个请求正在处理，短暂等待后返回结果
        await new Promise((r) => setTimeout(r, 500));
        const retryCache = await this.redisCoord.get(idempotencyRedisKey);
        if (retryCache && retryCache !== '__processing__') {
          return JSON.parse(retryCache);
        }
        // 仍在处理中，返回当前购物车状态（不重复执行）
        return this.getCart(userId);
      }
      // acquired === null (Redis 不可用): 跳过幂等保护，继续执行合并
    }

    const errors: string[] = [];
    const mergeResults: MergeResultItem[] = [];
    for (const item of items) {
      try {
        if (!item.isPrize) {
          // ===== 普通商品合并 =====
          const normalMerged = await this.mergeNormalItem(userId, item);
          mergeResults.push(
            this.buildMergeResult(
              item,
              normalMerged ? 'MERGED' : 'REJECTED_ITEM_INVALID',
              normalMerged ? undefined : '商品不存在或已下架',
            ),
          );
        } else {
          // ===== 奖品商品合并 =====
          await this.mergePrizeItem(userId, item);
          mergeResults.push(this.buildMergeResult(item, 'MERGED'));
        }
      } catch (err: any) {
        // 单项失败不阻断整个合并流程，记录错误继续处理后续项
        const message = err?.message ?? '合并失败';
        this.logger.warn(JSON.stringify({
          action: 'cart_merge_item_failed',
          userId,
          skuId: item.skuId,
          isPrize: item.isPrize,
          error: message,
        }));
        errors.push(`${item.skuId}: ${message}`);
        mergeResults.push(this.classifyMergeError(item, message));
      }
    }

    // 获取最终购物车状态
    const cart = await this.getCart(userId);

    // 附加合并错误信息（如果有），让调用方知道哪些项失败
    const result = {
      ...cart,
      ...(errors.length > 0 ? { mergeErrors: errors } : {}),
      mergeResults,
    };

    // HC-3: 缓存幂等结果（覆盖 __processing__ 占位值）
    if (idempotencyRedisKey) {
      await this.redisCoord.set(idempotencyRedisKey, JSON.stringify(result), 60 * 1000);
    }

    // HC-7: 结构化日志
    const prizeCount = items.filter((i) => i.isPrize).length;
    this.logger.log(
      JSON.stringify({
        action: 'cart_merge',
        userId,
        itemCount: items.length,
        prizeCount,
        errorCount: errors.length,
        idempotencyKey: idempotencyKey || null,
      }),
    );

    return result;
  }

  /** 合并普通商品到购物车 */
  private async mergeNormalItem(userId: string, item: MergeCartItemDto): Promise<boolean> {
    // 验证 SKU 存在且有效
    const sku = await this.prisma.productSKU.findUnique({
      where: { id: item.skuId },
      include: { product: true },
    });
    if (!sku) {
      this.logger.warn(
        JSON.stringify({
          action: 'cart_merge_rejected',
          reason: 'sku_not_found',
          userId,
          skuId: item.skuId,
        }),
      );
      return false; // 跳过无效 SKU，不阻断整个合并流程
    }
    if (sku.status !== 'ACTIVE' || sku.product.status !== 'ACTIVE') {
      this.logger.warn(
        JSON.stringify({
          action: 'cart_merge_rejected',
          reason: 'sku_inactive',
          userId,
          skuId: item.skuId,
        }),
      );
      return false; // 跳过已下架商品
    }

    const cart = await this.ensureCart(userId);

    // 事务内查+写，防止并发重复行
    const MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.cartItem.findFirst({
            where: { cartId: cart.id, skuId: item.skuId, isPrize: false },
          });

          if (existing) {
            const newQty = existing.quantity + item.quantity;
            await tx.cartItem.update({
              where: { id: existing.id },
              data: { quantity: newQty },
            });
          } else {
            await tx.cartItem.create({
              data: { cartId: cart.id, skuId: item.skuId, quantity: item.quantity },
            });
          }
        });
        break;
      } catch (error) {
        if (
          attempt < MAX_RETRIES &&
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
    return true;
  }

  /** 合并奖品商品到购物车（两阶段 claimToken 消费） */
  private async mergePrizeItem(userId: string, item: MergeCartItemDto) {
    // 必须携带 claimToken
    if (!item.claimToken) {
      throw new BadRequestException('奖品商品必须携带 claimToken');
    }

    // 验证 claimToken 签名
    const payload = verifyClaimToken(item.claimToken, this.claimSecret);
    if (!payload) {
      this.logger.warn(
        JSON.stringify({
          action: 'cart_merge_rejected',
          reason: 'invalid_claim_token',
          userId,
          claimTokenHash: claimTokenHash(item.claimToken),
        }),
      );
      throw new BadRequestException('奖品凭证无效');
    }

    // 验证 drawDate：必须是今天或昨天（UTC+8）
    const todayDate = this.getTodayDateUTC8();
    const yesterdayDate = this.getYesterdayDateUTC8();
    if (payload.drawDate !== todayDate && payload.drawDate !== yesterdayDate) {
      const hash = claimTokenHash(item.claimToken);
      this.logger.warn(
        JSON.stringify({
          action: 'cart_merge_rejected',
          reason: 'expired_claim',
          userId,
          claimTokenHash: hash,
          drawDate: payload.drawDate,
          validRange: [yesterdayDate, todayDate],
        }),
      );
      throw new BadRequestException('奖品凭证已过期');
    }

    const hash = claimTokenHash(item.claimToken);

    // Phase A — 锁定 claimToken
    const lockKey = `lottery:claim:${hash}:lock`;
    const locked = await this.redisCoord.acquireLock(lockKey, 'merge', 5 * 60 * 1000); // 5 分钟 TTL
    if (!locked) {
      this.logger.warn(
        JSON.stringify({
          action: 'cart_merge_rejected',
          reason: 'claim_lock_contention',
          userId,
          claimTokenHash: hash,
        }),
      );
      throw new BadRequestException('奖品凭证正在处理中，请稍后重试');
    }

    // 从 Redis 读取 claim 数据
    const claimDataStr = await this.redisCoord.get(`lottery:claim:${hash}`);
    if (!claimDataStr) {
      await this.redisCoord.releaseLock(lockKey, 'merge');
      this.logger.warn(
        JSON.stringify({
          action: 'cart_merge_rejected',
          reason: 'claim_consumed',
          userId,
          claimTokenHash: hash,
        }),
      );
      throw new BadRequestException('奖品凭证已使用或已过期');
    }
    const claimData = JSON.parse(claimDataStr);

    // 验证奖品有效性
    const prize = await this.prisma.lotteryPrize.findUnique({
      where: { id: claimData.prizeId },
    });
    if (!prize || !prize.isActive) {
      await this.redisCoord.releaseLock(lockKey, 'merge');
      this.logger.warn(
        JSON.stringify({
          action: 'cart_merge_rejected',
          reason: 'prize_inactive',
          userId,
          claimTokenHash: hash,
          prizeId: claimData.prizeId,
        }),
      );
      throw new BadRequestException('奖品已失效');
    }

    // Phase B — DB 事务（Serializable 隔离级别）
    const isThresholdGift = claimData.prizeType === 'THRESHOLD_GIFT';
    const expiresAt = claimData.expiresAt
      ? new Date(claimData.expiresAt)
      : claimData.expirationHours
        ? new Date(Date.now() + claimData.expirationHours * 3600 * 1000)
        : null;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // 账号维度裁决：认领奖品时检查“该账号今天是否已经抽奖”
          const sysConfig = await this.bonusConfig.getSystemConfig();
          const dailyChances = sysConfig.lotteryDailyChances;
          const todayDrawCount = await tx.lotteryRecord.count({
            where: { userId, drawDate: todayDate },
          });
          if (todayDrawCount >= dailyChances) {
            this.logger.warn(JSON.stringify({
              action: 'cart_merge_rejected',
              reason: 'daily_lottery_limit_exceeded',
              userId,
              claimTokenHash: hash,
              todayDrawCount,
              dailyChances,
              currentDrawDate: todayDate,
              originalAnonymousDrawDate: payload.drawDate,
            }));
            throw new BadRequestException('今日抽奖次数已达上限，公开抽奖奖品无法领取');
          }

          // DB 级去重：检查是否已存在该 claimToken 对应的 LotteryRecord
          // 防止 Redis del 之前崩溃导致的重复消费
          const existingRecord = await tx.lotteryRecord.findFirst({
            where: {
              userId,
              prizeId: claimData.prizeId,
              drawDate: todayDate,
              meta: { path: ['claimTokenHash'], equals: hash },
            },
          });
          if (existingRecord) {
            this.logger.log(JSON.stringify({
              action: 'cart_merge_prize_dedup',
              userId,
              claimTokenHash: hash,
              existingRecordId: existingRecord.id,
            }));
            return; // 已消费过，跳过（幂等）
          }

          const cart = await this.ensureCartInTx(tx, userId);

          // 补建 LotteryRecord（含 claimTokenHash 用于去重）
          const record = await tx.lotteryRecord.create({
            data: {
              userId,
              prizeId: claimData.prizeId,
              drawDate: todayDate,
              result: 'WON',
              status: 'IN_CART',
              meta: {
                prizeName: prize.name,
                prizeType: claimData.prizeType,
                prizePrice: claimData.prizePrice ?? claimData.originalPrice,
                originalPrice: claimData.originalPrice ?? null,
                threshold: claimData.threshold,
                prizeQuantity: claimData.prizeQuantity,
                expiresAt: expiresAt ? expiresAt.toISOString() : null,
                expirationHours: claimData.expirationHours ?? null,
                claimedViaPublicDraw: true,
                deviceFingerprint: payload.fp,
                anonymousDrawDate: payload.drawDate,
                claimedAtDrawDate: todayDate,
                claimTokenHash: hash,
              },
            },
          });

          // 创建 CartItem
          await tx.cartItem.create({
            data: {
              cartId: cart.id,
              skuId: claimData.skuId,
              quantity: claimData.prizeQuantity ?? 1,
              isPrize: true,
              prizeRecordId: record.id,
              isLocked: isThresholdGift,
              threshold: isThresholdGift ? claimData.threshold : null,
              expiresAt,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // Phase C — 确认：删除 claim 数据和锁
      await this.redisCoord.del(`lottery:claim:${hash}`, lockKey);
    } catch (err: any) {
      // 每日限额超限：清除 claim 数据（不可重试，奖品作废）
      const isDailyLimitError = err?.message?.includes('今日抽奖次数已达上限');
      try {
        if (isDailyLimitError) {
          await this.redisCoord.del(`lottery:claim:${hash}`, lockKey);
        } else {
          // Phase C — 回滚：释放锁，保留 claim 数据供重试
          await this.redisCoord.releaseLock(lockKey, 'merge');
        }
      } catch (lockErr: any) {
        this.logger.warn(JSON.stringify({
          action: 'cart_merge_lock_release_failed',
          userId,
          claimTokenHash: hash,
          error: lockErr?.message,
        }));
        // 锁释放失败不阻断，5 分钟 TTL 后自动过期
      }
      throw err;
    }
  }

  /** 获取当前中国日期字符串（UTC+8） */
  private getTodayDateUTC8(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  /** 获取昨天中国日期字符串（UTC+8） */
  private getYesterdayDateUTC8(): string {
    return new Date(Date.now() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  /** 事务内确保用户有购物车 */
  private async ensureCartInTx(tx: any, userId: string) {
    let cart = await tx.cart.findUnique({ where: { userId } });
    if (!cart) {
      cart = await tx.cart.create({ data: { userId } });
    }
    return cart;
  }

  /** F3: 清理用户购物车中已过期的奖品项，并更新 LotteryRecord 状态 → EXPIRED */
  private async cleanExpiredPrizeItems(cartId: string): Promise<void> {
    const now = new Date();
    // 查找已过期的奖品项
    const expired = await this.prisma.cartItem.findMany({
      where: {
        cartId,
        isPrize: true,
        expiresAt: { not: null, lt: now },
      },
      select: { id: true, prizeRecordId: true },
    });
    if (expired.length === 0) return;

    const ids = expired.map(e => e.id);
    const prizeRecordIds = expired
      .map(e => e.prizeRecordId)
      .filter((id): id is string => !!id);

    await this.prisma.$transaction(async (tx) => {
      // 删除过期购物车项
      await tx.cartItem.deleteMany({ where: { id: { in: ids } } });
      // 更新 LotteryRecord 状态 → EXPIRED（仅从 IN_CART 转移）
      if (prizeRecordIds.length > 0) {
        await tx.lotteryRecord.updateMany({
          where: { id: { in: prizeRecordIds }, status: 'IN_CART' },
          data: { status: 'EXPIRED' },
        });
      }
    });
  }

  /** 确保用户有购物车，没有则自动创建 */
  private async ensureCart(userId: string) {
    let cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      cart = await this.prisma.cart.create({ data: { userId } });
    }
    return cart;
  }

  /** 映射购物车项（嵌套 product 结构，与前端 ServerCartItem 对齐）
   *  奖品项返回 prizePrice（用户实际支付价）和 originalPrice（SKU 原价，用于划线展示） */
  private mapCartItem(item: any, prizeRecordMap?: Map<string, any>) {
    const sku = item.sku;
    const product = sku?.product;
    const firstImage = product?.media?.[0]?.url || '';
    const skuPrice = sku?.price || 0;

    // 判断是否为奖品项，若是则从 LotteryRecord 获取奖品价格
    let price = skuPrice;
    let originalPrice: number | null = null;
    let prizeType: string | null = null;

    if (item.isPrize && item.prizeRecordId && prizeRecordMap) {
      const record = prizeRecordMap.get(item.prizeRecordId);
      // M1: 仅 WON/IN_CART 状态的奖品显示特价，EXPIRED/CONSUMED 回退到 SKU 原价
      const validPrizeStatuses = ['WON', 'IN_CART'];
      if (record && validPrizeStatuses.includes(record.status)) {
        // 优先从 LotteryRecord.meta 获取奖品价格（快照数据，不受后续配置变更影响）
        const meta = record.meta as any;
        if (meta?.prizePrice !== undefined && meta.prizePrice !== null) {
          price = meta.prizePrice;
          // 优先使用管理员配置的 originalPrice，回退到 SKU 原价
          originalPrice = meta.originalPrice ?? skuPrice;
          prizeType = meta.prizeType || null;
        } else if (record.prize?.prizePrice !== undefined && record.prize.prizePrice !== null) {
          // 回退：从关联的 LotteryPrize 配置读取
          price = record.prize.prizePrice;
          originalPrice = (record.prize as any).originalPrice ?? skuPrice;
          prizeType = record.prize.type || null;
        }
      }
    }

    return {
      id: item.id,
      skuId: item.skuId,
      quantity: item.quantity,
      isPrize: item.isPrize || false,
      prizeRecordId: item.prizeRecordId || null,
      prizeType,
      isLocked: item.isLocked || false,
      threshold: item.threshold || null,
      isSelected: item.isSelected ?? true,
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
      product: {
        id: product?.id || '',
        title: product?.title || '',
        image: firstImage || null,
        price,
        originalPrice, // 奖品项为 SKU 原价（前端划线展示），普通商品项为 null
        stock: sku?.stock || 0,
        maxPerOrder: sku?.maxPerOrder ?? null,
        categoryId: product?.categoryId || null,
        companyId: product?.companyId || null,
      },
    };
  }
}
