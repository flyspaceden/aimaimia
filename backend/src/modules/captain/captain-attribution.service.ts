import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CAPTAIN_SEAFOOD_PROGRAM_CODE,
} from './captain.constants';
import { CaptainConfigService } from './captain-config.service';
import type { CaptainSeafoodConfig } from './captain.types';

export type CaptainAttributionResult = 'credited' | 'skipped';

@Injectable()
export class CaptainAttributionService {
  private readonly logger = new Logger(CaptainAttributionService.name);

  constructor(private readonly configService: CaptainConfigService) {}

  async createFrozenForPaidOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<CaptainAttributionResult> {
    const config = await this.configService.getSnapshot();
    if (!config.enabled) {
      return 'skipped';
    }

    const existing = await (tx as any).captainOrderAttribution.findUnique({
      where: {
        orderId_programCode: {
          orderId,
          programCode: config.programCode,
        },
      },
    });
    if (existing) {
      return 'skipped';
    }

    const order = await (tx as any).order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            sku: {
              select: {
                productId: true,
                product: {
                  select: {
                    id: true,
                    categoryId: true,
                    companyId: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order || order.bizType !== 'NORMAL_GOODS') {
      return 'skipped';
    }

    const relation = await (tx as any).captainRelation.findUnique({
      where: {
        buyerUserId_programCode: {
          buyerUserId: order.userId,
          programCode: config.programCode,
        },
      },
    });
    if (!relation || relation.status !== 'ACTIVE') {
      return 'skipped';
    }

    const captainUserIds = [relation.directCaptainUserId];
    const activeCaptains = await (tx as any).captainProfile.findMany({
      where: {
        userId: { in: captainUserIds },
        programCode: config.programCode,
        status: 'ACTIVE',
      },
      select: { userId: true, status: true },
    });
    const activeCaptainSet = new Set(activeCaptains.map((item: any) => item.userId));
    const directCaptainUserId = activeCaptainSet.has(relation.directCaptainUserId)
      ? relation.directCaptainUserId
      : null;
    if (!directCaptainUserId) {
      return 'skipped';
    }

    const eligibleGoodsAmount = this.calculateEligibleGoodsAmount(order.items || [], config);
    if (eligibleGoodsAmount <= 0 || eligibleGoodsAmount < config.orderRules.minCommissionBase) {
      return 'skipped';
    }

    const goodsAmount = this.roundMoney(Number(order.goodsAmount || 0));
    if (goodsAmount <= 0) {
      return 'skipped';
    }
    const ratio = Math.min(1, eligibleGoodsAmount / goodsAmount);
    const netGoodsPaidAmount = Math.max(
      0,
      Number(order.totalAmount || 0) - Number(order.shippingFee || 0),
    );
    const commissionBase = this.roundMoney(Math.min(
      eligibleGoodsAmount,
      netGoodsPaidAmount * ratio,
    ));
    if (commissionBase <= 0 || commissionBase < config.orderRules.minCommissionBase) {
      return 'skipped';
    }

    const couponDiscountAmount = this.roundMoney(Number(order.totalCouponDiscount || 0) * ratio);
    const rewardDeductionAmount = this.roundMoney(Number(order.discountAmount || 0) * ratio);
    const configSnapshot = JSON.parse(JSON.stringify(config));

    try {
      const attribution = await (tx as any).captainOrderAttribution.create({
        data: {
          orderId,
          buyerUserId: order.userId,
          directCaptainUserId,
          legacyIndirectCaptainUserId: null,
          programCode: config.programCode,
          commissionBase,
          eligibleGoodsAmount,
          couponDiscountAmount,
          rewardDeductionAmount,
          directRate: config.perOrderCommission.directRate,
          legacyIndirectRate: 0,
          status: 'FROZEN',
          configSnapshot,
          meta: {
            netGoodsPaidAmount: this.roundMoney(netGoodsPaidAmount),
            discountRatio: ratio,
            commissionModel: 'DIRECT_ONLY',
          },
        },
      });

      await this.createFrozenLedger(tx, {
        userId: directCaptainUserId,
        orderId,
        attributionId: attribution.id,
        type: 'DIRECT_ORDER',
        rate: config.perOrderCommission.directRate,
        commissionBase,
        configSnapshot,
      });
      return 'credited';
    } catch (err: any) {
      if (this.isUniqueConstraintError(err)) {
        this.logger.warn(`团长订单归因幂等键已存在，跳过：orderId=${orderId}`);
        return 'skipped';
      }
      throw err;
    }
  }

  private async createFrozenLedger(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      orderId: string;
      attributionId: string;
      type: 'DIRECT_ORDER';
      rate: number;
      commissionBase: number;
      configSnapshot: CaptainSeafoodConfig;
    },
  ) {
    const amount = this.roundMoney(params.commissionBase * params.rate);
    if (amount <= 0) return;

    const account = await (tx as any).captainAccount.upsert({
      where: {
        userId_programCode: {
          userId: params.userId,
          programCode: params.configSnapshot.programCode,
        },
      },
      update: {},
      create: {
        userId: params.userId,
        programCode: params.configSnapshot.programCode,
      },
    });

    await (tx as any).captainCommissionLedger.create({
      data: {
        accountId: account.id,
        userId: params.userId,
        orderAttributionId: params.attributionId,
        orderId: params.orderId,
        programCode: params.configSnapshot.programCode,
        type: params.type,
        status: 'FROZEN',
        amount,
        commissionBase: params.commissionBase,
        rate: params.rate,
        frozenAfter: this.roundMoney(Number(account.frozen || 0) + amount),
        idempotencyKey: `captain:order:${params.orderId}:direct`,
        refType: 'ORDER',
        refId: params.orderId,
        configSnapshot: params.configSnapshot,
        meta: {
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        },
      },
    });

    await (tx as any).captainAccount.update({
      where: { id: account.id },
      data: { frozen: { increment: amount } },
    });
  }

  private calculateEligibleGoodsAmount(items: any[], config: CaptainSeafoodConfig) {
    return this.roundMoney(items
      .filter((item) => this.isEligibleItem(item, config))
      .reduce((sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0));
  }

  private isEligibleItem(item: any, config: CaptainSeafoodConfig) {
    if (!item || item.isPrize) return false;

    const productId = item.sku?.productId || item.sku?.product?.id || null;
    const categoryId = item.sku?.product?.categoryId || null;
    const companyId = item.companyId || item.sku?.product?.companyId || null;

    if (productId && config.scope.excludedProductIds.includes(productId)) {
      return false;
    }

    const productMatched = productId && config.scope.productIds.includes(productId);
    const categoryMatched = categoryId && config.scope.categoryIds.includes(categoryId);
    const companyMatched = companyId && config.scope.companyIds.includes(companyId);

    return Boolean(productMatched || categoryMatched || companyMatched);
  }

  private roundMoney(value: number) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  private isUniqueConstraintError(err: any): boolean {
    return err instanceof Prisma.PrismaClientKnownRequestError
      ? err.code === 'P2002'
      : err?.code === 'P2002';
  }
}
