import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderProfitSnapshot, Prisma, UserStatus } from '@prisma/client';
import {
  CAPTAIN_SEAFOOD_CONFIG_KEY,
  CAPTAIN_SEAFOOD_PROGRAM_CODE,
  cloneCaptainSeafoodConfig,
  DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
  normalizeCaptainSeafoodConfig,
  readCaptainSeafoodConfig,
  unwrapRuleConfigValue,
} from '../captain/captain.constants';
import type { CaptainSeafoodConfig } from '../captain/captain.types';
import { resolveDirectRelation } from './direct-relation-resolver';
import { centsToYuan, checkedSafeIntegerSum, yuanToCents } from './money-allocation';
import { resolveOrCreateNormalTreeNode } from './normal-tree-resolver';
import { OrderProfitSnapshotCalculator } from './order-profit-snapshot-calculator';

const CALCULATION_VERSION = 'discounted-profit-v1';

const CONFIG_DEFAULTS = {
  VIP_PLATFORM_PERCENT: 0.5,
  VIP_REWARD_PERCENT: 0.3,
  VIP_DIRECT_REFERRAL_PERCENT: 0,
  VIP_INDUSTRY_FUND_PERCENT: 0.1,
  VIP_CHARITY_PERCENT: 0.02,
  VIP_TECH_PERCENT: 0.02,
  VIP_RESERVE_PERCENT: 0.06,
  VIP_MAX_LAYERS: 15,
  NORMAL_PLATFORM_PERCENT: 0.49,
  NORMAL_REWARD_PERCENT: 0.16,
  NORMAL_DIRECT_REFERRAL_PERCENT: 0.01,
  NORMAL_INDUSTRY_FUND_PERCENT: 0.16,
  NORMAL_CHARITY_PERCENT: 0.08,
  NORMAL_TECH_PERCENT: 0.08,
  NORMAL_RESERVE_PERCENT: 0.02,
  NORMAL_MAX_LAYERS: 15,
  NORMAL_BRANCH_FACTOR: 3,
} as const;

type ConfigKey = keyof typeof CONFIG_DEFAULTS;

interface RateSnapshot {
  platform: number;
  reward: number;
  directReferral: number;
  industryFund: number;
  charity: number;
  tech: number;
  reserve: number;
}

interface RuleState {
  configVersion: string;
  validatedSafetyVersion: string | null;
  vipMaxLayers: number;
  normalMaxLayers: number;
  normalBranchFactor: number;
  rates: { vip: RateSnapshot; normal: RateSnapshot };
  captainConfig: CaptainSeafoodConfig;
  captainConfigVersion: string;
}

@Injectable()
export class OrderProfitSnapshotService {
  private readonly calculator = new OrderProfitSnapshotCalculator();

  async createForPaidOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<OrderProfitSnapshot | null> {
    const existing = await tx.orderProfitSnapshot.findFirst({
      where: { orderId, isCurrent: true },
      orderBy: { revision: 'desc' },
    });
    if (existing) return existing;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: {
            memberProfile: {
              select: {
                tier: true,
                inviterUserId: true,
                vipNodeId: true,
                normalTreeNodeId: true,
              },
            },
          },
        },
        items: {
          include: {
            sku: {
              select: {
                cost: true,
                product: {
                  select: { id: true, categoryId: true, companyId: true },
                },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.bizType !== 'NORMAL_GOODS') return null;

    const ruleState = await this.loadRuleState(tx);
    const member = order.user?.memberProfile ?? null;
    const buyerPath = member?.tier === 'VIP' ? 'VIP' : 'NORMAL';
    const buyerNode = buyerPath === 'VIP'
      ? await this.resolveVipNode(tx, order.userId, member?.vipNodeId ?? null)
      : await resolveOrCreateNormalTreeNode(
        tx,
        order.userId,
        ruleState.normalBranchFactor,
      );
    const ancestorPath = await this.resolveAncestorPath(
      tx,
      buyerPath,
      buyerNode?.parentId ?? null,
      buyerPath === 'VIP' ? ruleState.vipMaxLayers : ruleState.normalMaxLayers,
    );

    const relation = await resolveDirectRelation(
      tx,
      order.userId,
      member?.inviterUserId ?? null,
      !member,
    );
    const inviter = relation.inviterUserId
      ? await tx.user.findUnique({
        where: { id: relation.inviterUserId },
        select: {
          id: true,
          status: true,
          deletionExecutedAt: true,
          memberProfile: { select: { tier: true, referralCode: true } },
        },
      })
      : null;
    const inviterTier = inviter?.memberProfile?.tier ?? null;
    const directRatePath = inviterTier === 'VIP'
      ? 'VIP'
      : inviterTier === 'NORMAL'
        ? 'NORMAL'
        : buyerPath;
    const directPlatformReason = relation.platformReason
      ?? (!inviter && relation.inviterUserId ? 'DIRECT_INVITER_NOT_FOUND' : null)
      ?? (inviter && (inviter.status !== UserStatus.ACTIVE || inviter.deletionExecutedAt)
        ? 'DIRECT_INVITER_INACTIVE'
        : null)
      ?? (inviter && !inviter.memberProfile?.tier ? 'DIRECT_INVITER_PROFILE_MISSING' : null);

    const captain = await this.resolveCaptain(tx, order.userId, ruleState);
    const paidAt = order.paidAt ?? order.createdAt;
    const calculationItems = order.items.map((item) => ({
      id: item.id,
      unitPriceCents: this.toCentsOrInvalid(item.unitPrice),
      quantity: item.quantity,
      unitCostCents: this.toOptionalCostCents(item.sku.cost),
      explicitDiscountCents: 0,
      isPrize: item.isPrize,
      captainEligible: this.isCaptainEligible(
        item,
        order.bizType,
        paidAt,
        ruleState.captainConfig,
      ),
    }));
    const declaredGrossGoodsAmountCents = this.toCentsOrInvalid(order.goodsAmount);
    const nonPrizeGrossGoodsAmountCents = checkedSafeIntegerSum(
      calculationItems
        .filter((item) => !item.isPrize)
        .map((item) => item.unitPriceCents * item.quantity),
    );
    const allItemGrossGoodsAmountCents = checkedSafeIntegerSum(
      calculationItems.map((item) => item.unitPriceCents * item.quantity),
    );
    const declaredGrossMatchesFulfillment = nonPrizeGrossGoodsAmountCents !== null
      && allItemGrossGoodsAmountCents !== null
      && (
        declaredGrossGoodsAmountCents === nonPrizeGrossGoodsAmountCents
        || declaredGrossGoodsAmountCents === allItemGrossGoodsAmountCents
      );

    const calculation = this.calculator.calculate({
      // Paid prize rows are fulfillment facts, not a member/captain profit source.
      // Accept both historical orders that excluded prize value from goodsAmount
      // and current orders that included a positive DISCOUNT_BUY price.
      grossGoodsAmountCents: declaredGrossMatchesFulfillment
        ? nonPrizeGrossGoodsAmountCents!
        : declaredGrossGoodsAmountCents,
      vipDiscountCents: this.toCentsOrInvalid(order.vipDiscountAmount ?? 0),
      couponDiscountCents: this.toCentsOrInvalid(order.totalCouponDiscount ?? 0),
      rewardDeductionCents: this.toCentsOrInvalid(order.discountAmount ?? 0),
      groupBuyRebateDeductionCents: this.toCentsOrInvalid(
        order.groupBuyRebateDeductionAmount ?? 0,
      ),
      otherGoodsDiscountCents: 0,
      items: calculationItems,
    });

    const snapshot = await tx.orderProfitSnapshot.create({
      data: {
        orderId,
        revision: 1,
        isCurrent: true,
        status: calculation.status,
        grossGoodsAmount: centsToYuan(calculation.grossGoodsAmountCents),
        shippingAmount: order.shippingFee,
        vipDiscountAmount: centsToYuan(calculation.vipDiscountCents),
        couponDiscountAmount: centsToYuan(calculation.couponDiscountCents),
        rewardDeductionAmount: centsToYuan(calculation.rewardDeductionCents),
        groupBuyRebateDeductionAmount: centsToYuan(
          calculation.groupBuyRebateDeductionCents,
        ),
        otherGoodsDiscountAmount: centsToYuan(calculation.otherGoodsDiscountCents),
        netGoodsRevenue: centsToYuan(calculation.netGoodsRevenueCents),
        productCostAmount: centsToYuan(calculation.productCostCents),
        distributableProfitAmount: centsToYuan(calculation.distributableProfitCents),
        captainEligibleProfitAmount: centsToYuan(
          calculation.captainEligibleProfitCents,
        ),
        calculationVersion: CALCULATION_VERSION,
        itemBreakdown: calculation.itemBreakdown as unknown as Prisma.InputJsonValue,
        ruleSnapshot: {
          buyerPath,
          buyerTierAtPayment: member?.tier ?? 'NORMAL',
          vipNormalConfigVersion: ruleState.configVersion,
          validatedSafetyVersion: ruleState.validatedSafetyVersion,
          directInviter: {
            userId: relation.inviterUserId,
            eligibleUserId: directPlatformReason ? null : relation.inviterUserId,
            tier: inviterTier,
            path: directRatePath,
            status: inviter?.status ?? null,
            deletionExecutedAt: inviter?.deletionExecutedAt?.toISOString() ?? null,
            sourceRelation: relation.sourceRelation,
            normalShareBindingId: relation.normalShareBindingId ?? null,
            relationStatus: relation.relationStatus ?? null,
            sourceCode: relation.sourceCode ?? inviter?.memberProfile?.referralCode ?? null,
            sourceCodeType: relation.sourceCodeType ?? (
              inviter?.memberProfile?.referralCode ? 'MEMBER_REFERRAL_CODE' : null
            ),
            effectiveDirectRate: ruleState.rates[directRatePath.toLowerCase() as 'vip' | 'normal']
              .directReferral,
            platformReason: directPlatformReason,
          },
          vipTreeNodeIdAtPayment: buyerPath === 'VIP' ? buyerNode?.id ?? null : null,
          normalTreeNodeIdAtPayment: buyerPath === 'NORMAL' ? buyerNode?.id ?? null : null,
          vipTreeAncestorPathAtPayment: buyerPath === 'VIP' ? ancestorPath : [],
          normalTreeAncestorPathAtPayment: buyerPath === 'NORMAL' ? ancestorPath : [],
          captain,
          rates: ruleState.rates,
        } as unknown as Prisma.InputJsonValue,
        errorCode: calculation.errorCode ?? null,
        errorMeta: calculation.errorMeta
          ? calculation.errorMeta as Prisma.InputJsonValue
          : Prisma.JsonNull,
      },
    });

    if (calculation.status === 'RECONCILIATION_REQUIRED') {
      await tx.orderProfitReconciliationTask.upsert({
        where: {
          sourceSnapshotId_orderId: {
            sourceSnapshotId: snapshot.id,
            orderId,
          },
        },
        update: {},
        create: {
          orderId,
          sourceSnapshotId: snapshot.id,
          status: 'PENDING',
          errorCode: calculation.errorCode ?? 'ORDER_PROFIT_CONSERVATION_FAILED',
        },
      });
    }

    return snapshot;
  }

  private async loadRuleState(tx: Prisma.TransactionClient): Promise<RuleState> {
    const [rows, latestVersion] = await Promise.all([
      tx.ruleConfig.findMany(),
      tx.ruleVersion.findFirst({ orderBy: { createdAt: 'desc' } }),
    ]);
    const rowMap = new Map(rows.map((row) => [row.key, row]));
    const readNumber = (key: ConfigKey): number => {
      const row = rowMap.get(key);
      if (!row) return CONFIG_DEFAULTS[key];
      const stored = row.value as Record<string, unknown>;
      const raw = stored && typeof stored === 'object' && 'value' in stored
        ? stored.value
        : row.value;
      const value = Number(raw);
      return Number.isFinite(value) ? value : CONFIG_DEFAULTS[key];
    };

    const captainRow = rowMap.get(CAPTAIN_SEAFOOD_CONFIG_KEY);
    const captainConfig = captainRow
      ? readCaptainSeafoodConfig(normalizeCaptainSeafoodConfig(
        unwrapRuleConfigValue<unknown>(captainRow.value),
      ))
      : cloneCaptainSeafoodConfig(DEFAULT_CAPTAIN_SEAFOOD_CONFIG);

    return {
      configVersion: latestVersion?.version ?? 'initial',
      validatedSafetyVersion: latestVersion?.isComplete ? latestVersion.version : null,
      vipMaxLayers: readNumber('VIP_MAX_LAYERS'),
      normalMaxLayers: readNumber('NORMAL_MAX_LAYERS'),
      normalBranchFactor: readNumber('NORMAL_BRANCH_FACTOR'),
      rates: {
        vip: {
          platform: readNumber('VIP_PLATFORM_PERCENT'),
          reward: readNumber('VIP_REWARD_PERCENT'),
          directReferral: readNumber('VIP_DIRECT_REFERRAL_PERCENT'),
          industryFund: readNumber('VIP_INDUSTRY_FUND_PERCENT'),
          charity: readNumber('VIP_CHARITY_PERCENT'),
          tech: readNumber('VIP_TECH_PERCENT'),
          reserve: readNumber('VIP_RESERVE_PERCENT'),
        },
        normal: {
          platform: readNumber('NORMAL_PLATFORM_PERCENT'),
          reward: readNumber('NORMAL_REWARD_PERCENT'),
          directReferral: readNumber('NORMAL_DIRECT_REFERRAL_PERCENT'),
          industryFund: readNumber('NORMAL_INDUSTRY_FUND_PERCENT'),
          charity: readNumber('NORMAL_CHARITY_PERCENT'),
          tech: readNumber('NORMAL_TECH_PERCENT'),
          reserve: readNumber('NORMAL_RESERVE_PERCENT'),
        },
      },
      captainConfig,
      captainConfigVersion: captainRow?.updatedAt.toISOString() ?? 'default',
    };
  }

  private async resolveVipNode(
    tx: Prisma.TransactionClient,
    userId: string,
    vipNodeId: string | null,
  ) {
    if (vipNodeId) {
      const node = await tx.vipTreeNode.findUnique({ where: { id: vipNodeId } });
      if (node) return node;
    }
    return tx.vipTreeNode.findUnique({ where: { userId } });
  }

  private async resolveAncestorPath(
    tx: Prisma.TransactionClient,
    path: 'VIP' | 'NORMAL',
    firstParentId: string | null,
    maxLayers: number,
  ) {
    const ancestors: Array<Record<string, unknown>> = [];
    let nodeId = firstParentId;
    const seen = new Set<string>();
    while (nodeId && ancestors.length < maxLayers && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node = path === 'VIP'
        ? await tx.vipTreeNode.findUnique({ where: { id: nodeId } })
        : await tx.normalTreeNode.findUnique({ where: { id: nodeId } });
      if (!node) break;
      ancestors.push({
        depth: ancestors.length + 1,
        nodeId: node.id,
        userId: node.userId,
        level: node.level,
      });
      nodeId = node.parentId;
    }
    return ancestors;
  }

  private async resolveCaptain(
    tx: Prisma.TransactionClient,
    buyerUserId: string,
    ruleState: RuleState,
  ) {
    const relation = await tx.captainRelation.findUnique({
      where: {
        buyerUserId_programCode: {
          buyerUserId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        },
      },
      select: {
        id: true,
        directCaptainUserId: true,
        status: true,
        source: true,
        codeUsed: true,
      },
    });
    if (!relation) {
      return {
        relationId: null,
        directCaptainUserId: null,
        relationStatus: null,
        profileStatus: null,
        exclusionReason: 'NO_CAPTAIN_RELATION',
        configVersion: ruleState.captainConfigVersion,
        config: ruleState.captainConfig,
      };
    }
    if (relation.directCaptainUserId === buyerUserId) {
      return {
        relationId: relation.id,
        directCaptainUserId: null,
        relationStatus: relation.status,
        profileStatus: null,
        source: relation.source,
        codeUsed: relation.codeUsed,
        exclusionReason: 'SELF_CAPTAIN',
        configVersion: ruleState.captainConfigVersion,
        config: ruleState.captainConfig,
      };
    }
    const profile = await tx.captainProfile.findUnique({
      where: { userId: relation.directCaptainUserId },
      select: { userId: true, status: true, programCode: true },
    });
    return {
      relationId: relation.id,
      directCaptainUserId: relation.directCaptainUserId,
      relationStatus: relation.status,
      profileStatus: profile?.status ?? null,
      source: relation.source,
      codeUsed: relation.codeUsed,
      exclusionReason: relation.status !== 'ACTIVE'
        ? 'CAPTAIN_RELATION_INACTIVE'
        : profile?.status !== 'ACTIVE'
          ? 'CAPTAIN_PROFILE_INACTIVE'
          : null,
      configVersion: ruleState.captainConfigVersion,
      config: ruleState.captainConfig,
    };
  }

  private isCaptainEligible(
    item: {
      isPrize: boolean;
      companyId: string | null;
      sku: { product: { id: string; categoryId: string | null; companyId: string } };
    },
    bizType: string,
    paidAt: Date,
    config: CaptainSeafoodConfig,
  ): boolean {
    if (
      item.isPrize
      || bizType !== 'NORMAL_GOODS'
      || config.schemaVersion !== 3
      || !config.enabled
      || paidAt < new Date(config.effectiveFrom)
      || config.scope.excludedProductIds.includes(item.sku.product.id)
    ) {
      return false;
    }
    if (config.scope.mode === 'ALL_NORMAL_GOODS') {
      return true;
    }
    return config.scope.productIds.includes(item.sku.product.id)
      || (item.sku.product.categoryId
        ? config.scope.categoryIds.includes(item.sku.product.categoryId)
        : false)
      || config.scope.companyIds.includes(item.companyId ?? item.sku.product.companyId);
  }

  private toOptionalCostCents(value: number): number | null {
    const cents = this.toCentsOrInvalid(value);
    return Number.isNaN(cents) ? null : cents;
  }

  private toCentsOrInvalid(value: number): number {
    try {
      return yuanToCents(value);
    } catch {
      return Number.NaN;
    }
  }
}
