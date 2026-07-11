import { Injectable } from '@nestjs/common';
import { CaptainLedgerType, Prisma, RewardAccountType } from '@prisma/client';
import {
  allocateCentsByLargestRemainder,
  centsToYuan,
  checkedSafeIntegerSum,
  yuanToCents,
} from './money-allocation';

type Tx = Prisma.TransactionClient;

export type RefundProfitItem = {
  orderItemId: string;
  quantity: number;
  netGoodsRevenueCents: number;
  distributableProfitShareCents: number;
  captainEligible: boolean;
};

export type SuccessfulRefundItem = {
  refundId: string;
  orderItemId: string;
  /** Positive means quantity-based; zero is the persisted amount-only sentinel. */
  quantity: number;
  goodsAmountCents: number;
  channelRefundAmountCents?: number;
  refundedAt?: Date;
};

export type CumulativeRefundTarget = {
  orderItemId: string;
  cumulativeRefundRatio: number;
  cumulativeProfitTargetCents: number;
  refundedQuantity: number | null;
  refundedGoodsAmountCents: number;
  ratioNumerator: number;
  ratioDenominator: number;
};

export type RemainingProfitView = {
  originalDistributableProfitCents: number;
  originalCaptainEligibleProfitCents: number;
  refundedDistributableProfitCents: number;
  refundedCaptainEligibleProfitCents: number;
  remainingDistributableProfitCents: number;
  remainingCaptainEligibleProfitCents: number;
  remainingItemProfitCents: Record<string, number>;
};

export function assertRefundSourceCaps(input: {
  distributableProfitCents: number;
  captainEligibleProfitCents: number;
  memberSourceCents: number;
  captainSourceCents: number;
  fundingSources: Array<{ type: string; amountCents: number }>;
}): void {
  for (const [label, value] of Object.entries({
    distributableProfitCents: input.distributableProfitCents,
    captainEligibleProfitCents: input.captainEligibleProfitCents,
    memberSourceCents: input.memberSourceCents,
    captainSourceCents: input.captainSourceCents,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
  }
  if (input.memberSourceCents > input.distributableProfitCents) {
    throw new Error('member refund sources exceed original D');
  }
  if (input.captainSourceCents > input.captainEligibleProfitCents) {
    throw new Error('captain refund sources exceed original C');
  }
  for (const source of input.fundingSources) {
    if (!source.type || !Number.isSafeInteger(source.amountCents)) {
      throw new Error('funding source must contain a type and safe integer cents');
    }
    if (source.type === 'PLATFORM_RETAINED_CREDIT') {
      if (source.amountCents < 0) throw new Error('platform funding must not be negative');
      if (source.amountCents > input.distributableProfitCents) {
        throw new Error('platform funding exceeds original D');
      }
    } else if (Math.abs(source.amountCents) > input.captainEligibleProfitCents) {
      throw new Error('captain funding source exceeds original C');
    }
  }
  const fundingNetCents = checkedSafeIntegerSum(
    input.fundingSources.map((source) => source.amountCents),
  );
  if (fundingNetCents === null || fundingNetCents < 0) {
    throw new Error('signed funding net is invalid');
  }
  if (fundingNetCents > input.distributableProfitCents) {
    throw new Error('signed funding net exceeds original D');
  }
}

export type ProfitRefundFinalizeResult = {
  mode: 'V3' | 'LEGACY' | 'NOOP';
  orderId?: string;
  reversalCount?: number;
};

type PendingClawback = {
  sourceLedgerId: string;
  sourceLedgerType: string;
  userId: string;
  amountCents: number;
};

type CaptainMonthlyAmountField =
  | 'baseManagementAmount'
  | 'growthBonusAmount'
  | 'cultivationBonusAmount'
  | 'performanceBonusAmount';

const MEMBER_ACCOUNT_TYPES = new Set<RewardAccountType>([
  RewardAccountType.VIP_REWARD,
  RewardAccountType.NORMAL_REWARD,
  RewardAccountType.INDUSTRY_FUND,
]);
const CAPTAIN_MONTHLY_LEDGER_FIELDS: Partial<
  Record<CaptainLedgerType, CaptainMonthlyAmountField>
> = {
  [CaptainLedgerType.MANAGEMENT_ALLOWANCE]: 'baseManagementAmount',
  [CaptainLedgerType.GROWTH_BONUS]: 'growthBonusAmount',
  [CaptainLedgerType.CULTIVATION_BONUS]: 'cultivationBonusAmount',
  [CaptainLedgerType.PERFORMANCE_BONUS]: 'performanceBonusAmount',
};

function assertNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function roundRatioCents(amountCents: number, numerator: number, denominator: number): number {
  if (amountCents === 0 || numerator === 0) return 0;
  if (numerator >= denominator) return amountCents;
  const scaled = BigInt(amountCents) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const result = (scaled * 2n + divisor) / (2n * divisor);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('refund target exceeds the safe cent range');
  }
  return Number(result);
}

export function buildCumulativeRefundTargets(
  items: RefundProfitItem[],
  refundItems: SuccessfulRefundItem[],
): Record<string, CumulativeRefundTarget> {
  const targets: Record<string, CumulativeRefundTarget> = {};
  const knownIds = new Set<string>();

  for (const refundItem of refundItems) {
    if (!Number.isSafeInteger(refundItem.quantity) || refundItem.quantity < 0) {
      throw new Error('refund quantity must be zero or a positive integer');
    }
  }

  for (const item of [...items].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId))) {
    if (!item.orderItemId || knownIds.has(item.orderItemId)) {
      throw new Error('profit snapshot contains duplicate order items');
    }
    knownIds.add(item.orderItemId);
    const quantity = assertNonNegativeSafeInteger(item.quantity, 'item quantity');
    if (quantity <= 0) throw new Error('item quantity must be positive');
    const netGoodsRevenueCents = assertNonNegativeSafeInteger(
      item.netGoodsRevenueCents,
      'item net goods revenue',
    );
    const profitShareCents = assertNonNegativeSafeInteger(
      item.distributableProfitShareCents,
      'item distributable profit share',
    );

    const facts = refundItems.filter((entry) => entry.orderItemId === item.orderItemId);
    const quantityFacts = facts.filter(
      (entry) => entry.quantity > 0,
    );
    let ratioNumerator: number;
    let ratioDenominator: number;
    let refundedQuantity: number | null;

    if (quantityFacts.length > 0) {
      const quantitySum = checkedSafeIntegerSum(quantityFacts.map((entry) => Number(entry.quantity)));
      if (quantitySum === null) throw new Error('refunded quantity exceeds the safe range');
      ratioNumerator = Math.min(quantity, quantitySum);
      ratioDenominator = quantity;
      refundedQuantity = ratioNumerator;
    } else {
      const amountSum = checkedSafeIntegerSum(
        facts.map((entry) => assertNonNegativeSafeInteger(entry.goodsAmountCents, 'refund goods amount')),
      );
      if (amountSum === null) throw new Error('refunded goods amount exceeds the safe range');
      ratioNumerator = Math.min(netGoodsRevenueCents, amountSum);
      ratioDenominator = Math.max(1, netGoodsRevenueCents);
      refundedQuantity = null;
    }

    const refundedGoodsAmount = checkedSafeIntegerSum(
      facts.map((entry) => assertNonNegativeSafeInteger(entry.goodsAmountCents, 'refund goods amount')),
    );
    if (refundedGoodsAmount === null) throw new Error('refunded goods amount exceeds the safe range');
    const cumulativeProfitTargetCents = roundRatioCents(
      profitShareCents,
      ratioNumerator,
      ratioDenominator,
    );
    targets[item.orderItemId] = {
      orderItemId: item.orderItemId,
      cumulativeRefundRatio: ratioNumerator / ratioDenominator,
      cumulativeProfitTargetCents,
      refundedQuantity,
      refundedGoodsAmountCents: refundedGoodsAmount,
      ratioNumerator,
      ratioDenominator,
    };
  }

  for (const refundItem of refundItems) {
    if (!knownIds.has(refundItem.orderItemId)) {
      throw new Error(`refund item ${refundItem.orderItemId} is absent from the profit snapshot`);
    }
  }
  return targets;
}

export function buildRemainingProfitView(
  items: RefundProfitItem[],
  refundItems: SuccessfulRefundItem[],
): RemainingProfitView {
  const targets = buildCumulativeRefundTargets(items, refundItems);
  const originalDistributableProfitCents = checkedSafeIntegerSum(
    items.map((item) => item.distributableProfitShareCents),
  );
  const originalCaptainEligibleProfitCents = checkedSafeIntegerSum(
    items.filter((item) => item.captainEligible).map((item) => item.distributableProfitShareCents),
  );
  if (originalDistributableProfitCents === null || originalCaptainEligibleProfitCents === null) {
    throw new Error('profit item totals exceed the safe cent range');
  }

  const remainingItemProfitCents: Record<string, number> = {};
  let refundedDistributableProfitCents = 0;
  let refundedCaptainEligibleProfitCents = 0;
  for (const item of items) {
    const refunded = targets[item.orderItemId].cumulativeProfitTargetCents;
    remainingItemProfitCents[item.orderItemId] = item.distributableProfitShareCents - refunded;
    refundedDistributableProfitCents += refunded;
    if (item.captainEligible) refundedCaptainEligibleProfitCents += refunded;
  }
  if (
    !Number.isSafeInteger(refundedDistributableProfitCents)
    || !Number.isSafeInteger(refundedCaptainEligibleProfitCents)
  ) {
    throw new Error('refunded profit totals exceed the safe cent range');
  }

  return {
    originalDistributableProfitCents,
    originalCaptainEligibleProfitCents,
    refundedDistributableProfitCents,
    refundedCaptainEligibleProfitCents,
    remainingDistributableProfitCents:
      originalDistributableProfitCents - refundedDistributableProfitCents,
    remainingCaptainEligibleProfitCents:
      originalCaptainEligibleProfitCents - refundedCaptainEligibleProfitCents,
    remainingItemProfitCents,
  };
}

@Injectable()
export class OrderProfitRefundService {
  async finalizeSuccessfulRefund(
    tx: Tx,
    refundId: string,
  ): Promise<ProfitRefundFinalizeResult> {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: { items: true },
    });
    if (!refund || refund.status !== 'REFUNDED') return { mode: 'NOOP' };

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('order-profit-refund-v3'),
        hashtext(${refund.orderId})
      )
    `;

    const snapshot = await tx.orderProfitSnapshot.findFirst({
      where: { orderId: refund.orderId, isCurrent: true },
      orderBy: { revision: 'desc' },
    });
    if (!snapshot) return { mode: 'LEGACY', orderId: refund.orderId };
    if (snapshot.status !== 'READY') return { mode: 'NOOP', orderId: refund.orderId };

    const items = this.readProfitItems(snapshot.itemBreakdown);
    const successfulRefunds = await tx.refund.findMany({
      where: { orderId: refund.orderId, status: 'REFUNDED', deletedAt: null },
      include: { items: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const incompleteRefund = successfulRefunds.find(
      (successfulRefund) => !Array.isArray(successfulRefund.items) || successfulRefund.items.length === 0,
    );
    if (incompleteRefund) {
      throw new Error(
        `successful V3 refund ${incompleteRefund.id} is missing line-level facts`,
      );
    }
    const allRefundItems = this.flattenRefundItems(successfulRefunds);

    const adjustmentDrafts = await tx.orderProfitAdjustmentDraft.findMany({
      where: { orderId: refund.orderId, status: { in: ['PENDING', 'APPLIED'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const targets = buildCumulativeRefundTargets(items, allRefundItems);
    const profitView = buildRemainingProfitView(items, allRefundItems);
    if (
      profitView.originalDistributableProfitCents !== yuanToCents(snapshot.distributableProfitAmount)
      || profitView.originalCaptainEligibleProfitCents
        !== yuanToCents(snapshot.captainEligibleProfitAmount)
    ) {
      throw new Error('profit snapshot item totals do not match D/C');
    }
    const priorReversals = await tx.orderProfitRefundReversal.findMany({
      where: { orderId: refund.orderId, snapshotId: snapshot.id },
    });
    const pending: PendingClawback[] = [];
    const currentRecovered = new Map<string, number>();
    let reversalCount = 0;

    const memberSources = await tx.rewardLedger.findMany({
      where: {
        amount: { gt: 0 },
        refType: 'ORDER',
        refId: refund.orderId,
        allocation: { orderId: refund.orderId },
        status: { in: ['FROZEN', 'AVAILABLE', 'WITHDRAWN', 'RETURN_FROZEN'] },
        account: { type: { in: [...MEMBER_ACCOUNT_TYPES, RewardAccountType.PLATFORM_PROFIT] } },
      },
      include: { account: { select: { id: true, type: true, balance: true, frozen: true } } },
    });
    const refundableMemberSources = memberSources.filter((row: any) =>
      this.isRefundableMemberSource(row));
    const memberSourceCents = checkedSafeIntegerSum(
      refundableMemberSources.map((source: any) =>
        this.originalSourceAmountCents(source, priorReversals)),
    );
    if (memberSourceCents === null) throw new Error('member refund sources exceed the safe cent range');

    const attribution = await tx.captainOrderAttribution.findFirst({
      where: {
        orderId: refund.orderId,
        profitSnapshotId: snapshot.id,
        calculationModel: 'PROFIT_V3',
      },
    });
    const captainLedgers = attribution
      ? await tx.captainCommissionLedger.findMany({
          where: {
            OR: [
              { orderAttributionId: attribution.id, type: 'DIRECT_ORDER' },
              { settlement: { settlementOrders: { some: { orderAttributionId: attribution.id } } } },
            ],
            deletedAt: null,
          },
        })
      : [];
    const directCaptainLedgers = captainLedgers.filter((row: any) =>
      row.orderAttributionId === attribution?.id && row.type === 'DIRECT_ORDER');
    const directCaptainSourceCents = checkedSafeIntegerSum(
      directCaptainLedgers.map((source: any) =>
        this.originalSourceAmountCents(source, priorReversals)),
    );
    if (directCaptainSourceCents === null) {
      throw new Error('captain refund sources exceed the safe cent range');
    }
    const settlementOrder = attribution
      ? await tx.captainMonthlySettlementOrder.findUnique({
          where: { orderAttributionId: attribution.id },
          include: { settlement: true },
        })
      : null;
    const monthlySourceCents = settlementOrder
      && ['APPROVED', 'PENDING_REVIEW', 'PAID'].includes(settlementOrder.settlement?.status)
      ? checkedSafeIntegerSum([
          settlementOrder.baseManagementAmount,
          settlementOrder.growthBonusAmount,
          settlementOrder.cultivationBonusAmount,
          settlementOrder.performanceBonusAmount,
        ].map((amount) => yuanToCents(amount ?? 0)))
      : 0;
    if (monthlySourceCents === null) {
      throw new Error('captain monthly refund sources exceed the safe cent range');
    }
    const fundingSources = await tx.orderProfitFundingLedger.findMany({
      where: {
        orderId: refund.orderId,
        snapshotId: snapshot.id,
        type: { not: 'REFUND_ADJUSTMENT' },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    assertRefundSourceCaps({
      distributableProfitCents: profitView.originalDistributableProfitCents,
      captainEligibleProfitCents: profitView.originalCaptainEligibleProfitCents,
      memberSourceCents,
      captainSourceCents: directCaptainSourceCents + monthlySourceCents,
      fundingSources: fundingSources.map((source) => ({
        type: source.type,
        amountCents: yuanToCents(source.amount),
      })),
    });

    for (const source of refundableMemberSources) {
      const originalAmountCents = this.originalSourceAmountCents(source, priorReversals);
      const applied = await this.reverseSourceByItems(tx, {
        refund,
        snapshot,
        sourceLedgerId: source.id,
        sourceLedgerType: 'MEMBER_REWARD',
        originalAmountCents,
        items,
        targets,
        priorReversals,
        captainOnly: false,
      });
      reversalCount += applied.rows;
      if (applied.incrementCents > 0) {
        const recovery = await this.applyMemberReversal(tx, source, refundId, applied.incrementCents);
        currentRecovered.set(
          source.id,
          (currentRecovered.get(source.id) ?? 0) + recovery.recoveredCents,
        );
        if (recovery.pendingCents > 0) pending.push({
          sourceLedgerId: source.id,
          sourceLedgerType: 'MEMBER_REWARD',
          userId: source.userId,
          amountCents: recovery.pendingCents,
        });
      }
    }

    if (attribution) {
      const eligibleRefundCents = checkedSafeIntegerSum(
        items
          .filter((item) => item.captainEligible)
          .map((item) => {
            const target = targets[item.orderItemId];
            return roundRatioCents(
              item.netGoodsRevenueCents,
              target.ratioNumerator,
              target.ratioDenominator,
            );
          }),
      );
      if (eligibleRefundCents === null) {
        throw new Error('captain eligible refunded GMV exceeds the safe cent range');
      }
      const eligibleGoodsCents = yuanToCents(attribution.eligibleGoodsAmount ?? 0);
      await tx.captainOrderAttribution.update({
        where: { id: attribution.id },
        data: {
          refundAmount: centsToYuan(Math.min(eligibleGoodsCents, eligibleRefundCents)),
        },
      });
      for (const source of directCaptainLedgers) {
        const originalAmountCents = this.originalSourceAmountCents(source, priorReversals);
        const applied = await this.reverseSourceByItems(tx, {
          refund,
          snapshot,
          sourceLedgerId: source.id,
          sourceLedgerType: 'CAPTAIN_DIRECT',
          originalAmountCents,
          items,
          targets,
          priorReversals,
          captainOnly: true,
        });
        reversalCount += applied.rows;
        if (applied.incrementCents > 0) {
          const recovery = await this.applyCaptainReversal(
            tx,
            source,
            attribution,
            refundId,
            applied.incrementCents,
            'CAPTAIN_DIRECT',
          );
          currentRecovered.set(
            source.id,
            (currentRecovered.get(source.id) ?? 0) + recovery.recoveredCents,
          );
          if (recovery.pendingCents > 0) pending.push({
            sourceLedgerId: source.id,
            sourceLedgerType: 'CAPTAIN_DIRECT',
            userId: source.userId,
            amountCents: recovery.pendingCents,
          });
        }
      }
      reversalCount += await this.reverseMonthlySources(
        tx,
        refund,
        snapshot,
        attribution,
        captainLedgers,
        items,
        targets,
        priorReversals,
        pending,
        settlementOrder,
        currentRecovered,
      );
    }

    for (const source of fundingSources) {
      const captainOnly = source.type !== 'PLATFORM_RETAINED_CREDIT';
      const applied = await this.reverseSourceByItems(tx, {
        refund,
        snapshot,
        sourceLedgerId: source.id,
        sourceLedgerType: `FUNDING:${source.type}`,
        originalAmountCents: Math.abs(yuanToCents(source.amount)),
        items,
        targets,
        priorReversals,
        captainOnly,
      });
      reversalCount += applied.rows;
      if (applied.incrementCents > 0) {
        const direction = yuanToCents(source.amount) >= 0 ? -1 : 1;
        await tx.orderProfitFundingLedger.create({
          data: {
            snapshotId: snapshot.id,
            orderId: refund.orderId,
            type: 'REFUND_ADJUSTMENT',
            amount: centsToYuan(direction * applied.incrementCents),
            configVersion: source.configVersion,
            sourceLedgerId: source.id,
            idempotencyKey: `profit:refund:${refundId}:funding:${source.id}`,
            meta: {
              refundId,
              sourceType: source.type,
              cumulativeTargetReversal: centsToYuan(applied.cumulativeTargetCents),
            },
          },
        });
      }
    }

    const unresolved = reversalCount > 0
      ? await this.buildOutstandingClawbacks(
          tx,
          refund,
          snapshot,
          adjustmentDrafts,
          pending,
          currentRecovered,
        )
      : [];
    if (reversalCount > 0) {
      await tx.orderProfitAdjustmentDraft.updateMany({
        where: { orderId: refund.orderId, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      });
    }
    if (reversalCount > 0 && unresolved.length > 0) {
      await tx.orderProfitAdjustmentDraft.create({
        data: {
          orderId: refund.orderId,
          sourceSnapshotId: snapshot.id,
          targetSnapshotId: snapshot.id,
          status: 'PENDING',
          adjustments: {
            reason: 'CLAWBACK_PENDING',
            refundId,
            sources: unresolved.map((item) => ({
              ...item,
              amount: centsToYuan(item.amountCents),
            })),
          },
          idempotencyKey: `profit:refund:${refundId}:clawback`,
        },
      });
    }

    return { mode: 'V3', orderId: refund.orderId, reversalCount };
  }

  private readProfitItems(value: unknown): RefundProfitItem[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error('profit snapshot item breakdown is missing');
    }
    return value.map((raw) => {
      if (!raw || typeof raw !== 'object') throw new Error('profit snapshot item is invalid');
      const row = raw as Record<string, unknown>;
      if (typeof row.orderItemId !== 'string' || typeof row.captainEligible !== 'boolean') {
        throw new Error('profit snapshot item identity is invalid');
      }
      return {
        orderItemId: row.orderItemId,
        quantity: assertNonNegativeSafeInteger(row.quantity, 'item quantity'),
        netGoodsRevenueCents: assertNonNegativeSafeInteger(
          row.netGoodsRevenueCents,
          'item net goods revenue',
        ),
        distributableProfitShareCents: assertNonNegativeSafeInteger(
          row.distributableProfitShareCents,
          'item distributable profit share',
        ),
        captainEligible: row.captainEligible,
      };
    });
  }

  private flattenRefundItems(refunds: any[]): SuccessfulRefundItem[] {
    return refunds.flatMap((refund) => (refund.items ?? []).map((item: any) => ({
      refundId: refund.id,
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      goodsAmountCents: yuanToCents(item.amount),
      channelRefundAmountCents: yuanToCents(refund.amount ?? item.amount),
      refundedAt: item.createdAt ?? refund.updatedAt ?? refund.createdAt,
    })));
  }

  private isRefundableMemberSource(source: any): boolean {
    if (MEMBER_ACCOUNT_TYPES.has(source.account?.type)) return true;
    if (source.account?.type !== RewardAccountType.PLATFORM_PROFIT) return false;
    return source.meta?.scheme === 'VIP_UPSTREAM_FALLBACK'
      || source.meta?.scheme === 'NORMAL_TREE_FALLBACK';
  }

  private async buildOutstandingClawbacks(
    tx: Tx,
    refund: any,
    snapshot: any,
    drafts: any[],
    currentPending: PendingClawback[],
    currentRecovered: Map<string, number>,
  ): Promise<PendingClawback[]> {
    const reversals = await tx.orderProfitRefundReversal.findMany({
      where: { orderId: refund.orderId, snapshotId: snapshot.id },
    });
    const targets = new Map<string, number>();
    const metadata = new Map<string, Omit<PendingClawback, 'amountCents'>>();
    for (const reversal of reversals) {
      const sourceLedgerId = reversal.sourceLedgerId;
      targets.set(
        sourceLedgerId,
        (targets.get(sourceLedgerId) ?? 0) + yuanToCents(reversal.incrementalReversal),
      );
    }
    for (const draft of drafts) {
      const sources = Array.isArray(draft?.adjustments?.sources)
        ? draft.adjustments.sources
        : [];
      for (const source of sources) {
        if (typeof source?.sourceLedgerId !== 'string') continue;
        metadata.set(source.sourceLedgerId, {
          sourceLedgerId: source.sourceLedgerId,
          sourceLedgerType: String(source.sourceLedgerType ?? 'UNKNOWN'),
          userId: String(source.userId ?? ''),
        });
      }
    }
    for (const source of currentPending) {
      metadata.set(source.sourceLedgerId, {
        sourceLedgerId: source.sourceLedgerId,
        sourceLedgerType: source.sourceLedgerType,
        userId: source.userId,
      });
    }
    const sourceIds = [...targets.keys()];
    const [rewardRecoveries, captainRecoveries] = sourceIds.length > 0
      ? await Promise.all([
          tx.rewardLedger.findMany({
            where: {
              sourceLedgerId: { in: sourceIds },
              refType: 'REFUND',
              refId: { not: refund.id },
              amount: { lt: 0 },
            },
            select: { sourceLedgerId: true, userId: true, meta: true },
          }),
          tx.captainCommissionLedger.findMany({
            where: {
              orderId: refund.orderId,
              refType: 'REFUND',
              refId: { not: refund.id },
              type: 'VOID',
              amount: { lt: 0 },
            },
            select: { userId: true, meta: true },
          }),
        ])
      : [[], []];
    const recovered = new Map(currentRecovered);
    for (const ledger of rewardRecoveries as any[]) {
      if (typeof ledger.sourceLedgerId !== 'string') continue;
      const cents = yuanToCents(Number(ledger.meta?.recoveredAmount ?? 0));
      recovered.set(ledger.sourceLedgerId, (recovered.get(ledger.sourceLedgerId) ?? 0) + cents);
      if (!metadata.has(ledger.sourceLedgerId)) {
        metadata.set(ledger.sourceLedgerId, {
          sourceLedgerId: ledger.sourceLedgerId,
          sourceLedgerType: 'MEMBER_REWARD',
          userId: ledger.userId,
        });
      }
    }
    for (const ledger of captainRecoveries as any[]) {
      const sourceLedgerId = ledger.meta?.originalLedgerId;
      if (typeof sourceLedgerId !== 'string') continue;
      const cents = yuanToCents(Number(ledger.meta?.recoveredAmount ?? 0));
      recovered.set(sourceLedgerId, (recovered.get(sourceLedgerId) ?? 0) + cents);
      if (!metadata.has(sourceLedgerId)) {
        metadata.set(sourceLedgerId, {
          sourceLedgerId,
          sourceLedgerType: String(ledger.meta?.sourceType ?? 'CAPTAIN_REWARD'),
          userId: ledger.userId,
        });
      }
    }
    for (const draft of drafts.filter((item) => item.status === 'APPLIED')) {
      const sources = Array.isArray(draft?.adjustments?.sources)
        ? draft.adjustments.sources
        : [];
      for (const source of sources) {
        if (typeof source?.sourceLedgerId !== 'string') continue;
        const cents = Number.isSafeInteger(source.amountCents)
          ? Number(source.amountCents)
          : yuanToCents(Number(source.amount ?? 0));
        recovered.set(
          source.sourceLedgerId,
          (recovered.get(source.sourceLedgerId) ?? 0) + Math.max(0, cents),
        );
      }
    }
    return sourceIds
      .map((sourceLedgerId) => {
        const amountCents = Math.max(
          0,
          (targets.get(sourceLedgerId) ?? 0) - (recovered.get(sourceLedgerId) ?? 0),
        );
        const meta = metadata.get(sourceLedgerId);
        return meta && amountCents > 0 ? { ...meta, amountCents } : null;
      })
      .filter((item): item is PendingClawback => item !== null)
      .sort((a, b) => a.sourceLedgerId.localeCompare(b.sourceLedgerId));
  }

  private allocateSourceAcrossItems(
    sourceCents: number,
    items: RefundProfitItem[],
    captainOnly: boolean,
  ): Record<string, number> {
    const weighted = items.filter((item) =>
      item.distributableProfitShareCents > 0 && (!captainOnly || item.captainEligible));
    if (sourceCents === 0 || weighted.length === 0) return {};
    const result = allocateCentsByLargestRemainder(
      sourceCents,
      weighted.map((item) => ({
        id: item.orderItemId,
        weightCents: item.distributableProfitShareCents,
        capacityCents: sourceCents,
      })),
    );
    if (result.unallocatedCents !== 0) throw new Error('source ledger cannot be allocated to items');
    return result.allocations;
  }

  private async reverseSourceByItems(tx: Tx, params: {
    refund: any;
    snapshot: any;
    sourceLedgerId: string;
    sourceLedgerType: string;
    originalAmountCents: number;
    items: RefundProfitItem[];
    targets: Record<string, CumulativeRefundTarget>;
    priorReversals: any[];
    captainOnly: boolean;
  }): Promise<{ rows: number; incrementCents: number; cumulativeTargetCents: number }> {
    const allocations = this.allocateSourceAcrossItems(
      params.originalAmountCents,
      params.items,
      params.captainOnly,
    );
    let rows = 0;
    let incrementCents = 0;
    let cumulativeTargetCents = 0;
    for (const item of params.items) {
      const sourceItemCents = allocations[item.orderItemId] ?? 0;
      if (sourceItemCents <= 0) continue;
      const target = params.targets[item.orderItemId];
      const cumulative = roundRatioCents(
        sourceItemCents,
        target.ratioNumerator,
        target.ratioDenominator,
      );
      cumulativeTargetCents += cumulative;
      const already = params.priorReversals
        .filter((row) => row.sourceLedgerId === params.sourceLedgerId && row.orderItemId === item.orderItemId)
        .reduce((sum, row) => sum + yuanToCents(row.incrementalReversal), 0);
      const incremental = Math.max(0, cumulative - already);
      if (incremental === 0) continue;
      const currentRefundItem = (params.refund.items ?? []).find(
        (row: any) => row.orderItemId === item.orderItemId,
      );
      await tx.orderProfitRefundReversal.create({
        data: {
          orderId: params.refund.orderId,
          snapshotId: params.snapshot.id,
          refundId: params.refund.id,
          orderItemId: item.orderItemId,
          sourceLedgerId: params.sourceLedgerId,
          sourceLedgerType: params.sourceLedgerType,
          refundedQuantity: currentRefundItem?.quantity > 0 ? currentRefundItem.quantity : null,
          refundedGoodsAmount: Number(currentRefundItem?.amount ?? 0),
          cumulativeRefundRatio: target.cumulativeRefundRatio,
          cumulativeTargetReversal: centsToYuan(cumulative),
          incrementalReversal: centsToYuan(incremental),
        },
      });
      rows += 1;
      incrementCents += incremental;
    }
    return { rows, incrementCents, cumulativeTargetCents };
  }

  private async applyMemberReversal(
    tx: Tx,
    source: any,
    refundId: string,
    amountCents: number,
  ): Promise<{ pendingCents: number; recoveredCents: number }> {
    const amount = centsToYuan(amountCents);
    let recoveredCents = 0;
    if (source.status === 'FROZEN') {
      const result = await tx.rewardAccount.updateMany({
        where: { id: source.accountId, frozen: { gte: amount } },
        data: { frozen: { decrement: amount } },
      });
      recoveredCents = result.count > 0 ? amountCents : 0;
    } else if (source.status === 'RETURN_FROZEN') {
      recoveredCents = amountCents;
    } else if (source.status === 'AVAILABLE') {
      const account = await tx.rewardAccount.findUnique({ where: { id: source.accountId } });
      recoveredCents = Math.min(amountCents, Math.max(0, yuanToCents(account?.balance ?? 0)));
      if (recoveredCents > 0) {
        await tx.rewardAccount.update({
          where: { id: source.accountId },
          data: { balance: { decrement: centsToYuan(recoveredCents) } },
        });
      }
    }
    const pendingCents = amountCents - recoveredCents;
    if (source.status !== 'WITHDRAWN') {
      const remainingCents = Math.max(0, yuanToCents(source.amount) - amountCents);
      await tx.rewardLedger.update({
        where: { id: source.id },
        data: {
          amount: centsToYuan(remainingCents),
          status: remainingCents === 0 ? 'VOIDED' : source.status,
        },
      });
    }
    await tx.rewardLedger.create({
      data: {
        allocationId: source.allocationId,
        accountId: source.accountId,
        userId: source.userId,
        entryType: 'VOID',
        amount: -amount,
        status: pendingCents > 0 ? 'RETURN_FROZEN' : 'VOIDED',
        refType: 'REFUND',
        refId: refundId,
        idempotencyKey: `profit:refund:${refundId}:reward:${source.id}`,
        sourceLedgerId: source.id,
        meta: {
          scheme: 'PROFIT_V3_REFUND_REVERSAL',
          originalStatus: source.status,
          clawbackStatus: pendingCents > 0 ? 'CLAWBACK_PENDING' : undefined,
          recoveredAmount: centsToYuan(recoveredCents),
          clawbackAmount: centsToYuan(pendingCents),
        },
      },
    });
    return { pendingCents, recoveredCents };
  }

  private async applyCaptainReversal(
    tx: Tx,
    source: any,
    attribution: any,
    refundId: string,
    amountCents: number,
    sourceType: string,
    mutateSource = true,
  ): Promise<{ pendingCents: number; recoveredCents: number }> {
    const amount = centsToYuan(amountCents);
    let recoveredCents = 0;
    if (source.status === 'FROZEN') {
      const account = await tx.captainAccount.findUnique({ where: { id: source.accountId } });
      recoveredCents = Math.min(amountCents, Math.max(0, yuanToCents(account?.frozen ?? 0)));
      if (recoveredCents > 0) await tx.captainAccount.update({
        where: { id: source.accountId },
        data: { frozen: { decrement: centsToYuan(recoveredCents) } },
      });
    } else if (source.status === 'AVAILABLE') {
      const account = await tx.captainAccount.findUnique({ where: { id: source.accountId } });
      recoveredCents = Math.min(amountCents, Math.max(0, yuanToCents(account?.balance ?? 0)));
      if (recoveredCents > 0) await tx.captainAccount.update({
        where: { id: source.accountId },
        data: { balance: { decrement: centsToYuan(recoveredCents) } },
      });
    }
    const pendingCents = amountCents - recoveredCents;
    if (pendingCents > 0) await tx.captainAccount.update({
      where: { id: source.accountId },
      data: { clawback: { increment: centsToYuan(pendingCents) } },
    });
    if (mutateSource && source.status !== 'WITHDRAWN') {
      const remainingCents = Math.max(0, yuanToCents(source.amount) - amountCents);
      await tx.captainCommissionLedger.update({
        where: { id: source.id },
        data: {
          amount: centsToYuan(remainingCents),
          status: remainingCents === 0 ? 'VOIDED' : source.status,
        },
      });
    }
    await tx.captainCommissionLedger.create({
      data: {
        accountId: source.accountId,
        userId: source.userId,
        orderAttributionId: source.orderAttributionId ?? attribution?.id ?? null,
        orderId: attribution?.orderId ?? source.orderId ?? null,
        settlementId: source.settlementId ?? null,
        programCode: source.programCode,
        type: 'VOID',
        status: pendingCents > 0 ? 'CLAWBACK_PENDING' : 'VOIDED',
        amount: -amount,
        idempotencyKey: `profit:refund:${refundId}:captain:${source.id}`,
        refType: 'REFUND',
        refId: refundId,
        configSnapshot: source.configSnapshot,
        meta: {
          calculationModel: 'PROFIT_V3_REFUND_REVERSAL',
          sourceType,
          originalLedgerId: source.id,
          originalStatus: source.status,
          recoveredAmount: centsToYuan(recoveredCents),
          clawbackAmount: centsToYuan(pendingCents),
        },
      },
    });
    return { pendingCents, recoveredCents };
  }

  private async reverseMonthlySources(
    tx: Tx,
    refund: any,
    snapshot: any,
    attribution: any,
    captainLedgers: any[],
    items: RefundProfitItem[],
    targets: Record<string, CumulativeRefundTarget>,
    priorReversals: any[],
    pending: PendingClawback[],
    settlementOrder: any,
    currentRecovered: Map<string, number>,
  ): Promise<number> {
    if (
      !settlementOrder
      || !['APPROVED', 'PENDING_REVIEW', 'PAID'].includes(settlementOrder.settlement?.status)
    ) return 0;

    let rows = 0;
    let reversedCents = 0;
    for (const source of captainLedgers) {
      if (source.settlementId !== settlementOrder.settlementId) continue;
      const field = CAPTAIN_MONTHLY_LEDGER_FIELDS[source.type as CaptainLedgerType];
      if (!field) continue;
      const orderSourceCents = yuanToCents(settlementOrder[field] ?? 0);
      if (orderSourceCents <= 0) continue;
      const applied = await this.reverseSourceByItems(tx, {
        refund,
        snapshot,
        sourceLedgerId: source.id,
        sourceLedgerType: 'CAPTAIN_MONTHLY',
        originalAmountCents: orderSourceCents,
        items,
        targets,
        priorReversals,
        captainOnly: true,
      });
      rows += applied.rows;
      reversedCents += applied.incrementCents;
      if (applied.incrementCents <= 0) continue;
      if (settlementOrder.settlement.status !== 'PAID') {
        const amount = centsToYuan(applied.incrementCents);
        await tx.captainCommissionLedger.update({
          where: { id: source.id },
          data: { amount: { decrement: amount } },
        });
        const recovery = await this.applyCaptainReversal(
          tx,
          { ...source, amount: orderSourceCents / 100 },
          attribution,
          refund.id,
          applied.incrementCents,
          'CAPTAIN_MONTHLY',
          false,
        );
        currentRecovered.set(
          source.id,
          (currentRecovered.get(source.id) ?? 0) + recovery.recoveredCents,
        );
        if (recovery.pendingCents > 0) pending.push({
          sourceLedgerId: source.id,
          sourceLedgerType: 'CAPTAIN_MONTHLY',
          userId: source.userId,
          amountCents: recovery.pendingCents,
        });
        const settlementTotalCents = Math.max(
          1,
          yuanToCents(settlementOrder.settlement.totalAmount ?? 0),
        );
        const settlementTaxCents = Math.max(
          0,
          yuanToCents(settlementOrder.settlement.taxAmount ?? 0),
        );
        const taxReductionCents = Math.min(
          settlementTaxCents,
          roundRatioCents(applied.incrementCents, settlementTaxCents, settlementTotalCents),
        );
        await tx.captainMonthlySettlement.update({
          where: { id: settlementOrder.settlementId },
          data: {
            [field]: { decrement: amount },
            totalAmount: { decrement: amount },
            taxAmount: { decrement: centsToYuan(taxReductionCents) },
            netAmount: { decrement: centsToYuan(applied.incrementCents - taxReductionCents) },
            status: 'PENDING_REVIEW',
          },
        });
      } else {
        const recovery = await this.applyCaptainReversal(
          tx,
          source,
          attribution,
          refund.id,
          applied.incrementCents,
          'CAPTAIN_MONTHLY',
        );
        currentRecovered.set(
          source.id,
          (currentRecovered.get(source.id) ?? 0) + recovery.recoveredCents,
        );
        if (recovery.pendingCents > 0) pending.push({
          sourceLedgerId: source.id,
          sourceLedgerType: 'CAPTAIN_MONTHLY',
          userId: source.userId,
          amountCents: recovery.pendingCents,
        });
      }
    }
    if (reversedCents > 0) {
      await tx.captainMonthlySettlementOrder.update({
        where: { id: settlementOrder.id },
        data: { reversedAmount: { increment: centsToYuan(reversedCents) } },
      });
    }
    return rows;
  }

  private originalSourceAmountCents(source: any, priorReversals: any[]): number {
    const currentCents = yuanToCents(source.amount);
    if (source.status === 'WITHDRAWN') return currentCents;
    const reversedCents = priorReversals
      .filter((row) => row.sourceLedgerId === source.id)
      .reduce((sum, row) => sum + yuanToCents(row.incrementalReversal), 0);
    const original = currentCents + reversedCents;
    if (!Number.isSafeInteger(original) || original < 0) {
      throw new Error('source ledger original amount is invalid');
    }
    return original;
  }
}
