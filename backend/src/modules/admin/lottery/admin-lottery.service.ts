import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { LotteryPrizeType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { PLATFORM_COMPANY_ID } from '../../bonus/engine/constants';
import {
  CreateLotteryPrizeDto,
  UpdateLotteryPrizeDto,
} from './admin-lottery.dto';

@Injectable()
export class AdminLotteryService {
  private readonly logger = new Logger(AdminLotteryService.name);

  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
  ) {}

  /** 奖品列表（分页） */
  async findPrizes(page = 1, pageSize = 20, type?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      this.prisma.lotteryPrize.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { sortOrder: 'asc' },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              media: {
                where: { type: 'IMAGE' },
                orderBy: { sortOrder: 'asc' },
                take: 1,
                select: { url: true },
              },
            },
          },
          sku: { select: { id: true, title: true, price: true } },
        },
      }),
      this.prisma.lotteryPrize.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 新增奖品 */
  async createPrize(dto: CreateLotteryPrizeDto) {
    // 业务约束：type ↔ productId / skuId 联动校验
    this.validateTypeConstraints(dto.type, dto.productId, dto.skuId);
    this.validatePricingConstraints(dto.type, dto.prizePrice, dto.threshold);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.validateProductSkuRelation(
        tx,
        dto.type,
        dto.productId ?? null,
        dto.skuId ?? null,
        dto.prizePrice ?? null,
      );

      const newPrize = await tx.lotteryPrize.create({
        data: {
          type: dto.type,
          name: dto.name,
          productId: dto.type === LotteryPrizeType.NO_PRIZE ? null : dto.productId,
          skuId: dto.type === LotteryPrizeType.NO_PRIZE ? null : dto.skuId,
          prizePrice: dto.type === LotteryPrizeType.NO_PRIZE ? null : dto.prizePrice,
          originalPrice: dto.type === LotteryPrizeType.NO_PRIZE ? null : (dto.originalPrice ?? null),
          threshold: dto.type === LotteryPrizeType.THRESHOLD_GIFT ? dto.threshold : null,
          prizeQuantity: dto.prizeQuantity ?? 1,
          probability: dto.probability,
          dailyLimit: dto.dailyLimit,
          totalLimit: dto.totalLimit,
          expirationHours: dto.expirationHours ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });

      // 自动按比例调整其他奖品概率
      await this.rebalanceOtherPrizes(tx, newPrize.id, dto.probability);
      await this.syncLotteryEnabled(tx, true);
      return newPrize;
    });

    this.bonusConfig.invalidateCache();
    return created;
  }

  /** 编辑奖品 */
  async updatePrize(id: string, dto: UpdateLotteryPrizeDto) {
    const prize = await this.prisma.lotteryPrize.findUnique({ where: { id } });
    if (!prize) throw new NotFoundException('奖品不存在');

    // 确定最终 type：如果本次更新了 type 则用新值，否则用现有值
    const effectiveType = dto.type ?? prize.type;
    // 确定最终 productId / skuId（NO_PRIZE 强制置空）
    const effectiveProductIdRaw = dto.productId !== undefined ? dto.productId : prize.productId;
    const effectiveSkuIdRaw = dto.skuId !== undefined ? dto.skuId : prize.skuId;
    const effectiveProductId = effectiveType === LotteryPrizeType.NO_PRIZE ? null : effectiveProductIdRaw;
    const effectiveSkuId = effectiveType === LotteryPrizeType.NO_PRIZE ? null : effectiveSkuIdRaw;
    const effectivePrizePrice = dto.prizePrice !== undefined ? dto.prizePrice : prize.prizePrice;
    const effectiveThreshold = dto.threshold !== undefined ? dto.threshold : prize.threshold;

    // 业务约束：type ↔ productId / skuId 联动校验
    this.validateTypeConstraints(
      effectiveType,
      effectiveProductId ?? undefined,
      effectiveSkuId ?? undefined,
    );
    this.validatePricingConstraints(
      effectiveType,
      effectivePrizePrice ?? undefined,
      effectiveThreshold ?? undefined,
    );

    // 构造类型安全的 update data（只包含 DTO 中有值的字段）
    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.probability !== undefined) updateData.probability = dto.probability;
    if (dto.productId !== undefined) updateData.productId = effectiveType === LotteryPrizeType.NO_PRIZE ? null : dto.productId;
    if (dto.skuId !== undefined) updateData.skuId = effectiveType === LotteryPrizeType.NO_PRIZE ? null : dto.skuId;
    if (dto.prizePrice !== undefined) updateData.prizePrice = dto.prizePrice;
    if (dto.originalPrice !== undefined) updateData.originalPrice = dto.originalPrice;
    if (dto.threshold !== undefined) updateData.threshold = dto.threshold;
    if (dto.prizeQuantity !== undefined) updateData.prizeQuantity = dto.prizeQuantity;
    if (dto.dailyLimit !== undefined) updateData.dailyLimit = dto.dailyLimit;
    if (dto.totalLimit !== undefined) updateData.totalLimit = dto.totalLimit;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.expirationHours !== undefined) updateData.expirationHours = dto.expirationHours;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    // 若类型改为 NO_PRIZE，强制清空商品关联
    if (dto.type === LotteryPrizeType.NO_PRIZE) {
      updateData.productId = null;
      updateData.skuId = null;
      updateData.prizePrice = null;
      updateData.originalPrice = null;
      updateData.threshold = null;
    }
    if (dto.type === LotteryPrizeType.DISCOUNT_BUY && dto.threshold === undefined) {
      updateData.threshold = null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.validateProductSkuRelation(
        tx,
        effectiveType,
        effectiveProductId ?? null,
        effectiveSkuId ?? null,
        effectivePrizePrice ?? null,
      );

      const next = await tx.lotteryPrize.update({
        where: { id },
        data: updateData,
      });

      // 概率变更时自动调整其他奖品
      if (dto.probability !== undefined) {
        await this.rebalanceOtherPrizes(tx, id, dto.probability);
      }
      await this.syncLotteryEnabled(tx, true);
      return next;
    });

    this.bonusConfig.invalidateCache();
    return updated;
  }

  /** 删除奖品（软删除） */
  async deletePrize(id: string) {
    const prize = await this.prisma.lotteryPrize.findUnique({ where: { id } });
    if (!prize) throw new NotFoundException('奖品不存在');

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.lotteryPrize.update({
        where: { id },
        data: { isActive: false },
      });

      // 将被删除奖品的概率按比例分配给剩余活跃奖品
      await this.rebalanceOtherPrizes(tx, id, 0);
      await this.syncLotteryEnabled(tx, true);
      return next;
    });

    this.bonusConfig.invalidateCache();
    this.logger.log(`奖品「${prize.name}」已停用`);
    return updated;
  }

  /** 批量调整奖品概率（一次性设置所有活跃奖品概率，事务内校验=100%） */
  async batchUpdateProbabilities(
    items: { id: string; probability: number }[],
  ) {
    if (items.length === 0) {
      throw new BadRequestException('至少需要一个奖品概率配置');
    }

    // 预校验：提交的概率总和必须=100%
    const inputSum = items.reduce((sum, i) => sum + i.probability, 0);
    if (Math.abs(inputSum - 100) > 0.01) {
      throw new BadRequestException(
        `提交的概率总和必须为100%，当前为 ${Math.round(inputSum * 100) / 100}%`,
      );
    }

    // 校验每个概率值合法
    for (const item of items) {
      if (item.probability < 0) {
        throw new BadRequestException(`概率不能为负数：${item.id}`);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // 校验所有 id 存在且活跃
      const prizes = await tx.lotteryPrize.findMany({
        where: { id: { in: items.map((i) => i.id) }, isActive: true },
        select: { id: true, name: true },
      });
      const existingIds = new Set(prizes.map((p) => p.id));
      for (const item of items) {
        if (!existingIds.has(item.id)) {
          throw new BadRequestException(`奖品 ${item.id} 不存在或已停用`);
        }
      }

      // 检查是否覆盖了所有活跃奖品
      const allActiveCount = await tx.lotteryPrize.count({
        where: { isActive: true },
      });
      if (items.length !== allActiveCount) {
        throw new BadRequestException(
          `必须为所有活跃奖品设置概率（活跃 ${allActiveCount} 个，提交 ${items.length} 个）`,
        );
      }

      // 批量更新
      const results = [];
      for (const item of items) {
        const r = await tx.lotteryPrize.update({
          where: { id: item.id },
          data: { probability: item.probability },
        });
        results.push(r);
      }

      // 事务内再次校验（防御性）
      await this.ensureActiveProbabilitySumIs100(tx);
      await this.syncLotteryEnabled(tx, true);
      return results;
    });

    this.bonusConfig.invalidateCache();
    this.logger.log(`批量调整概率完成，共 ${items.length} 个奖品`);
    return { updated: updated.length, items: updated };
  }

  /** 抽奖记录列表（分页） */
  async findRecords(page = 1, pageSize = 20, userId?: string, result?: string) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (userId) where.userId = userId;
    if (result) where.result = result;

    const [items, total] = await Promise.all([
      this.prisma.lotteryRecord.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          prize: {
            select: {
              id: true,
              name: true,
              type: true,
              product: {
                select: {
                  id: true,
                  title: true,
                  media: {
                    where: { type: 'IMAGE' },
                    orderBy: { sortOrder: 'asc' },
                    take: 1,
                    select: { url: true },
                  },
                },
              },
            },
          },
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
              authIdentities: {
                where: { provider: 'PHONE' },
                select: { identifier: true },
                take: 1,
              },
            },
          },
        },
      }),
      this.prisma.lotteryRecord.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /** 抽奖统计 */
  async getStats() {
    // UTC+8 中国时间
    const now = new Date();
    const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const today = chinaTime.toISOString().slice(0, 10);

    const [todayTotal, todayWon, prizeStats, allPrizes] = await Promise.all([
      // 今日总抽奖数
      this.prisma.lotteryRecord.count({
        where: { drawDate: today },
      }),
      // 今日中奖数
      this.prisma.lotteryRecord.count({
        where: { drawDate: today, result: 'WON' },
      }),
      // 今日各奖品中奖数
      this.prisma.lotteryRecord.groupBy({
        by: ['prizeId'],
        where: { drawDate: today, result: 'WON' },
        _count: { id: true },
      }),
      // 所有奖品（含消耗统计）
      this.prisma.lotteryPrize.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          type: true,
          wonCount: true,
          totalLimit: true,
          dailyLimit: true,
        },
      }),
    ]);

    // 组装每个奖品的今日消耗
    const prizeStatsMap = new Map(
      prizeStats.map((s) => [s.prizeId, s._count.id]),
    );

    const prizeDetails = allPrizes.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      todayWon: prizeStatsMap.get(p.id) || 0,
      totalWon: p.wonCount,
      totalLimit: p.totalLimit,
      dailyLimit: p.dailyLimit,
    }));

    return {
      today: {
        totalDraws: todayTotal,
        totalWon: todayWon,
      },
      prizes: prizeDetails,
    };
  }

  /**
   * 业务约束校验：奖品类型 ↔ 商品关联字段联动
   * - NO_PRIZE：productId 和 skuId 必须为空
   * - DISCOUNT_BUY / THRESHOLD_GIFT：productId 和 skuId 必填
   */
  private validateTypeConstraints(
    type: LotteryPrizeType,
    productId?: string,
    skuId?: string,
  ): void {
    if (type === LotteryPrizeType.NO_PRIZE) {
      if (productId || skuId) {
        throw new BadRequestException(
          '「谢谢参与」类型奖品不能关联商品（productId 和 skuId 必须为空）',
        );
      }
    } else {
      // DISCOUNT_BUY 或 THRESHOLD_GIFT
      if (!productId) {
        throw new BadRequestException(
          `「${type}」类型奖品必须关联商品（productId 不能为空）`,
        );
      }
      if (!skuId) {
        throw new BadRequestException(
          `「${type}」类型奖品必须关联 SKU（skuId 不能为空）`,
        );
      }
    }
  }

  /**
   * 业务约束校验：奖品类型 ↔ 价格 / 门槛联动
   * - THRESHOLD_GIFT：threshold 必须 > 0，prizePrice 必须为 0
   * - DISCOUNT_BUY：prizePrice 必须 > 0
   */
  private validatePricingConstraints(
    type: LotteryPrizeType,
    prizePrice?: number | null,
    threshold?: number | null,
  ): void {
    if (type === LotteryPrizeType.NO_PRIZE) {
      return;
    }

    if (type === LotteryPrizeType.THRESHOLD_GIFT) {
      if (threshold === undefined || threshold === null || threshold <= 0) {
        throw new BadRequestException('「THRESHOLD_GIFT」类型奖品要求 threshold > 0');
      }
      if (prizePrice === undefined || prizePrice === null || Math.abs(prizePrice) > 0.000001) {
        throw new BadRequestException('「THRESHOLD_GIFT」类型奖品要求 prizePrice = 0');
      }
      return;
    }

    if (prizePrice === undefined || prizePrice === null || prizePrice <= 0) {
      throw new BadRequestException('「DISCOUNT_BUY」类型奖品要求 prizePrice > 0');
    }
  }

  /**
   * 校验商品归属与 SKU 归属关系
   * - 奖品必须关联奖励商品
   * - skuId 必须属于 productId
   * - DISCOUNT_BUY 时，prizePrice 不得高于 SKU 原价
   */
  private async validateProductSkuRelation(
    tx: any,
    type: LotteryPrizeType,
    productId: string | null,
    skuId: string | null,
    prizePrice: number | null,
  ): Promise<void> {
    if (type === LotteryPrizeType.NO_PRIZE) {
      return;
    }

    if (!productId || !skuId) {
      return;
    }

    const [product, sku] = await Promise.all([
      tx.product.findUnique({
        where: { id: productId },
        select: { id: true, companyId: true },
      }),
      tx.productSKU.findUnique({
        where: { id: skuId },
        select: { id: true, productId: true, price: true },
      }),
    ]);

    if (!product) {
      throw new NotFoundException('关联商品不存在');
    }
    if (product.companyId !== PLATFORM_COMPANY_ID) {
      throw new BadRequestException('抽奖奖品只能关联奖励商品');
    }
    if (!sku) {
      throw new NotFoundException('关联 SKU 不存在');
    }
    if (sku.productId !== product.id) {
      throw new BadRequestException('关联 SKU 不属于所选商品');
    }

    if (
      type === LotteryPrizeType.DISCOUNT_BUY &&
      prizePrice !== null &&
      prizePrice > sku.price + 0.000001
    ) {
      throw new BadRequestException('优惠购奖品价格不能高于 SKU 原价');
    }
  }

  /** 强制校验活跃奖品概率总和必须为 100%（保存时校验） */
  private async ensureActiveProbabilitySumIs100(tx: any): Promise<void> {
    const currentSum = await this.getActiveProbabilitySum(undefined, tx);
    if (Math.abs(currentSum - 100) > 0.01) {
      throw new BadRequestException(
        `保存失败：活跃奖品概率总和必须为100%，当前为 ${Math.round(currentSum * 100) / 100}%`,
      );
    }
  }

  /** 同步 LOTTERY_ENABLED 配置并由调用方在事务后清缓存 */
  private async syncLotteryEnabled(tx: any, enabled: boolean): Promise<void> {
    await tx.ruleConfig.upsert({
      where: { key: 'LOTTERY_ENABLED' },
      update: { value: { value: enabled, description: '抽奖功能开关（奖品概率变更时自动同步）' } },
      create: { key: 'LOTTERY_ENABLED', value: { value: enabled, description: '抽奖功能开关（奖品概率变更时自动同步）' } },
    });
    this.logger.log(`抽奖功能已自动${enabled ? '启用' : '禁用'}`);
  }

  /** 计算活跃奖品概率总和（可排除指定 id） */
  private async getActiveProbabilitySum(excludeId?: string, tx?: any): Promise<number> {
    const prisma = tx || this.prisma;
    const prizes = await prisma.lotteryPrize.findMany({
      where: {
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { probability: true },
    });
    return prizes.reduce((sum: number, p: { probability: number }) => sum + p.probability, 0);
  }

  /**
   * 自动按比例调整其他活跃奖品概率，使总和保持 100%
   * - excludeId: 本次新增/编辑的奖品 ID（不参与调整）
   * - newProbability: 该奖品占用的概率
   * 其他奖品按原比例缩放，填满剩余的 (100 - newProbability)%
   */
  private async rebalanceOtherPrizes(tx: any, excludeId: string, newProbability: number): Promise<void> {
    const others = await tx.lotteryPrize.findMany({
      where: { isActive: true, id: { not: excludeId } },
      select: { id: true, probability: true },
    });

    if (others.length === 0) return;

    const remaining = Math.max(0, 100 - newProbability);
    const othersSum = others.reduce((s: number, p: { probability: number }) => s + p.probability, 0);

    if (othersSum < 0.001) {
      // 其他奖品概率都是0，均匀分配
      const each = Math.round((remaining / others.length) * 100) / 100;
      for (let i = 0; i < others.length; i++) {
        const prob = i === others.length - 1
          ? Math.round((remaining - each * (others.length - 1)) * 100) / 100
          : each;
        await tx.lotteryPrize.update({ where: { id: others[i].id }, data: { probability: prob } });
      }
    } else {
      // 按原比例缩放
      let allocated = 0;
      for (let i = 0; i < others.length; i++) {
        const ratio = others[i].probability / othersSum;
        let prob: number;
        if (i === others.length - 1) {
          prob = Math.round((remaining - allocated) * 100) / 100;
        } else {
          prob = Math.round(remaining * ratio * 100) / 100;
          allocated += prob;
        }
        await tx.lotteryPrize.update({ where: { id: others[i].id }, data: { probability: prob } });
      }
    }
  }
}
