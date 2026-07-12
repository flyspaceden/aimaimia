import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculateCaptainProfitFunding } from '../profit/captain-profit-funding';
import {
  centsToYuan,
  checkedSafeIntegerSum,
  yuanToCents,
} from '../profit/money-allocation';
import {
  CAPTAIN_SEAFOOD_PROGRAM_CODE,
} from './captain.constants';
import type { CaptainSeafoodConfigV3 } from './captain.types';

export type CaptainAttributionResult = 'credited' | 'skipped';

interface ProfitRateSnapshot {
  platform: number;
  reward: number;
  directReferral: number;
  industryFund: number;
  charity: number;
  tech: number;
  reserve: number;
}

interface CaptainEligibleGmv {
  amount: number;
  cents: number;
  eligibleCount: number;
}

@Injectable()
export class CaptainAttributionService {
  async createFrozenForPaidOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<CaptainAttributionResult> {
    const existing = await (tx as any).captainOrderAttribution.findUnique({
      where: {
        orderId_programCode: {
          orderId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        },
      },
    });
    if (existing) return 'skipped';

    const snapshot = await (tx as any).orderProfitSnapshot.findFirst({
      where: { orderId, isCurrent: true },
      include: { order: true },
      orderBy: { revision: 'desc' },
    });
    if (!snapshot || snapshot.status !== 'READY' || !snapshot.order) return 'skipped';

    const ruleSnapshot = this.asRecord(snapshot.ruleSnapshot);
    const captain = this.asRecord(ruleSnapshot?.captain);
    const configRecord = this.asRecord(captain?.config);
    if (
      configRecord?.schemaVersion === 2
      || (configRecord?.schemaVersion === 3 && configRecord.enabled === false)
    ) {
      return 'skipped';
    }
    if (
      !configRecord
      || configRecord.schemaVersion !== 3
      || configRecord.enabled !== true
      || configRecord.programCode !== CAPTAIN_SEAFOOD_PROGRAM_CODE
    ) {
      return this.reconcileInvalidSnapshot(tx, snapshot);
    }
    const config = configRecord as unknown as CaptainSeafoodConfigV3;
    const configVersion = this.asString(captain?.configVersion);
    const commissionBaseMoney = this.readStrictMoney(snapshot.captainEligibleProfitAmount);
    const distributableProfitMoney = this.readStrictMoney(snapshot.distributableProfitAmount);
    if (
      !configVersion
      || !commissionBaseMoney
      || !distributableProfitMoney
      || commissionBaseMoney.cents > distributableProfitMoney.cents
    ) {
      return this.reconcileInvalidSnapshot(tx, snapshot);
    }

    const buyerPath = ruleSnapshot?.buyerPath;
    const rateSet = this.readProfitRateSet(ruleSnapshot?.rates);
    const directInviter = this.asRecord(ruleSnapshot?.directInviter);
    const directRate = this.readRate(directInviter?.effectiveDirectRate);
    const directInviterUserId = directInviter?.eligibleUserId;
    const perOrderCommission = this.asRecord(configRecord.perOrderCommission);
    const captainDirectRate = this.readRate(perOrderCommission?.directProfitRate);
    const monthlyRewards = this.asRecord(configRecord.monthlyRewards);
    const monthlyRates = monthlyRewards
      ? [
        this.readRate(monthlyRewards.baseManagementProfitRate),
        this.readRate(monthlyRewards.growthBonusProfitRate),
        this.readRate(monthlyRewards.cultivationBonusProfitRate),
        this.readRate(monthlyRewards.performanceBonusProfitRate),
      ]
      : [];
    if (
      (buyerPath !== 'VIP' && buyerPath !== 'NORMAL')
      || !rateSet
      || !directInviter
      || directRate === null
      || (directInviterUserId !== null && this.asString(directInviterUserId) === null)
      || captainDirectRate === null
      || monthlyRates.length !== 4
      || monthlyRates.some((rate) => rate === null)
    ) {
      return this.reconcileInvalidSnapshot(tx, snapshot);
    }
    const validatedMonthlyRates = monthlyRates as number[];
    if (
      captainDirectRate + validatedMonthlyRates.reduce((sum, rate) => sum + rate, 0)
      > 1 + 0.0000001
    ) {
      return this.reconcileInvalidSnapshot(tx, snapshot);
    }

    const eligibleGmv = this.captainEligibleNetGmv(snapshot.itemBreakdown);
    if (
      !eligibleGmv
      || commissionBaseMoney.cents > eligibleGmv.cents
    ) {
      return this.reconcileInvalidSnapshot(tx, snapshot);
    }
    if (eligibleGmv.eligibleCount === 0) return 'skipped';

    const directCaptainUserId = this.asString(captain?.directCaptainUserId);
    const effectiveAt = this.readDateMs(config.effectiveFrom);
    const paidAt = this.readDateMs(snapshot.order.paidAt);
    if (effectiveAt === null || paidAt === null) {
      return this.reconcileInvalidSnapshot(tx, snapshot);
    }
    if (
      !directCaptainUserId
      || captain?.relationStatus !== 'ACTIVE'
      || captain?.profileStatus !== 'ACTIVE'
      || captain?.exclusionReason != null
      || directCaptainUserId === snapshot.order.userId
      || snapshot.order.bizType !== 'NORMAL_GOODS'
      || paidAt < effectiveAt
    ) {
      return 'skipped';
    }

    const commissionBase = commissionBaseMoney.amount;
    const distributableProfitAmount = distributableProfitMoney.amount;
    const configSnapshot = JSON.parse(JSON.stringify(config));
    const attributionBase = {
      orderId,
      buyerUserId: snapshot.order.userId,
      directCaptainUserId,
      legacyIndirectCaptainUserId: null,
      programCode: config.programCode,
      commissionBase,
      eligibleGoodsAmount: eligibleGmv.amount,
      couponDiscountAmount: Number(snapshot.couponDiscountAmount ?? 0),
      rewardDeductionAmount: Number(snapshot.rewardDeductionAmount ?? 0),
      directRate: captainDirectRate,
      legacyIndirectRate: 0,
      status: 'FROZEN',
      configSnapshot,
      calculationModel: 'PROFIT_V3',
      profitSnapshotId: snapshot.id,
      profitConfigVersion: configVersion,
      profitBaseAmount: commissionBase,
    };

    if (commissionBaseMoney.cents === 0 || distributableProfitMoney.cents === 0) {
      await (tx as any).captainOrderAttribution.create({
        data: {
          ...attributionBase,
          meta: {
            commissionModel: 'PROFIT_V3_DIRECT_ONLY',
            captainRelationId: captain?.relationId ?? null,
            monthlyGmvOnly: true,
            vipNormalConfigVersion: ruleSnapshot?.vipNormalConfigVersion ?? null,
          },
        },
      });
      return 'credited';
    }

    const minCommissionBase = this.readStrictMoney(config.orderRules?.minCommissionBase ?? 0);
    if (!minCommissionBase) return this.reconcileInvalidSnapshot(tx, snapshot);
    if (eligibleGmv.cents < minCommissionBase.cents) return 'skipped';

    const rates = rateSet[buyerPath === 'VIP' ? 'vip' : 'normal'];

    let funding;
    try {
      funding = calculateCaptainProfitFunding({
        distributableProfitAmount,
        captainEligibleProfitAmount: commissionBase,
        memberProfitRates: {
          reward: Number(rates.reward),
          directReferral: Number(directInviter?.effectiveDirectRate),
          industryFund: Number(rates.industryFund),
          charity: Number(rates.charity),
          tech: Number(rates.tech),
          reserve: Number(rates.reserve),
        },
        directReferralClaimed: directInviterUserId !== null,
        captainDirectProfitRate: captainDirectRate,
        monthlyProfitRates: validatedMonthlyRates,
      });
    } catch {
      return this.reconcileInvalidSnapshot(tx, snapshot);
    }

    if (!funding.coveredByPlatformRetained) {
      await this.createReconciliationTask(
        tx,
        snapshot,
        'CAPTAIN_FUNDING_EXCEEDS_PLATFORM_RETAINED',
      );
      return 'skipped';
    }

    const attribution = await (tx as any).captainOrderAttribution.create({
      data: {
        ...attributionBase,
        meta: {
          commissionModel: 'PROFIT_V3_DIRECT_ONLY',
          captainRelationId: captain?.relationId ?? null,
          platformRetainedAmount: funding.platformRetainedAmount,
          directAmount: funding.directAmount,
          monthlyMaximum: funding.monthlyMaximum,
          vipNormalConfigVersion: ruleSnapshot?.vipNormalConfigVersion ?? null,
        },
      },
    });

    const directLedger = funding.directAmount > 0
      ? await this.createDirectFrozenLedger(tx, {
        userId: directCaptainUserId,
        orderId,
        attributionId: attribution.id,
        commissionBase,
        amount: funding.directAmount,
        rate: captainDirectRate,
        configSnapshot,
      })
      : null;

    const fundingMeta = {
      calculationModel: 'PROFIT_V3',
      profitBaseAmount: commissionBase,
      platformRetainedAmount: funding.platformRetainedAmount,
      directAmount: funding.directAmount,
      monthlyMaximum: funding.monthlyMaximum,
      totalHoldAmount: funding.totalHoldAmount,
      vipNormalConfigVersion: ruleSnapshot?.vipNormalConfigVersion ?? null,
      captainConfigVersion: configVersion,
    };
    await this.createFundingLedger(tx, snapshot, configVersion, {
      type: 'PLATFORM_RETAINED_CREDIT',
      amount: funding.platformRetainedAmount,
      sourceLedgerId: null,
      idempotencyKey: `captain:v3:funding:${orderId}:platform-retained`,
      meta: fundingMeta,
    });
    await this.createFundingLedger(tx, snapshot, configVersion, {
      type: 'CAPTAIN_DIRECT_HOLD',
      amount: -funding.directAmount,
      sourceLedgerId: directLedger?.id ?? null,
      idempotencyKey: `captain:v3:funding:${orderId}:direct-hold`,
      meta: fundingMeta,
    });
    await this.createFundingLedger(tx, snapshot, configVersion, {
      type: 'CAPTAIN_MONTHLY_HOLD',
      amount: -funding.monthlyMaximum,
      sourceLedgerId: null,
      idempotencyKey: `captain:v3:funding:${orderId}:monthly-hold`,
      meta: fundingMeta,
    });

    return 'credited';
  }

  private async createDirectFrozenLedger(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      orderId: string;
      attributionId: string;
      commissionBase: number;
      amount: number;
      rate: number;
      configSnapshot: CaptainSeafoodConfigV3;
    },
  ) {
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
    const ledger = await (tx as any).captainCommissionLedger.create({
      data: {
        accountId: account.id,
        userId: params.userId,
        orderAttributionId: params.attributionId,
        orderId: params.orderId,
        programCode: params.configSnapshot.programCode,
        type: 'DIRECT_ORDER',
        status: 'FROZEN',
        amount: params.amount,
        commissionBase: params.commissionBase,
        rate: params.rate,
        frozenAfter: this.roundMoney(Number(account.frozen ?? 0) + params.amount),
        idempotencyKey: `captain:v3:order:${params.orderId}:direct`,
        refType: 'ORDER',
        refId: params.orderId,
        configSnapshot: params.configSnapshot,
        meta: {
          calculationModel: 'PROFIT_V3',
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        },
      },
    });
    await (tx as any).captainAccount.update({
      where: { id: account.id },
      data: { frozen: { increment: params.amount } },
    });
    return ledger;
  }

  private async createFundingLedger(
    tx: Prisma.TransactionClient,
    snapshot: any,
    configVersion: string,
    funding: {
      type: 'PLATFORM_RETAINED_CREDIT' | 'CAPTAIN_DIRECT_HOLD' | 'CAPTAIN_MONTHLY_HOLD';
      amount: number;
      sourceLedgerId: string | null;
      idempotencyKey: string;
      meta: Record<string, unknown>;
    },
  ): Promise<void> {
    await (tx as any).orderProfitFundingLedger.create({
      data: {
        snapshotId: snapshot.id,
        orderId: snapshot.orderId,
        type: funding.type,
        amount: funding.amount,
        configVersion,
        sourceLedgerId: funding.sourceLedgerId,
        idempotencyKey: funding.idempotencyKey,
        meta: funding.meta,
      },
    });
  }

  private async createReconciliationTask(
    tx: Prisma.TransactionClient,
    snapshot: any,
    errorCode: string,
  ): Promise<void> {
    await (tx as any).orderProfitReconciliationTask.upsert({
      where: {
        sourceSnapshotId_orderId: {
          sourceSnapshotId: snapshot.id,
          orderId: snapshot.orderId,
        },
      },
      update: { status: 'PENDING', errorCode },
      create: {
        orderId: snapshot.orderId,
        sourceSnapshotId: snapshot.id,
        status: 'PENDING',
        errorCode,
      },
    });
  }

  private captainEligibleNetGmv(itemBreakdown: unknown): CaptainEligibleGmv | null {
    if (!Array.isArray(itemBreakdown) || itemBreakdown.length === 0) return null;
    const eligibleCents: number[] = [];
    const seenOrderItemIds = new Set<string>();
    for (const item of itemBreakdown) {
      const record = this.asRecord(item);
      const orderItemId = this.asString(record?.orderItemId);
      const captainEligible = record?.captainEligible;
      const netGoodsRevenueCents = record?.netGoodsRevenueCents;
      const distributableProfitShareCents = record?.distributableProfitShareCents;
      if (
        !record
        || !orderItemId
        || seenOrderItemIds.has(orderItemId)
        || typeof captainEligible !== 'boolean'
        || typeof netGoodsRevenueCents !== 'number'
        || !Number.isSafeInteger(netGoodsRevenueCents)
        || netGoodsRevenueCents < 0
        || typeof distributableProfitShareCents !== 'number'
        || !Number.isSafeInteger(distributableProfitShareCents)
        || distributableProfitShareCents < 0
        || distributableProfitShareCents > netGoodsRevenueCents
      ) {
        return null;
      }
      seenOrderItemIds.add(orderItemId);
      if (captainEligible) {
        eligibleCents.push(netGoodsRevenueCents);
      }
    }
    const totalCents = checkedSafeIntegerSum(eligibleCents);
    if (totalCents === null) return null;
    return {
      amount: centsToYuan(totalCents),
      cents: totalCents,
      eligibleCount: eligibleCents.length,
    };
  }

  private readProfitRateSet(value: unknown): { vip: ProfitRateSnapshot; normal: ProfitRateSnapshot } | null {
    const rateSet = this.asRecord(value);
    const vip = this.readProfitRates(rateSet?.vip);
    const normal = this.readProfitRates(rateSet?.normal);
    return vip && normal ? { vip, normal } : null;
  }

  private readProfitRates(value: unknown): ProfitRateSnapshot | null {
    const record = this.asRecord(value);
    if (!record) return null;
    const rates = {
      platform: this.readRate(record.platform),
      reward: this.readRate(record.reward),
      directReferral: this.readRate(record.directReferral),
      industryFund: this.readRate(record.industryFund),
      charity: this.readRate(record.charity),
      tech: this.readRate(record.tech),
      reserve: this.readRate(record.reserve),
    };
    const values = Object.values(rates);
    if (values.some((rate) => rate === null)) return null;
    const totalRate = (values as number[]).reduce((sum, rate) => sum + rate, 0);
    return Math.abs(totalRate - 1) <= 0.0000001
      ? rates as ProfitRateSnapshot
      : null;
  }

  private readRate(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : null;
  }

  private readStrictMoney(value: unknown): { amount: number; cents: number } | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    try {
      const cents = yuanToCents(value);
      return centsToYuan(cents) === value ? { amount: value, cents } : null;
    } catch {
      return null;
    }
  }

  private readDateMs(value: unknown): number | null {
    const milliseconds = value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  private async reconcileInvalidSnapshot(
    tx: Prisma.TransactionClient,
    snapshot: any,
  ): Promise<CaptainAttributionResult> {
    await this.createReconciliationTask(
      tx,
      snapshot,
      'CAPTAIN_FUNDING_INVALID_SNAPSHOT',
    );
    return 'skipped';
  }

  private asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null;
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }
}
