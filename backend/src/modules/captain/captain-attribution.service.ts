import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculateCaptainProfitFunding } from '../profit/captain-profit-funding';
import {
  CAPTAIN_SEAFOOD_PROGRAM_CODE,
} from './captain.constants';
import type { CaptainSeafoodConfigV3 } from './captain.types';

export type CaptainAttributionResult = 'credited' | 'skipped';

interface ProfitRateSnapshot {
  reward: number;
  industryFund: number;
  charity: number;
  tech: number;
  reserve: number;
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
    const config = this.asRecord(captain?.config) as unknown as CaptainSeafoodConfigV3 | null;
    const directCaptainUserId = this.asString(captain?.directCaptainUserId);
    const configVersion = this.asString(captain?.configVersion);
    const commissionBase = Number(snapshot.captainEligibleProfitAmount ?? 0);
    const distributableProfitAmount = Number(snapshot.distributableProfitAmount ?? 0);

    if (
      !config
      || config.schemaVersion !== 3
      || !config.enabled
      || config.programCode !== CAPTAIN_SEAFOOD_PROGRAM_CODE
      || !configVersion
      || !directCaptainUserId
      || captain?.relationStatus !== 'ACTIVE'
      || captain?.profileStatus !== 'ACTIVE'
      || captain?.exclusionReason != null
      || directCaptainUserId === snapshot.order.userId
      || snapshot.order.bizType !== 'NORMAL_GOODS'
      || !this.isPaidOnOrAfterEffectiveFrom(snapshot.order.paidAt, config.effectiveFrom)
      || !Number.isFinite(commissionBase)
      || !Number.isFinite(distributableProfitAmount)
      || commissionBase <= 0
      || distributableProfitAmount <= 0
      || commissionBase < Number(config.orderRules?.minCommissionBase ?? 0)
    ) {
      return 'skipped';
    }

    const buyerPath = ruleSnapshot?.buyerPath === 'VIP' ? 'vip' : 'normal';
    const rates = this.asRecord(
      this.asRecord(ruleSnapshot?.rates)?.[buyerPath],
    ) as unknown as ProfitRateSnapshot | null;
    const directInviter = this.asRecord(ruleSnapshot?.directInviter);
    if (!rates) return 'skipped';

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
        directReferralClaimed: Boolean(directInviter?.eligibleUserId),
        captainDirectProfitRate: Number(config.perOrderCommission.directProfitRate),
        monthlyProfitRates: [
          Number(config.monthlyRewards.baseManagementProfitRate),
          Number(config.monthlyRewards.growthBonusProfitRate),
          Number(config.monthlyRewards.cultivationBonusProfitRate),
          Number(config.monthlyRewards.performanceBonusProfitRate),
        ],
      });
    } catch {
      await this.createReconciliationTask(
        tx,
        snapshot,
        'CAPTAIN_FUNDING_INVALID_SNAPSHOT',
      );
      return 'skipped';
    }

    if (!funding.coveredByPlatformRetained) {
      await this.createReconciliationTask(
        tx,
        snapshot,
        'CAPTAIN_FUNDING_EXCEEDS_PLATFORM_RETAINED',
      );
      return 'skipped';
    }

    const configSnapshot = JSON.parse(JSON.stringify(config));
    const attribution = await (tx as any).captainOrderAttribution.create({
      data: {
        orderId,
        buyerUserId: snapshot.order.userId,
        directCaptainUserId,
        legacyIndirectCaptainUserId: null,
        programCode: config.programCode,
        commissionBase,
        eligibleGoodsAmount: commissionBase,
        couponDiscountAmount: Number(snapshot.couponDiscountAmount ?? 0),
        rewardDeductionAmount: Number(snapshot.rewardDeductionAmount ?? 0),
        directRate: config.perOrderCommission.directProfitRate,
        legacyIndirectRate: 0,
        status: 'FROZEN',
        configSnapshot,
        calculationModel: 'PROFIT_V3',
        profitSnapshotId: snapshot.id,
        profitConfigVersion: configVersion,
        profitBaseAmount: commissionBase,
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
        rate: config.perOrderCommission.directProfitRate,
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

  private isPaidOnOrAfterEffectiveFrom(paidAt: unknown, effectiveFrom: string): boolean {
    const effectiveAt = Date.parse(effectiveFrom);
    const paidAtMs = paidAt instanceof Date ? paidAt.getTime() : Date.parse(String(paidAt ?? ''));
    return Number.isFinite(effectiveAt) && Number.isFinite(paidAtMs) && paidAtMs >= effectiveAt;
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
