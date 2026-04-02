import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusConfigService } from '../bonus/engine/bonus-config.service';
import { ConfigService } from '@nestjs/config';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { generateClaimToken, claimTokenHash } from '../../common/utils/claim-token.util';
import { Prisma } from '@prisma/client';

@Injectable()
export class LotteryService {
  private readonly logger = new Logger(LotteryService.name);

  /** 公开抽奖 claimToken 签名密钥 */
  private readonly claimSecret: string;

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private config: ConfigService,
    private redisCoord: RedisCoordinatorService,
  ) {
    // HC-6: 生产环境强制要求 LOTTERY_CLAIM_SECRET
    const secret = this.config.get<string>('LOTTERY_CLAIM_SECRET');
    const nodeEnv = this.config.get<string>('NODE_ENV');
    if (nodeEnv === 'production' && !secret) {
      throw new Error('生产环境必须配置 LOTTERY_CLAIM_SECRET 环境变量');
    }
    this.claimSecret = secret || 'dev-claim-secret-do-not-use-in-production';
  }

  /** 获取当前中国日期字符串（UTC+8） */
  private getTodayDate(): string {
    const now = new Date();
    // UTC+8 偏移
    const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return chinaTime.toISOString().slice(0, 10);
  }

  /** 抽奖 */
  async draw(userId: string) {
    // 1. 检查抽奖功能开关 & 获取每日抽奖次数配置
    const sysConfig = await this.bonusConfig.getSystemConfig();
    if (!sysConfig.lotteryEnabled) {
      throw new BadRequestException('抽奖功能已关闭');
    }

    const dailyChances = sysConfig.lotteryDailyChances;
    const drawDate = this.getTodayDate();

    // 2. Serializable 事务防并发
    return await this.prisma.$transaction(
      async (tx) => {
        // 3. 查询今日该用户已抽奖次数（事务内检查，防竞态）
        const todayCount = await tx.lotteryRecord.count({
          where: { userId, drawDate },
        });
        if (todayCount >= dailyChances) {
          throw new BadRequestException(
            `今日抽奖次数已用完（${dailyChances}/${dailyChances}）`,
          );
        }

        // 4. 获取所有活跃奖品
        const prizes = await tx.lotteryPrize.findMany({
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        });
        if (prizes.length === 0) {
          throw new BadRequestException('奖池暂未配置');
        }

        // 4b. 强制校验概率总和=100%（保存端已强校验，这里做运行期兜底）
        const probabilitySum = prizes.reduce((sum, p) => sum + p.probability, 0);
        if (Math.abs(probabilitySum - 100) > 0.01) {
          throw new BadRequestException(
            `奖池概率配置异常：总和为 ${probabilitySum}%（需要100%），请联系管理员调整`,
          );
        }

        // 5. 概率加权随机选择
        const rand = Math.random() * 100;
        let cumulative = 0;
        let selectedPrize: (typeof prizes)[number] | null = null;
        for (const prize of prizes) {
          cumulative += prize.probability;
          if (rand < cumulative) {
            selectedPrize = prize;
            break;
          }
        }

        // 概率总和 < 100 时，rand 落在 [cumulative, 100) 区间视为"未中奖"
        if (!selectedPrize) {
          const record = await tx.lotteryRecord.create({
            data: {
              userId,
              drawDate,
              result: 'NO_PRIZE',
              meta: { message: '谢谢参与' },
            },
          });
          return { result: 'NO_PRIZE' as const, record };
        }

        // 6. NO_PRIZE 类型直接创建记录返回
        if (selectedPrize.type === 'NO_PRIZE') {
          const record = await tx.lotteryRecord.create({
            data: {
              userId,
              drawDate,
              result: 'NO_PRIZE',
              meta: { message: '谢谢参与' },
            },
          });
          return { result: 'NO_PRIZE' as const, record };
        }

        // 7. 实物奖品：检查限制
        // 7a. dailyLimit 检查
        if (selectedPrize.dailyLimit !== null) {
          const todayWonCount = await tx.lotteryRecord.count({
            where: {
              prizeId: selectedPrize.id,
              drawDate,
              result: 'WON',
            },
          });
          if (todayWonCount >= selectedPrize.dailyLimit) {
            // 降级为 NO_PRIZE
            const record = await tx.lotteryRecord.create({
              data: {
                userId,
                drawDate,
                result: 'NO_PRIZE',
                meta: { message: '谢谢参与', degradedFrom: selectedPrize.name },
              },
            });
            return { result: 'NO_PRIZE' as const, record };
          }
        }

        // 7b. totalLimit 检查
        if (selectedPrize.totalLimit !== null && selectedPrize.wonCount >= selectedPrize.totalLimit) {
          const record = await tx.lotteryRecord.create({
            data: {
              userId,
              drawDate,
              result: 'NO_PRIZE',
              meta: { message: '谢谢参与', degradedFrom: selectedPrize.name },
            },
          });
          return { result: 'NO_PRIZE' as const, record };
        }

        // 7c. CAS 递增 wonCount（防并发超发）
        const cas = await tx.lotteryPrize.updateMany({
          where: {
            id: selectedPrize.id,
            wonCount: selectedPrize.wonCount, // CAS 条件
          },
          data: {
            wonCount: { increment: 1 },
          },
        });
        if (cas.count === 0) {
          // CAS 失败，说明有并发中奖，降级为 NO_PRIZE
          this.logger.warn(`CAS 失败，奖品 ${selectedPrize.id} wonCount 已变化，降级为未中奖`);
          const record = await tx.lotteryRecord.create({
            data: {
              userId,
              drawDate,
              result: 'NO_PRIZE',
              meta: { message: '谢谢参与', casFailed: true },
            },
          });
          return { result: 'NO_PRIZE' as const, record };
        }

        // F2: 判断是否为门槛赠品；F3: 预计算过期时间（确保 record 和 cartItem 一致）
        const isThresholdGift = selectedPrize.type === 'THRESHOLD_GIFT';
        const expiresAt = selectedPrize.expirationHours
          ? new Date(Date.now() + selectedPrize.expirationHours * 3600 * 1000)
          : null;

        // 8. 创建中奖记录（显式设置 status: WON）
        const record = await tx.lotteryRecord.create({
          data: {
            userId,
            prizeId: selectedPrize.id,
            drawDate,
            result: 'WON',
            status: 'WON', // 显式设置生命周期状态
            meta: {
              prizeName: selectedPrize.name,
              prizeType: selectedPrize.type,
              prizePrice: selectedPrize.prizePrice,
              originalPrice: selectedPrize.originalPrice ?? null,             // 管理员配置的展示划线价
              threshold: selectedPrize.threshold,
              prizeQuantity: selectedPrize.prizeQuantity,
              productId: selectedPrize.productId,
              skuId: selectedPrize.skuId,
              expiresAt: expiresAt ? expiresAt.toISOString() : null,         // F3: 过期时间（用于前端展示和审计）
              expirationHours: selectedPrize.expirationHours ?? null,        // F3: 过期小时数
            },
          },
        });

        // 9. 自动将奖品添加到购物车（仅有关联 SKU 的奖品类型）
        if (selectedPrize.skuId) {
          // 确保用户有购物车
          let cart = await tx.cart.findUnique({ where: { userId } });
          if (!cart) {
            cart = await tx.cart.create({ data: { userId } });
          }

          // F2: THRESHOLD_GIFT 入购物车时锁定；F3: 设置过期时间
          await tx.cartItem.create({
            data: {
              cartId: cart.id,
              skuId: selectedPrize.skuId,
              quantity: selectedPrize.prizeQuantity ?? 1,
              isPrize: true,
              prizeRecordId: record.id,
              isLocked: isThresholdGift,                                     // F2: THRESHOLD_GIFT 默认锁定
              threshold: isThresholdGift ? selectedPrize.threshold : null,   // F2: 缓存门槛
              expiresAt,                                                     // F3: 奖品过期时间
            },
          });

          // 自动加入购物车后，更新 LotteryRecord 状态为 IN_CART
          await tx.lotteryRecord.update({
            where: { id: record.id },
            data: { status: 'IN_CART' },
          });

          this.logger.log(
            `奖品已加入购物车: userId=${userId}, prizeId=${selectedPrize.id}, skuId=${selectedPrize.skuId}, recordId=${record.id}`,
          );
        }

        return {
          result: 'WON' as const,
          record,
          prize: {
            id: selectedPrize.id,
            name: selectedPrize.name,
            type: selectedPrize.type,
            prizePrice: selectedPrize.prizePrice,
            threshold: selectedPrize.threshold,
            prizeQuantity: selectedPrize.prizeQuantity,
          },
          addedToCart: !!selectedPrize.skuId, // 告知前端奖品是否已自动加入购物车
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** 获取今日抽奖状态 */
  async getTodayStatus(userId: string) {
    const drawDate = this.getTodayDate();
    const sysConfig = await this.bonusConfig.getSystemConfig();
    const dailyChances = sysConfig.lotteryDailyChances;

    const records = await this.prisma.lotteryRecord.findMany({
      where: { userId, drawDate },
      orderBy: { createdAt: 'asc' },
      include: {
        prize: {
          select: { id: true, name: true, type: true, prizePrice: true, threshold: true },
        },
      },
    });

    const usedChances = records.length;
    const remainingChances = Math.max(0, dailyChances - usedChances);

    return {
      hasDrawn: usedChances >= dailyChances, // 所有次数是否用完
      usedChances,
      dailyChances,
      remainingChances,
      records, // 返回今日所有记录
    };
  }

  /** 获取奖池列表（转盘展示，不暴露 probability 字段） */
  async getPrizes() {
    const prizes = await this.prisma.lotteryPrize.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        type: true,
        name: true,
        prizePrice: true,
        threshold: true,
        prizeQuantity: true,
        // probability 不返回给用户端，防止概率泄露（M11）
        sortOrder: true,
      },
    });

    return prizes;
  }

  // ==================== B1: 公开抽奖（无需登录） ====================

  /** 公开抽奖 — 设备指纹 + IP 三重限流，中奖返回 claimToken */
  async publicDraw(fingerprint: string, clientIp: string) {
    const drawDate = this.getTodayDate();

    // 1. HC-5: 三重限流（Redis 不可用时拒绝服务，不允许回退）
    await this.enforcePublicDrawRateLimits(fingerprint, clientIp, drawDate);

    // 2. 检查抽奖功能开关
    const sysConfig = await this.bonusConfig.getSystemConfig();
    if (!sysConfig.lotteryEnabled) {
      throw new BadRequestException('抽奖功能已关闭');
    }

    // 3. 获取所有活跃奖品
    const prizes = await this.prisma.lotteryPrize.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (prizes.length === 0) {
      throw new BadRequestException('奖池暂未配置');
    }

    // 4. 强制校验概率总和=100%
    const probabilitySum = prizes.reduce((sum, p) => sum + p.probability, 0);
    if (Math.abs(probabilitySum - 100) > 0.01) {
      throw new BadRequestException(
        `奖池概率配置异常：总和为 ${probabilitySum}%（需要100%），请联系管理员调整`,
      );
    }

    // 5. 概率加权随机选择
    const rand = Math.random() * 100;
    let cumulative = 0;
    let selectedPrize: (typeof prizes)[number] | null = null;
    for (const prize of prizes) {
      cumulative += prize.probability;
      if (rand < cumulative) {
        selectedPrize = prize;
        break;
      }
    }

    // 未命中任何奖品 或 NO_PRIZE 类型
    if (!selectedPrize || selectedPrize.type === 'NO_PRIZE') {
      this.logger.log(JSON.stringify({
        action: 'public_draw',
        fp: fingerprint.slice(0, 8) + '...',
        ip: clientIp,
        result: 'NO_PRIZE',
      }));
      return { result: 'NO_PRIZE' as const };
    }

    // 6. dailyLimit 检查（事务外查询，公开抽奖无 userId）
    if (selectedPrize.dailyLimit !== null) {
      const todayWonCount = await this.prisma.lotteryRecord.count({
        where: {
          prizeId: selectedPrize.id,
          drawDate,
          result: 'WON',
        },
      });
      if (todayWonCount >= selectedPrize.dailyLimit) {
        this.logger.log(JSON.stringify({
          action: 'public_draw',
          fp: fingerprint.slice(0, 8) + '...',
          ip: clientIp,
          result: 'NO_PRIZE',
          prizeId: selectedPrize.id,
          reason: 'dailyLimit_exceeded',
        }));
        return { result: 'NO_PRIZE' as const };
      }
    }

    // 7. totalLimit 检查
    if (selectedPrize.totalLimit !== null && selectedPrize.wonCount >= selectedPrize.totalLimit) {
      this.logger.log(JSON.stringify({
        action: 'public_draw',
        fp: fingerprint.slice(0, 8) + '...',
        ip: clientIp,
        result: 'NO_PRIZE',
        prizeId: selectedPrize.id,
        reason: 'totalLimit_exceeded',
      }));
      return { result: 'NO_PRIZE' as const };
    }

    // 8. CAS 递增 wonCount（Serializable 事务防并发超发）
    const casResult = await this.prisma.$transaction(
      async (tx) => {
        const cas = await tx.lotteryPrize.updateMany({
          where: {
            id: selectedPrize!.id,
            wonCount: selectedPrize!.wonCount, // CAS 条件
          },
          data: {
            wonCount: { increment: 1 },
          },
        });
        return cas.count;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (casResult === 0) {
      // CAS 失败，说明有并发中奖，降级为 NO_PRIZE
      this.logger.warn(JSON.stringify({
        action: 'public_draw',
        fp: fingerprint.slice(0, 8) + '...',
        ip: clientIp,
        result: 'NO_PRIZE',
        prizeId: selectedPrize.id,
        reason: 'cas_failed',
      }));
      return { result: 'NO_PRIZE' as const };
    }

    // 9. 中奖：生成 claimToken 并缓存奖品元数据到 Redis
    const claimExpiresAt = selectedPrize.expirationHours
      ? new Date(Date.now() + selectedPrize.expirationHours * 3600 * 1000)
      : null;
    const token = generateClaimToken(
      {
        fp: fingerprint,
        prizeId: selectedPrize.id,
        drawDate,
        ts: Date.now(),
      },
      this.claimSecret,
    );
    const hash = claimTokenHash(token);

    // 存储奖品元数据到 Redis，TTL 24 小时
    const stored = await this.redisCoord.set(
      'lottery:claim:' + hash,
      JSON.stringify({
        prizeId: selectedPrize.id,
        prizeType: selectedPrize.type,
        prizePrice: selectedPrize.prizePrice,
        originalPrice: selectedPrize.originalPrice ?? null,
        skuId: selectedPrize.skuId,
        threshold: selectedPrize.threshold,
        prizeQuantity: selectedPrize.prizeQuantity,
        expirationHours: selectedPrize.expirationHours,
        expiresAt: claimExpiresAt ? claimExpiresAt.toISOString() : null,
      }),
      24 * 60 * 60 * 1000,
    );
    if (!stored) {
      // Redis 写入失败，回退 wonCount 并降级为未中奖
      this.logger.error(JSON.stringify({
        action: 'public_draw',
        reason: 'redis_store_failed',
        fp: fingerprint.slice(0, 8) + '...',
        prizeId: selectedPrize.id,
        claimTokenHash: hash,
      }));
      await this.prisma.lotteryPrize.update({
        where: { id: selectedPrize.id },
        data: { wonCount: { decrement: 1 } },
      });
      return { result: 'NO_PRIZE' as const };
    }

    // HC-7: 结构化日志
    this.logger.log(JSON.stringify({
      action: 'public_draw',
      fp: fingerprint.slice(0, 8) + '...',
      ip: clientIp,
      result: 'WON',
      prizeId: selectedPrize.id,
    }));

    // 使用管理员配置的 originalPrice，回退到 SKU 原价
    let displayOriginalPrice: number | null = selectedPrize.originalPrice ?? null;
    if (displayOriginalPrice === null && selectedPrize.skuId) {
      const sku = await this.prisma.productSKU.findUnique({
        where: { id: selectedPrize.skuId },
        select: { price: true },
      });
      displayOriginalPrice = sku?.price ?? null;
    }

    return {
      result: 'WON' as const,
      prize: {
        id: selectedPrize.id,
        name: selectedPrize.name,
        type: selectedPrize.type,
        prizePrice: selectedPrize.prizePrice,
        threshold: selectedPrize.threshold,
        prizeQuantity: selectedPrize.prizeQuantity,
        expirationHours: selectedPrize.expirationHours,
        originalPrice: displayOriginalPrice,
        expiresAt: claimExpiresAt ? claimExpiresAt.toISOString() : null,
      },
      claimToken: token,
    };
  }

  /** HC-5: 公开抽奖三重限流
   *  顺序：先检查 IP 限流（高配额、误消耗成本低），最后消耗 fp_daily（1次/天，不可浪费） */
  private async enforcePublicDrawRateLimits(
    fingerprint: string,
    clientIp: string,
    drawDate: string,
  ): Promise<void> {
    // 限流 1: 每 IP 每分钟 5 次（最先检查，配额最大、恢复最快）
    const ipMinResult = await this.redisCoord.consumeFixedWindow(
      `lottery:ip:${clientIp}:min`,
      5,
      60,
    );
    if (ipMinResult === null) {
      throw new BadRequestException('抽奖服务暂不可用');
    }
    if (!ipMinResult.allowed) {
      this.logger.warn(JSON.stringify({
        action: 'public_draw_rejected',
        reason: 'rate_limit',
        limitType: 'ip_minute',
        fp: fingerprint.slice(0, 8) + '...',
        ip: clientIp,
      }));
      throw new BadRequestException('操作过于频繁，请稍后再试');
    }

    // 限流 2: 每 IP 每天 50 次
    const ipDailyResult = await this.redisCoord.consumeFixedWindow(
      `lottery:ip:${clientIp}:${drawDate}`,
      50,
      24 * 60 * 60,
    );
    if (ipDailyResult === null) {
      throw new BadRequestException('抽奖服务暂不可用');
    }
    if (!ipDailyResult.allowed) {
      this.logger.warn(JSON.stringify({
        action: 'public_draw_rejected',
        reason: 'rate_limit',
        limitType: 'ip_daily',
        fp: fingerprint.slice(0, 8) + '...',
        ip: clientIp,
      }));
      throw new BadRequestException('当前网络抽奖次数已达上限，请稍后再试');
    }

    // 限流 3: 每设备每天 1 次（最后消耗，配额最珍贵）
    const fpResult = await this.redisCoord.consumeFixedWindow(
      `lottery:fp:${fingerprint}:${drawDate}`,
      1,
      24 * 60 * 60, // 24 小时 TTL
    );
    if (fpResult === null) {
      throw new BadRequestException('抽奖服务暂不可用');
    }
    if (!fpResult.allowed) {
      this.logger.warn(JSON.stringify({
        action: 'public_draw_rejected',
        reason: 'rate_limit',
        limitType: 'fp_daily',
        fp: fingerprint.slice(0, 8) + '...',
        ip: clientIp,
      }));
      throw new BadRequestException('今日抽奖次数已用完');
    }
  }

  // ==================== B2: 公开今日抽奖状态 ====================

  /** 获取公开今日抽奖状态（无需登录，基于设备指纹） */
  async getPublicTodayStatus(fingerprint: string) {
    // 无指纹时返回默认状态
    if (!fingerprint) {
      return { hasDrawn: false, remainingDraws: 1 };
    }

    const drawDate = this.getTodayDate();

    // 直接读取 Redis 计数器（不递增），避免查询状态消耗抽奖次数
    const countStr = await this.redisCoord.get(`lottery:fp:${fingerprint}:${drawDate}`);

    // Redis 不可用时返回默认状态
    if (countStr === null) {
      return { hasDrawn: false, remainingDraws: 1 };
    }

    const count = parseInt(countStr, 10) || 0;
    return {
      hasDrawn: count >= 1,
      remainingDraws: Math.max(0, 1 - count),
    };
  }
}
