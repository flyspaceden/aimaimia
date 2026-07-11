import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { OrderProfitRefundService } from '../../profit/order-profit-refund.service';
import {
  ListProfitAdjustmentsDto,
  ListProfitReconciliationsDto,
} from './admin-profit-reconciliation.dto';
import { AdminProfitReconciliationService } from './admin-profit-reconciliation.service';

const validCorrections = [
  { orderItemId: 'item-a', unitCostCents: 2_000 },
  { orderItemId: 'item-b', unitCostCents: 2_000 },
];

function makeSourceSnapshot() {
  return {
    id: 'snapshot-1',
    orderId: 'order-1',
    revision: 1,
    isCurrent: true,
    status: 'RECONCILIATION_REQUIRED',
    grossGoodsAmount: 150,
    shippingAmount: 0,
    vipDiscountAmount: 0,
    couponDiscountAmount: 0,
    rewardDeductionAmount: 0,
    groupBuyRebateDeductionAmount: 0,
    otherGoodsDiscountAmount: 0,
    netGoodsRevenue: 150,
    productCostAmount: 0,
    distributableProfitAmount: 0,
    captainEligibleProfitAmount: 0,
    calculationVersion: 'discounted-profit-v1',
    itemBreakdown: [
      {
        orderItemId: 'item-a', quantity: 2, unitPriceCents: 5_000, unitCostCents: 0,
        grossGoodsAmountCents: 10_000, explicitDiscountCents: 0, vipDiscountCents: 0,
        rewardDeductionCents: 0, groupBuyRebateDeductionCents: 0,
        couponDiscountCents: 0, totalDiscountCents: 0, netGoodsRevenueCents: 10_000,
        productCostCents: 0, grossProfitCents: 10_000,
        distributableProfitShareCents: 0, captainEligible: true,
      },
      {
        orderItemId: 'item-b', quantity: 1, unitPriceCents: 5_000, unitCostCents: 0,
        grossGoodsAmountCents: 5_000, explicitDiscountCents: 0, vipDiscountCents: 0,
        rewardDeductionCents: 0, groupBuyRebateDeductionCents: 0,
        couponDiscountCents: 0, totalDiscountCents: 0, netGoodsRevenueCents: 5_000,
        productCostCents: 0, grossProfitCents: 5_000,
        distributableProfitShareCents: 0, captainEligible: true,
      },
    ],
    ruleSnapshot: {
      buyerPath: 'NORMAL',
      buyerTierAtPayment: 'NORMAL',
      vipNormalConfigVersion: 'rules-1',
      directInviter: {
        userId: 'inviter-1', eligibleUserId: 'inviter-1', tier: 'NORMAL', path: 'NORMAL',
        effectiveDirectRate: 0.1,
      },
      rates: {
        vip: {
          platform: 0.5, reward: 0.2, directReferral: 0.1, industryFund: 0.1,
          charity: 0.03, tech: 0.03, reserve: 0.04,
        },
        normal: {
          platform: 0.5, reward: 0.2, directReferral: 0.1, industryFund: 0.1,
          charity: 0.03, tech: 0.03, reserve: 0.04,
        },
      },
      captain: {
        directCaptainUserId: 'captain-1', relationStatus: 'ACTIVE', profileStatus: 'ACTIVE',
        exclusionReason: null, configVersion: 'captain-rules-1',
        config: {
          schemaVersion: 3, enabled: true, programCode: 'SEAFOOD_PREPACKAGED',
          effectiveFrom: '2026-07-01T00:00:00.000Z',
          perOrderCommission: { directProfitRate: 0.05 },
          monthlyRewards: {
            baseManagementProfitRate: 0.02,
            growthBonusProfitRate: 0.01,
            cultivationBonusProfitRate: 0.01,
            performanceBonusProfitRate: 0.01,
          },
          orderRules: { minCommissionBase: 0 },
        },
      },
    },
    errorCode: 'ORDER_PROFIT_COST_MISSING',
    errorMeta: { orderItemIds: ['item-a', 'item-b'] },
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    createdByAdminId: null,
  };
}

function makeHarness(options: { moneyExists?: boolean; historicalRefundId?: string } = {}) {
  const snapshots: any[] = [makeSourceSnapshot()];
  const task: any = {
    id: 'task-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1', status: 'PENDING',
    errorCode: 'ORDER_PROFIT_COST_MISSING', itemCostCorrections: null,
    resolutionNote: null, resolvedSnapshotId: null, resolvedByAdminId: null, resolvedAt: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
  };
  const reconciliationTasks: any[] = [task];
  const drafts: any[] = [];
  const rewardLedgers = options.moneyExists ? [{
    id: 'reward-source-1', accountId: 'reward-account-1', userId: 'inviter-1',
    allocationId: 'allocation-direct-1',
    refType: 'ORDER', refId: 'order-1', deletedAt: null,
    amount: 3, status: 'FROZEN', entryType: 'FREEZE',
    account: { id: 'reward-account-1', type: 'NORMAL_REWARD', balance: 0, frozen: 3 },
    allocation: { id: 'allocation-direct-1', orderId: 'order-1', ruleType: 'NORMAL_DIRECT_REFERRAL' },
    meta: { scheme: 'NORMAL_DIRECT_REFERRAL' },
  }] : [];
  const captainLedgers = options.moneyExists ? [{
    id: 'captain-source-1', accountId: 'captain-account-1', userId: 'captain-1',
    orderAttributionId: 'attribution-1', programCode: 'SEAFOOD_PREPACKAGED',
    orderId: 'order-1', deletedAt: null,
    amount: 2, status: 'FROZEN', type: 'DIRECT_ORDER',
    account: { id: 'captain-account-1', balance: 0, frozen: 2, clawback: 0 },
  }] : [];
  const fundingLedgers = options.moneyExists ? [
    { id: 'funding-platform', snapshotId: 'snapshot-1', orderId: 'order-1', type: 'PLATFORM_RETAINED_CREDIT', amount: 20, configVersion: 'captain-rules-1' },
    { id: 'funding-direct', snapshotId: 'snapshot-1', orderId: 'order-1', type: 'CAPTAIN_DIRECT_HOLD', amount: -2, configVersion: 'captain-rules-1' },
    { id: 'funding-monthly', snapshotId: 'snapshot-1', orderId: 'order-1', type: 'CAPTAIN_MONTHLY_HOLD', amount: -3, configVersion: 'captain-rules-1' },
  ] : [];
  const attribution = options.moneyExists ? {
    id: 'attribution-1', orderId: 'order-1', directCaptainUserId: 'captain-1',
    buyerUserId: 'buyer-1', calculationModel: 'PROFIT_V3',
    profitSnapshotId: 'snapshot-1', profitBaseAmount: 20, commissionBase: 20,
    eligibleGoodsAmount: 50, refundAmount: 0, meta: {},
  } : null;
  const rewardAllocations: any[] = rewardLedgers
    .filter((row: any) => row.allocation)
    .map((row: any) => row.allocation);
  const rewardAccountTypes = new Map<string, string>(rewardLedgers
    .filter((row: any) => row.accountId && row.account?.type)
    .map((row: any) => [row.accountId, row.account.type]));
  const rewardAccounts = new Map<string, any>([[
    'reward-account-1',
    {
      id: 'reward-account-1', userId: 'inviter-1', type: 'NORMAL_REWARD',
      balance: 20, frozen: 10,
    },
  ]]);

  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    order: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1', userId: 'buyer-1', bizType: 'NORMAL_GOODS',
        paidAt: new Date('2026-07-10T00:00:00.000Z'),
        items: [
          { id: 'item-a', quantity: 2, unitPrice: 50, isPrize: false },
          { id: 'item-b', quantity: 1, unitPrice: 50, isPrize: false },
          { id: 'prize-item', quantity: 1, unitPrice: 0, isPrize: true },
        ],
      }),
    },
    orderProfitReconciliationTask: {
      findUnique: jest.fn(async ({ where }: any) => {
        const found = reconciliationTasks.find((row) => row.id === where.id);
        return found ? {
          ...found,
          sourceSnapshot: snapshots.find((row) => row.id === found.sourceSnapshotId),
          resolvedSnapshot: snapshots.find((row) => row.id === found.resolvedSnapshotId) ?? null,
        } : null;
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn(async ({ where }: any = {}) => reconciliationTasks.filter((row) => (
        where?.status ? row.status === where.status : true
      )).length),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const found = reconciliationTasks.find((row) => (
          row.id === where.id && (!where.status || row.status === where.status)
        ));
        if (!found) return { count: 0 };
        Object.assign(found, data);
        return { count: 1 };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `task-${reconciliationTasks.length + 1}`, ...data };
        reconciliationTasks.push(row);
        return row;
      }),
    },
    orderProfitSnapshot: {
      findFirst: jest.fn(async () => snapshots.find((row) => row.isCurrent) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = snapshots.find((item) => item.id === where.id && item.isCurrent === where.isCurrent);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `snapshot-${snapshots.length + 1}`, createdAt: new Date(), ...data };
        snapshots.push(row);
        return row;
      }),
    },
    rewardLedger: {
      findFirst: jest.fn().mockResolvedValue(rewardLedgers[0] ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => rewardLedgers.filter((row: any) => {
        if (where.refId && row.refId !== where.refId && row.meta?.sourceOrderId !== where.refId) return false;
        if (where.deletedAt === null && row.deletedAt != null) return false;
        if (where.status?.in && !where.status.in.includes(row.status)) return false;
        if (where.status?.not && row.status === where.status.not) return false;
        if (where.amount?.gt !== undefined && row.amount <= where.amount.gt) return false;
        if (where.allocation?.orderId && row.allocation?.orderId !== where.allocation.orderId) return false;
        return true;
      })),
      create: jest.fn(async ({ data }: any) => {
        const source = rewardLedgers.find((row: any) => row.allocationId === data.allocationId);
        const row = {
          id: `reward-${rewardLedgers.length + 1}`,
          ...data,
          allocation: source?.allocation ?? null,
          account: rewardAccounts.get(data.accountId) ?? {
            id: data.accountId,
            type: rewardAccountTypes.get(data.accountId),
          },
        };
        rewardLedgers.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rewardLedgers.find((item: any) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rewardLedgers.find((item: any) => (
          item.id === where.id && (!where.status || item.status === where.status)
        ));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    rewardAllocation: {
      findFirst: jest.fn(async ({ where }: any = {}) => rewardAllocations.find((row) => (
        (!where.orderId || row.orderId === where.orderId)
        && (!where.ruleType || row.ruleType === where.ruleType)
      )) ?? null),
      findMany: jest.fn(async () => rewardAllocations),
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = rewardAllocations.find((row) => row.idempotencyKey === where.idempotencyKey);
        if (existing) return existing;
        const row = { id: `allocation-${rewardAllocations.length + 1}`, ...create };
        rewardAllocations.push(row);
        return row;
      }),
    },
    rewardAccount: {
      upsert: jest.fn(async ({ where }: any) => {
        const accountId = where.userId_type.userId === 'inviter-1'
          ? 'reward-account-1'
          : `reward-account-${where.userId_type.userId}-${where.userId_type.type}`;
        const existing = rewardAccounts.get(accountId);
        if (existing) return existing;
        const account = {
          id: accountId,
          userId: where.userId_type.userId,
          type: where.userId_type.type,
          balance: 0,
          frozen: 0,
        };
        rewardAccountTypes.set(account.id, account.type);
        rewardAccounts.set(account.id, account);
        return account;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const account = rewardAccounts.get(where.id);
        if (!account) return null;
        for (const field of ['balance', 'frozen']) {
          const mutation = data[field];
          if (mutation?.increment != null) account[field] += mutation.increment;
          if (mutation?.decrement != null) account[field] -= mutation.decrement;
        }
        return account;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(async ({ where }: any) => rewardAccounts.get(where.id) ?? null),
    },
    captainOrderAttribution: {
      findFirst: jest.fn(async ({ where }: any = {}) => {
        if (!attribution) return null;
        if (where.orderId && attribution.orderId !== where.orderId) return null;
        if (where.profitSnapshotId && attribution.profitSnapshotId !== where.profitSnapshotId) return null;
        if (where.calculationModel && attribution.calculationModel !== where.calculationModel) return null;
        return attribution;
      }),
      findUnique: jest.fn(async ({ where }: any) => attribution?.id === where.id ? attribution : null),
      update: jest.fn(async ({ where, data }: any) => {
        if (attribution && attribution.id === where.id) Object.assign(attribution, data);
        return attribution;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!attribution || attribution.id !== where.id) return { count: 0 };
        if (where.profitSnapshotId && attribution.profitSnapshotId !== where.profitSnapshotId) {
          return { count: 0 };
        }
        Object.assign(attribution, data);
        return { count: 1 };
      }),
    },
    captainCommissionLedger: {
      findFirst: jest.fn().mockResolvedValue(captainLedgers[0] ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => captainLedgers.filter((row: any) => {
        if (where.orderId && row.orderId !== where.orderId) return false;
        if (where.deletedAt === null && row.deletedAt != null) return false;
        if (where.OR && !where.OR.some((condition: any) => (
          condition.orderAttributionId === row.orderAttributionId
          && (!condition.type || condition.type === row.type)
        ))) return false;
        return true;
      })),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `captain-${captainLedgers.length + 1}`, deletedAt: null, ...data };
        captainLedgers.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = captainLedgers.find((item: any) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = captainLedgers.find((item: any) => (
          item.id === where.id && (where.deletedAt !== null || item.deletedAt == null)
        ));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    captainAccount: {
      upsert: jest.fn().mockResolvedValue({
        id: 'captain-account-1', userId: 'captain-1', programCode: 'SEAFOOD_PREPACKAGED',
        balance: 20, frozen: 10, clawback: 0,
      }),
      update: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({
        id: 'captain-account-1', userId: 'captain-1', programCode: 'SEAFOOD_PREPACKAGED',
        balance: 20, frozen: 10, clawback: 0,
      }),
    },
    captainMonthlySettlementOrder: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    captainMonthlySettlement: {
      update: jest.fn(),
    },
    orderProfitFundingLedger: {
      findFirst: jest.fn().mockResolvedValue(fundingLedgers[0] ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => fundingLedgers.filter((row: any) => {
        if (where.orderId && row.orderId !== where.orderId) return false;
        if (where.snapshotId && row.snapshotId !== where.snapshotId) return false;
        if (where.type?.not && row.type === where.type.not) return false;
        return true;
      })),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `funding-${fundingLedgers.length + 1}`, ...data };
        fundingLedgers.push(row);
        return row;
      }),
    },
    orderProfitAdjustmentDraft: {
      findFirst: jest.fn(async ({ where }: any) => drafts.find((row) => (
        (where.id ? row.id === where.id : true)
        && (where.idempotencyKey ? row.idempotencyKey === where.idempotencyKey : true)
      )) ?? null),
      findUnique: jest.fn(async ({ where }: any) => drafts.find((row) => row.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => drafts.filter((row) => (
        where?.orderId ? row.orderId === where.orderId : true
      ))),
      count: jest.fn(async ({ where }: any = {}) => drafts.filter((row) => (
        where?.status ? row.status === where.status : true
      )).length),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `draft-${drafts.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        drafts.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const matching = drafts.filter((item) => (
          (!where.id || (typeof where.id === 'object' ? item.id !== where.id.not : item.id === where.id))
          && (!where.orderId || item.orderId === where.orderId)
          && (!where.status || item.status === where.status)
        ));
        matching.forEach((row) => Object.assign(row, data));
        return { count: matching.length };
      }),
    },
    refund: {
      findFirst: jest.fn().mockResolvedValue(options.historicalRefundId
        ? { id: options.historicalRefundId }
        : null),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    orderProfitReconciliationTask: tx.orderProfitReconciliationTask,
    orderProfitAdjustmentDraft: tx.orderProfitAdjustmentDraft,
  };
  const directAttribution = { createFrozenForPaidOrder: jest.fn().mockResolvedValue('credited') };
  const captainAttribution = { createFrozenForPaidOrder: jest.fn().mockResolvedValue('credited') };
  const profitRefund = { finalizeSuccessfulRefund: jest.fn().mockResolvedValue({ mode: 'V3' }) };
  const service = new AdminProfitReconciliationService(
    prisma,
    directAttribution as any,
    captainAttribution as any,
    profitRefund as any,
  );

  return {
    service, prisma, tx, task, reconciliationTasks, snapshots, drafts,
    rewardLedgers, rewardAccounts, captainLedgers, fundingLedgers, attribution,
    directAttribution, captainAttribution, profitRefund,
  };
}

describe('AdminProfitReconciliationService', () => {
  it.each([
    ['duplicate', [validCorrections[0], validCorrections[0]]],
    ['unknown', [validCorrections[0], { orderItemId: 'unknown', unitCostCents: 2_000 }]],
    ['prize', [validCorrections[0], { orderItemId: 'prize-item', unitCostCents: 2_000 }]],
    ['omitted', [validCorrections[0]]],
    ['non-positive', [validCorrections[0], { orderItemId: 'item-b', unitCostCents: 0 }]],
    ['unsafe cents', [
      { orderItemId: 'item-a', unitCostCents: Number.MAX_SAFE_INTEGER },
      validCorrections[1],
    ]],
  ])('rejects %s corrected cost payloads before changing the revision', async (_label, costCorrections) => {
    const harness = makeHarness();

    await expect(harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections,
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(harness.tx.orderProfitSnapshot.updateMany).not.toHaveBeenCalled();
    expect(harness.tx.orderProfitSnapshot.create).not.toHaveBeenCalled();
  });

  it('uses Serializable plus an order advisory lock and creates one immutable revision', async () => {
    const harness = makeHarness();
    const original = {
      ...harness.snapshots[0],
      itemBreakdown: JSON.parse(JSON.stringify(harness.snapshots[0].itemBreakdown)),
      ruleSnapshot: JSON.parse(JSON.stringify(harness.snapshots[0].ruleSnapshot)),
      errorMeta: JSON.parse(JSON.stringify(harness.snapshots[0].errorMeta)),
    };

    const result = await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    expect(harness.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
    expect(harness.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(harness.snapshots).toHaveLength(2);
    expect(harness.snapshots[0]).toEqual(expect.objectContaining({
      ...original,
      isCurrent: false,
    }));
    expect(harness.snapshots[1]).toEqual(expect.objectContaining({
      revision: 2,
      isCurrent: true,
      supersedesSnapshotId: 'snapshot-1',
      status: 'READY',
      createdByAdminId: 'admin-1',
      productCostAmount: 60,
      distributableProfitAmount: 90,
    }));
    expect(harness.task).toEqual(expect.objectContaining({
      status: 'RESOLVED',
      resolvedSnapshotId: 'snapshot-2',
      resolvedByAdminId: 'admin-1',
    }));
    expect(result).toEqual(expect.objectContaining({ resolvedSnapshot: expect.objectContaining({ id: 'snapshot-2' }) }));
  });

  it('replays an already resolved task without revision N+2 or repeated attribution', async () => {
    const harness = makeHarness();
    const request = { reason: '经财务复核补齐成本', costCorrections: validCorrections };

    const first = await harness.service.recalculate('task-1', 'admin-1', request);
    const second = await harness.service.recalculate('task-1', 'admin-1', request);

    expect(second).toEqual(first);
    expect(harness.snapshots).toHaveLength(2);
    expect(harness.directAttribution.createFrozenForPaidOrder).toHaveBeenCalledTimes(1);
    expect(harness.captainAttribution.createFrozenForPaidOrder).toHaveBeenCalledTimes(1);
  });

  it('returns the current unsuperseded replacement draft on a resolved-task retry', async () => {
    const harness = makeHarness({ moneyExists: true });
    const request = { reason: '经财务复核补齐成本', costCorrections: validCorrections };
    const first = await harness.service.recalculate('task-1', 'admin-1', request);
    Object.assign(first.adjustmentDraft, {
      status: 'SUPERSEDED',
      supersededByDraftId: 'draft-2',
    });
    harness.drafts.push({
      ...first.adjustmentDraft,
      id: 'draft-2',
      status: 'PENDING',
      supersededByDraftId: null,
      idempotencyKey: 'profit:refund:refund-1:revision:draft-1',
      adjustments: { ...first.adjustmentDraft.adjustments, refundId: 'refund-1' },
    });

    const replay = await harness.service.recalculate('task-1', 'admin-1', request);

    expect(replay.adjustmentDraft).toEqual(expect.objectContaining({
      id: 'draft-2', status: 'PENDING', supersededByDraftId: null,
    }));
    expect(harness.snapshots).toHaveLength(2);
  });

  it('runs existing idempotent payment attribution when no money source exists', async () => {
    const harness = makeHarness();

    await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    expect(harness.directAttribution.createFrozenForPaidOrder).toHaveBeenCalledWith(harness.tx, 'order-1');
    expect(harness.captainAttribution.createFrozenForPaidOrder).toHaveBeenCalledWith(harness.tx, 'order-1');
    expect(harness.drafts).toHaveLength(0);
  });

  it('replays successful historical refunds against the new READY revision in the same transaction', async () => {
    const harness = makeHarness({ historicalRefundId: 'refund-before-reconciliation' });
    harness.profitRefund.finalizeSuccessfulRefund.mockImplementation(async (tx: any, refundId: string) => {
      expect(tx).toBe(harness.tx);
      expect(refundId).toBe('refund-before-reconciliation');
      expect(harness.snapshots.find((snapshot) => snapshot.isCurrent)).toEqual(expect.objectContaining({
        id: 'snapshot-2',
        status: 'READY',
      }));
      expect(harness.directAttribution.createFrozenForPaidOrder).toHaveBeenCalled();
      expect(harness.captainAttribution.createFrozenForPaidOrder).toHaveBeenCalled();
      return { mode: 'V3' };
    });

    await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    expect(harness.tx.refund.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orderId: 'order-1', status: 'REFUNDED' }),
    }));
    expect(harness.profitRefund.finalizeSuccessfulRefund).toHaveBeenCalledTimes(1);
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  });

  it('fills missing captain attribution and funding when only member money already exists', async () => {
    const harness = makeHarness();
    const memberSource = {
      id: 'member-source', accountId: 'reward-account-1', userId: 'inviter-1',
      allocationId: 'allocation-direct-1', refType: 'ORDER', refId: 'order-1', deletedAt: null,
      amount: 3, status: 'FROZEN', entryType: 'FREEZE',
      account: { id: 'reward-account-1', type: 'NORMAL_REWARD', balance: 0, frozen: 3 },
      allocation: { id: 'allocation-direct-1', orderId: 'order-1', ruleType: 'NORMAL_DIRECT_REFERRAL' },
      meta: { scheme: 'NORMAL_DIRECT_REFERRAL' },
    };
    harness.tx.rewardLedger.findFirst.mockResolvedValue(memberSource);
    harness.tx.rewardLedger.findMany.mockResolvedValue([memberSource]);

    await harness.service.recalculate('task-1', 'admin-1', {
      reason: '修正资金超限订单成本',
      costCorrections: validCorrections,
    });

    expect(harness.captainAttribution.createFrozenForPaidOrder)
      .toHaveBeenCalledWith(harness.tx, 'order-1');
    expect(harness.drafts).toHaveLength(1);
  });

  it('records old and newly created source basis snapshots in a mixed adjustment draft', async () => {
    const harness = makeHarness();
    harness.fundingLedgers.push({
      id: 'platform-old', snapshotId: 'snapshot-1', orderId: 'order-1',
      type: 'PLATFORM_RETAINED_CREDIT', amount: 20, configVersion: 'cfg-old',
    });
    harness.tx.orderProfitFundingLedger.findFirst.mockResolvedValue(harness.fundingLedgers[0]);
    harness.directAttribution.createFrozenForPaidOrder.mockImplementation(async () => {
      harness.rewardLedgers.push({
        id: 'reward-target', accountId: 'reward-account-1', userId: 'inviter-1',
        allocationId: 'allocation-target', refType: 'ORDER', refId: 'order-1', deletedAt: null,
        amount: 9, status: 'FROZEN', entryType: 'FREEZE',
        account: { id: 'reward-account-1', type: 'NORMAL_REWARD', balance: 0, frozen: 9 },
        allocation: { id: 'allocation-target', orderId: 'order-1', ruleType: 'NORMAL_DIRECT_REFERRAL' },
        meta: { scheme: 'NORMAL_DIRECT_REFERRAL' },
      });
      return 'credited';
    });

    await harness.service.recalculate('task-1', 'admin-1', {
      reason: '补齐混合资金来源',
      costCorrections: validCorrections,
    });

    expect(harness.drafts[0].adjustments.components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceLedgerId: 'reward-target',
        sourceBasisSnapshotId: 'snapshot-2',
      }),
      expect.objectContaining({
        sourceLedgerIds: ['platform-old'],
        sourceBasisSnapshotId: 'snapshot-1',
      }),
    ]));
  });

  it('creates one explicit adjustment draft and does not attribute when money exists', async () => {
    const harness = makeHarness({ moneyExists: true });

    const result = await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    expect(harness.directAttribution.createFrozenForPaidOrder).not.toHaveBeenCalled();
    expect(harness.captainAttribution.createFrozenForPaidOrder).not.toHaveBeenCalled();
    expect(harness.drafts).toHaveLength(1);
    expect(result).toEqual(expect.objectContaining({ adjustmentDraft: expect.objectContaining({ id: 'draft-1' }) }));
    const adjustments = harness.drafts[0].adjustments;
    expect(adjustments.components.length).toBeGreaterThan(0);
    for (const component of adjustments.components) {
      expect(Number.isSafeInteger(component.beforeCents)).toBe(true);
      expect(Number.isSafeInteger(component.targetCents)).toBe(true);
      expect(Number.isSafeInteger(component.deltaCents)).toBe(true);
      expect(component.targetCents - component.beforeCents).toBe(component.deltaCents);
    }
  });

  it('recalculates an existing tree reward instead of silently preserving the wrong amount', async () => {
    const harness = makeHarness({ moneyExists: true });
    harness.tx.rewardLedger.findMany.mockResolvedValue([
      {
        id: 'tree-source-1', accountId: 'reward-account-1', userId: 'member-1',
        amount: 5, status: 'AVAILABLE', entryType: 'RELEASE',
        account: { id: 'reward-account-1', type: 'NORMAL_REWARD', balance: 5, frozen: 0 },
        allocation: { ruleType: 'NORMAL_TREE' }, meta: { scheme: 'NORMAL_TREE' },
      },
    ]);

    await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    const components = harness.drafts[0].adjustments.components;
    expect(components).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'reward:tree:tree-source-1', beforeCents: 500, targetCents: 1_800, deltaCents: 1_300,
      }),
    ]));
  });

  it('recalculates every received reward bucket from the target D', async () => {
    const harness = makeHarness({ moneyExists: true });
    const row = (id: string, amount: number, accountType: string, scheme: string) => ({
      id, accountId: `account-${id}`, userId: `user-${id}`, amount,
      status: 'AVAILABLE', entryType: 'RELEASE', refType: 'ORDER', refId: 'order-1',
      account: { id: `account-${id}`, type: accountType, balance: amount, frozen: 0 },
      allocation: { ruleType: scheme, triggerType: 'ORDER_RECEIVED' },
      meta: { scheme, accountType },
    });
    harness.tx.rewardLedger.findMany.mockResolvedValue([
      row('tree', 5, 'NORMAL_REWARD', 'NORMAL_TREE'),
      row('platform', 10, 'PLATFORM_PROFIT', 'NORMAL_PLATFORM_SPLIT'),
      row('industry', 4, 'INDUSTRY_FUND', 'NORMAL_PLATFORM_SPLIT'),
      row('charity', 1, 'CHARITY_FUND', 'NORMAL_PLATFORM_SPLIT'),
      row('tech', 1, 'TECH_FUND', 'NORMAL_PLATFORM_SPLIT'),
      row('reserve', 1, 'RESERVE_FUND', 'NORMAL_PLATFORM_SPLIT'),
    ]);

    await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    expect(harness.drafts[0].adjustments.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'reward:tree:tree', targetCents: 1_800 }),
      expect.objectContaining({ key: 'reward:platform:platform', targetCents: 4_500 }),
      expect.objectContaining({ key: 'reward:industry:industry', targetCents: 900 }),
      expect.objectContaining({ key: 'reward:charity:charity', targetCents: 270 }),
      expect.objectContaining({ key: 'reward:tech:tech', targetCents: 270 }),
      expect.objectContaining({ key: 'reward:reserve:reserve', targetCents: 360 }),
    ]));
  });

  it('builds canonical components for every missing reward bucket and conserves target D', async () => {
    const harness = makeHarness({ moneyExists: true });

    await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    const rewardComponents = harness.drafts[0].adjustments.components.filter(
      (component: any) => component.kind === 'REWARD',
    );
    expect(rewardComponents).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'reward:direct:reward-source-1', targetCents: 900 }),
      expect.objectContaining({ key: 'reward:tree:new', targetCents: 1_800, canonicalSource: true }),
      expect.objectContaining({ key: 'reward:platform:new', targetCents: 4_500, canonicalSource: true }),
      expect.objectContaining({ key: 'reward:industry:new', targetCents: 900, canonicalSource: true }),
      expect.objectContaining({ key: 'reward:charity:new', targetCents: 270, canonicalSource: true }),
      expect.objectContaining({ key: 'reward:tech:new', targetCents: 270, canonicalSource: true }),
      expect.objectContaining({ key: 'reward:reserve:new', targetCents: 360, canonicalSource: true }),
    ]));
    expect(rewardComponents.reduce(
      (sum: number, component: any) => sum + component.targetCents,
      0,
    )).toBe(9_000);
  });

  it('preserves monthly releases and refund adjustments while revising only canonical funding', async () => {
    const harness = makeHarness({ moneyExists: true });
    harness.fundingLedgers.push(
      {
        id: 'funding-release', snapshotId: 'snapshot-1', orderId: 'order-1',
        type: 'CAPTAIN_MONTHLY_RELEASE', amount: 1.5, configVersion: 'captain-rules-1',
      },
      {
        id: 'funding-refund', snapshotId: 'snapshot-1', orderId: 'order-1',
        type: 'REFUND_ADJUSTMENT', amount: -0.5, configVersion: 'captain-rules-1',
        sourceLedgerId: 'funding-release',
      } as any,
    );

    await expect(harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    })).resolves.toEqual(expect.objectContaining({ adjustmentDraft: expect.any(Object) }));

    const fundingComponents = harness.drafts[0].adjustments.components.filter(
      (component: any) => component.kind === 'FUNDING',
    );
    expect(fundingComponents.map((component: any) => component.fundingType)).toEqual([
      'PLATFORM_RETAINED_CREDIT',
      'CAPTAIN_DIRECT_HOLD',
      'CAPTAIN_MONTHLY_HOLD',
    ]);
    expect(harness.fundingLedgers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'funding-release', type: 'CAPTAIN_MONTHLY_RELEASE', amount: 1.5 }),
      expect.objectContaining({ id: 'funding-refund', type: 'REFUND_ADJUSTMENT', amount: -0.5 }),
    ]));
  });

  it('fails CAS conflicts without leaving a second current snapshot', async () => {
    const harness = makeHarness();
    harness.tx.orderProfitReconciliationTask.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('CASes PENDING to APPLIED before atomically writing every integer-cent delta', async () => {
    const harness = makeHarness();
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-2', status: 'PENDING', idempotencyKey: 'draft-key-1',
      adjustments: {
        version: 1,
        components: [
          {
            key: 'reward:direct', kind: 'REWARD', sourceLedgerId: 'reward-source-1',
            accountId: 'reward-account-1', userId: 'inviter-1', accountType: 'NORMAL_REWARD',
            bucket: 'frozen', beforeCents: 300, targetCents: 500, deltaCents: 200,
          },
          {
            key: 'captain:direct', kind: 'CAPTAIN', sourceLedgerId: 'captain-source-1',
            accountId: 'captain-account-1', userId: 'captain-1', accountType: 'SEAFOOD_PREPACKAGED',
            bucket: 'frozen', beforeCents: 200, targetCents: 100, deltaCents: -100,
          },
          {
            key: 'funding:platform', kind: 'FUNDING', sourceLedgerId: 'funding-platform',
            fundingType: 'PLATFORM_RETAINED_CREDIT',
            beforeCents: 2_000, targetCents: 2_500, deltaCents: 500,
          },
        ],
      },
    });

    const result = await harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '财务复核后批准' },
    );

    expect(harness.prisma.$transaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
    expect(harness.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(harness.tx.orderProfitAdjustmentDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'draft-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'APPLIED', reviewedByAdminId: 'admin-2' }),
    }));
    expect(harness.tx.rewardLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 2, entryType: 'ADJUST', status: 'FROZEN' }),
    }));
    expect(harness.tx.rewardAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { frozen: { increment: 2 } },
    }));
    expect(harness.tx.captainCommissionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: -1, type: 'ADJUSTMENT', status: 'FROZEN' }),
    }));
    expect(harness.tx.captainAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { frozen: { decrement: 1 } },
    }));
    expect(harness.tx.orderProfitFundingLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        snapshotId: 'snapshot-2', amount: 25, type: 'PLATFORM_RETAINED_CREDIT',
      }),
    }));
    expect(harness.tx.orderProfitAdjustmentDraft.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      harness.tx.rewardLedger.create.mock.invocationCallOrder[0],
    );
    expect(result).toEqual(expect.objectContaining({ status: 'APPLIED', reviewedByAdminId: 'admin-2' }));
  });

  it('applies only the net revision credit while registering unrecovered refund debt', async () => {
    const harness = makeHarness();
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-2', status: 'PENDING',
      adjustments: {
        version: 1,
        reason: 'RECONCILIATION_REVISION_REFUND',
        components: [{
          key: 'reward:revision', kind: 'REWARD', sourceLedgerId: 'reward-source-1',
          accountId: 'reward-account-1', userId: 'inviter-1',
          accountType: 'NORMAL_REWARD', bucket: 'frozen',
          beforeCents: 300, targetCents: 720, deltaCents: 420,
        }],
        sources: [{
          sourceLedgerId: 'reward-source-1', sourceLedgerType: 'MEMBER_REWARD',
          userId: 'inviter-1', amountCents: 60, amount: 0.6,
        }],
      },
    });

    const result = await harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '净额补差并登记欠款' },
    );

    expect(harness.tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'reward-account-1' },
      data: { frozen: { increment: 4.2 } },
    });
    expect(result.adjustments.clawbackDisposition).toEqual({
      status: 'REGISTERED_OUTSTANDING',
      amountCents: 60,
      sources: [{
        sourceLedgerId: 'reward-source-1',
        sourceLedgerType: 'MEMBER_REWARD',
        userId: 'inviter-1',
        amountCents: 60,
      }],
      reviewedByAdminId: 'admin-2',
      reviewedAt: expect.any(String),
    });
  });

  it.each(['APPLIED', 'REJECTED', 'SUPERSEDED'])('refuses %s adjustment approval without money writes', async (status) => {
    const harness = makeHarness();
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', status,
      adjustments: { version: 1, components: [] },
    });

    await expect(harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '批准' },
    )).rejects.toBeInstanceOf(ConflictException);

    expect(harness.tx.rewardLedger.create).not.toHaveBeenCalled();
    expect(harness.tx.captainCommissionLedger.create).not.toHaveBeenCalled();
    expect(harness.tx.orderProfitFundingLedger.create).not.toHaveBeenCalled();
  });

  it('moves an uncovered negative captain delta to clawback without making balance negative', async () => {
    const harness = makeHarness();
    harness.tx.captainAccount.findUnique.mockResolvedValue({
      id: 'captain-account-1', userId: 'captain-1', programCode: 'SEAFOOD_PREPACKAGED',
      balance: 5, frozen: 0, clawback: 0,
    });
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-2', status: 'PENDING',
      adjustments: {
        version: 1,
        components: [{
          key: 'captain:available', kind: 'CAPTAIN', sourceLedgerId: 'captain-source-1',
          accountId: 'captain-account-1', userId: 'captain-1',
          accountType: 'SEAFOOD_PREPACKAGED', bucket: 'balance',
          beforeCents: 2_000, targetCents: 500, deltaCents: -1_500,
        }],
      },
    });

    await harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '批准追缴' },
    );

    expect(harness.tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'captain-account-1' },
      data: {
        balance: { decrement: 5 },
        clawback: { increment: 10 },
      },
    });
    expect(harness.tx.captainCommissionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: -15, status: 'CLAWBACK_PENDING' }),
    }));
  });

  it('moves an uncovered negative reward delta to clawback without failing the draft', async () => {
    const harness = makeHarness();
    harness.tx.rewardAccount.findUnique.mockResolvedValue({
      id: 'reward-account-1', userId: 'inviter-1', type: 'NORMAL_REWARD',
      balance: 5, frozen: 0,
    });
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-2', status: 'PENDING',
      adjustments: {
        version: 1,
        components: [{
          key: 'reward:available', kind: 'REWARD', sourceLedgerId: 'reward-source-1',
          accountId: 'reward-account-1', userId: 'inviter-1',
          accountType: 'NORMAL_REWARD', bucket: 'balance',
          beforeCents: 2_000, targetCents: 500, deltaCents: -1_500,
        }],
      },
    });

    await expect(harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '批准追缴' },
    )).resolves.toEqual(expect.objectContaining({ status: 'APPLIED' }));

    expect(harness.tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'reward-account-1' },
      data: { balance: { decrement: 5 } },
    });
    expect(harness.tx.rewardLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amount: -15,
        status: 'RETURN_FROZEN',
        meta: expect.objectContaining({ recoveredAmount: 5, clawbackAmount: 10 }),
      }),
    }));
  });

  it('creates a missing reward source as an ORDER canonical ledger with an allocation', async () => {
    const harness = makeHarness();
    harness.tx.rewardAllocation.findFirst.mockResolvedValue({
      id: 'allocation-tree-1', orderId: 'order-1', ruleType: 'NORMAL_TREE',
      ruleVersion: 'rules-1',
    });
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-2', status: 'PENDING',
      adjustments: {
        version: 1,
        components: [{
          key: 'reward:tree:new', kind: 'REWARD', sourceLedgerId: null,
          accountId: null, userId: 'tree-user-1', accountType: 'NORMAL_REWARD',
          bucket: 'frozen', beforeCents: 0, targetCents: 1_800, deltaCents: 1_800,
          canonicalSource: true, sourceAllocationId: 'allocation-tree-1',
          sourceStatus: 'FROZEN', sourceEntryType: 'FREEZE',
          sourceMeta: { scheme: 'NORMAL_TREE', sourceOrderId: 'order-1' },
        }],
      },
    });
    harness.tx.rewardAccount.upsert.mockResolvedValue({
      id: 'reward-account-tree', userId: 'tree-user-1', type: 'NORMAL_REWARD',
      balance: 0, frozen: 0,
    });

    await harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '补建缺失树奖励' },
    );

    expect(harness.tx.rewardLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        allocationId: 'allocation-tree-1',
        amount: 18,
        refType: 'ORDER',
        refId: 'order-1',
        status: 'FROZEN',
      }),
    }));
  });

  it('creates a missing captain source as a refundable ORDER canonical ledger', async () => {
    const harness = makeHarness();
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-2', status: 'PENDING',
      adjustments: {
        version: 1,
        components: [{
          key: 'captain:direct:new', kind: 'CAPTAIN', sourceLedgerId: null,
          accountId: null, userId: 'captain-1', accountType: 'SEAFOOD_PREPACKAGED',
          bucket: 'frozen', beforeCents: 0, targetCents: 450, deltaCents: 450,
          canonicalSource: true, sourceStatus: 'FROZEN', sourceType: 'DIRECT_ORDER',
          orderAttributionId: 'attribution-1', programCode: 'SEAFOOD_PREPACKAGED',
        }],
      },
    });

    await harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '补建缺失团长逐单奖励' },
    );

    expect(harness.tx.captainCommissionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderAttributionId: 'attribution-1',
        orderId: 'order-1',
        type: 'DIRECT_ORDER',
        amount: 4.5,
        status: 'FROZEN',
        refType: 'ORDER',
        refId: 'order-1',
      }),
    }));
  });

  it.each([
    ['reward', 'REWARD'],
    ['captain', 'CAPTAIN'],
  ])('keeps a withdrawn %s source and creates only the upgrade delta as recoverable canonical money', async (_label, kind) => {
    const harness = makeHarness({ moneyExists: true });
    const component = kind === 'REWARD'
      ? {
          key: 'reward:tree:withdrawn', kind, sourceLedgerId: 'reward-source-1',
          accountId: 'reward-account-1', userId: 'inviter-1', accountType: 'NORMAL_REWARD',
          bucket: 'balance', beforeCents: 1_000, targetCents: 1_500, deltaCents: 500,
          canonicalSource: true, sourceAllocationId: 'allocation-direct-1',
          sourceStatus: 'WITHDRAWN', sourceEntryType: 'WITHDRAW',
          sourceMeta: { scheme: 'NORMAL_TREE', sourceOrderId: 'order-1' },
        }
      : {
          key: 'captain:direct:withdrawn', kind, sourceLedgerId: 'captain-source-1',
          accountId: 'captain-account-1', userId: 'captain-1', accountType: 'SEAFOOD_PREPACKAGED',
          bucket: 'balance', beforeCents: 1_000, targetCents: 1_500, deltaCents: 500,
          canonicalSource: true, sourceStatus: 'WITHDRAWN', sourceType: 'DIRECT_ORDER',
          orderAttributionId: 'attribution-1', programCode: 'SEAFOOD_PREPACKAGED',
          sourceMeta: { calculationModel: 'PROFIT_V3' },
        };
    if (kind === 'REWARD') {
      Object.assign(harness.rewardLedgers[0], {
        amount: 10,
        status: 'WITHDRAWN',
        entryType: 'WITHDRAW',
      });
    } else {
      Object.assign(harness.captainLedgers[0], {
        amount: 10,
        status: 'WITHDRAWN',
      });
    }
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-2', status: 'PENDING',
      adjustments: { version: 1, components: [component] },
    });
    if (kind === 'REWARD') {
      harness.tx.rewardAccount.findUnique.mockResolvedValue({
        id: 'reward-account-1', userId: 'inviter-1', type: 'NORMAL_REWARD',
        balance: 0, frozen: 0,
      });
    } else {
      harness.tx.captainAccount.findUnique.mockResolvedValue({
        id: 'captain-account-1', userId: 'captain-1', programCode: 'SEAFOOD_PREPACKAGED',
        balance: 0, frozen: 0, withdrawn: 10, clawback: 0,
      });
    }

    await harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '升档补差' },
    );

    if (kind === 'REWARD') {
      expect(harness.tx.rewardLedger.updateMany).not.toHaveBeenCalled();
      expect(harness.tx.rewardLedger.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          amount: 5, status: 'AVAILABLE', refType: 'ORDER', refId: 'order-1',
          allocationId: 'allocation-direct-1', sourceLedgerId: 'reward-source-1',
        }),
      }));
    } else {
      expect(harness.tx.captainCommissionLedger.updateMany).not.toHaveBeenCalled();
      expect(harness.tx.captainCommissionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          amount: 5, status: 'AVAILABLE', refType: 'ORDER', refId: 'order-1',
          type: 'DIRECT_ORDER', orderAttributionId: 'attribution-1',
        }),
      }));
    }
  });

  it('approves a pure clawback draft by registering the debt without fake recovery', async () => {
    const harness = makeHarness();
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-1', status: 'PENDING',
      adjustments: {
        reason: 'CLAWBACK_PENDING',
        refundId: 'refund-1',
        sources: [{
          sourceLedgerId: 'reward-withdrawn', sourceLedgerType: 'MEMBER_REWARD',
          userId: 'member-1', amountCents: 720, amount: 7.2,
        }],
      },
    });

    const result = await harness.service.approveAndApplyAdjustment(
      'draft-1',
      'admin-2',
      { note: '登记待追缴欠款' },
    );

    expect(result).toEqual(expect.objectContaining({
      status: 'APPLIED',
      adjustments: expect.objectContaining({
        clawbackDisposition: expect.objectContaining({
          status: 'REGISTERED_OUTSTANDING',
          amountCents: 720,
        }),
      }),
    }));
    expect(harness.tx.rewardLedger.create).not.toHaveBeenCalled();
    expect(harness.tx.rewardAccount.update).not.toHaveBeenCalled();
  });

  it('rejects reconciliation idempotently and never overwrites the first audit note', async () => {
    const harness = makeHarness();

    const first = await harness.service.rejectReconciliation(
      'task-1',
      'admin-1',
      { note: '原始订单资料无法核实' },
    );
    const second = await harness.service.rejectReconciliation(
      'task-1',
      'admin-2',
      { note: '不同备注' },
    );

    expect(first).toEqual(second);
    expect(harness.task).toEqual(expect.objectContaining({
      status: 'REJECTED', resolutionNote: '原始订单资料无法核实', resolvedByAdminId: 'admin-1',
    }));
    expect(harness.tx.orderProfitReconciliationTask.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects an adjustment idempotently and leaves all money untouched', async () => {
    const harness = makeHarness();
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', status: 'PENDING',
      adjustments: { version: 1, components: [] },
    });

    const first = await harness.service.rejectAdjustment(
      'draft-1',
      'admin-1',
      { note: '补差依据不足' },
    );
    const second = await harness.service.rejectAdjustment(
      'draft-1',
      'admin-2',
      { note: '不同备注' },
    );

    expect(first).toEqual(second);
    expect(harness.drafts[0]).toEqual(expect.objectContaining({
      status: 'REJECTED', reviewNote: '补差依据不足', reviewedByAdminId: 'admin-1',
    }));
    expect(harness.tx.rewardLedger.create).not.toHaveBeenCalled();
    expect(harness.tx.captainCommissionLedger.create).not.toHaveBeenCalled();
    expect(harness.tx.orderProfitFundingLedger.create).not.toHaveBeenCalled();
  });

  it('exposes the ordered replacement chain for superseded refund drafts', async () => {
    const harness = makeHarness();
    harness.drafts.push(
      {
        id: 'draft-1', orderId: 'order-1', status: 'SUPERSEDED', supersededByDraftId: 'draft-2',
        adjustments: { reason: 'CLAWBACK_PENDING', refundId: 'refund-1', components: [] },
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
      },
      {
        id: 'draft-2', orderId: 'order-1', status: 'SUPERSEDED', supersededByDraftId: 'draft-3',
        adjustments: { reason: 'CLAWBACK_PENDING', refundId: 'refund-2', components: [] },
        createdAt: new Date('2026-07-10T01:00:00.000Z'),
      },
      {
        id: 'draft-3', orderId: 'order-1', status: 'PENDING', supersededByDraftId: null,
        adjustments: { reason: 'CLAWBACK_PENDING', refundId: 'refund-3', components: [] },
        createdAt: new Date('2026-07-10T02:00:00.000Z'),
      },
    );

    const detail = await harness.service.getAdjustment('draft-2');

    expect(detail).toEqual(expect.objectContaining({
      id: 'draft-2',
      supersededByDraftId: 'draft-3',
      replacementChain: [
        expect.objectContaining({ id: 'draft-1', supersededByDraftId: 'draft-2' }),
        expect.objectContaining({ id: 'draft-2', supersededByDraftId: 'draft-3' }),
        expect.objectContaining({ id: 'draft-3', supersededByDraftId: null }),
      ],
    }));
  });

  it('lists reconciliation tasks with real filtered pagination and audited snapshot context', async () => {
    const harness = makeHarness();
    harness.prisma.orderProfitReconciliationTask.findMany.mockResolvedValueOnce([
      { ...harness.task, sourceSnapshot: harness.snapshots[0] },
    ]);
    harness.prisma.orderProfitReconciliationTask.count.mockResolvedValueOnce(41);

    const page = await harness.service.listReconciliations({
      status: 'PENDING', page: 3, pageSize: 20,
    });
    const detail = await harness.service.getReconciliation('task-1');

    expect(harness.prisma.orderProfitReconciliationTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: 40,
      take: 20,
    }));
    expect(harness.prisma.orderProfitReconciliationTask.count).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
    });
    expect(page).toEqual({
      items: [expect.objectContaining({ id: 'task-1' })],
      total: 41,
      page: 3,
      pageSize: 20,
    });
    expect(detail).toEqual(expect.objectContaining({
      id: 'task-1',
      sourceSnapshot: expect.objectContaining({ id: 'snapshot-1' }),
    }));
  });

  it('lists adjustment drafts with real filtered pagination and source and target revisions', async () => {
    const harness = makeHarness();
    harness.drafts.push({
      id: 'draft-1', orderId: 'order-1', sourceSnapshotId: 'snapshot-1',
      targetSnapshotId: 'snapshot-2', status: 'PENDING', adjustments: { version: 1, components: [] },
    });
    harness.prisma.orderProfitAdjustmentDraft.count.mockResolvedValueOnce(1);

    const page = await harness.service.listAdjustments({
      status: 'PENDING', page: 1, pageSize: 10,
    });

    expect(harness.prisma.orderProfitAdjustmentDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: 10,
    }));
    expect(page).toEqual({
      items: [expect.objectContaining({ id: 'draft-1', status: 'PENDING' })],
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });

  it.each([
    [ListProfitReconciliationsDto, { page: '0', pageSize: '20' }],
    [ListProfitReconciliationsDto, { page: '1.5', pageSize: '20' }],
    [ListProfitAdjustmentsDto, { page: '1', pageSize: '0' }],
    [ListProfitAdjustmentsDto, { page: '1', pageSize: '101' }],
  ])('rejects out-of-bound paging for %p', async (Dto, input) => {
    const errors = await validate(plainToInstance(Dto as any, input) as object);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('applies a revision-aware canonical source view and makes its pending draft cease blocking monthly', async () => {
    const harness = makeHarness({ moneyExists: true });
    const resolution = await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    expect(resolution.adjustmentDraft).toEqual(expect.objectContaining({
      targetSnapshotId: 'snapshot-2', status: 'PENDING',
    }));
    expect(harness.reconciliationTasks).toHaveLength(1);

    await harness.service.approveAndApplyAdjustment(
      resolution.adjustmentDraft.id,
      'admin-2',
      { note: '财务批准应用' },
    );

    expect(harness.tx.rewardLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'reward-source-1', status: 'FROZEN' }),
      data: expect.objectContaining({ status: 'VOIDED', entryType: 'VOID' }),
    }));
    expect(harness.tx.rewardLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refType: 'ORDER', refId: 'order-1', amount: 9, status: 'FROZEN',
      }),
    }));
    expect(harness.tx.captainCommissionLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'captain-source-1', deletedAt: null }),
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    }));
    expect(harness.tx.captainCommissionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'DIRECT_ORDER', orderAttributionId: 'attribution-1', amount: 4.5,
      }),
    }));
    expect(harness.tx.captainOrderAttribution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'attribution-1',
        profitSnapshotId: 'snapshot-1',
      },
      data: expect.objectContaining({
        profitSnapshotId: 'snapshot-2',
        profitBaseAmount: 90,
        commissionBase: 90,
      }),
    }));
    expect(harness.tx.orderProfitFundingLedger.create.mock.calls.map(([call]: any[]) => ({
      snapshotId: call.data.snapshotId,
      type: call.data.type,
      amount: call.data.amount,
    }))).toEqual(expect.arrayContaining([
      { snapshotId: 'snapshot-2', type: 'PLATFORM_RETAINED_CREDIT', amount: 54 },
      { snapshotId: 'snapshot-2', type: 'CAPTAIN_DIRECT_HOLD', amount: -4.5 },
      { snapshotId: 'snapshot-2', type: 'CAPTAIN_MONTHLY_HOLD', amount: -4.5 },
    ]));
    expect(resolution.adjustmentDraft.status).toBe('APPLIED');
  });

  it('uses only the latest active reward source across consecutive approved revisions', async () => {
    const harness = makeHarness({ moneyExists: true });
    const first = await harness.service.recalculate('task-1', 'admin-1', {
      reason: '第一次财务复核补齐成本',
      costCorrections: validCorrections,
    });
    await harness.service.approveAndApplyAdjustment(
      first.adjustmentDraft.id,
      'admin-2',
      { note: '批准第一次利润修订' },
    );

    harness.reconciliationTasks.push({
      id: 'task-2', orderId: 'order-1', sourceSnapshotId: 'snapshot-2', status: 'PENDING',
      errorCode: 'ORDER_PROFIT_COST_CORRECTION', itemCostCorrections: null,
      resolutionNote: null, resolvedSnapshotId: null, resolvedByAdminId: null, resolvedAt: null,
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
      updatedAt: new Date('2026-07-11T00:00:00.000Z'),
    });
    const second = await harness.service.recalculate('task-2', 'admin-1', {
      reason: '第二次财务复核更正成本',
      costCorrections: [
        { orderItemId: 'item-a', unitCostCents: 2_000 },
        { orderItemId: 'item-b', unitCostCents: 1_000 },
      ],
    });
    expect(second.adjustmentDraft.adjustments.components.filter((component: any) => (
      component.kind === 'REWARD'
      && (typeof component.userId !== 'string' || typeof component.accountType !== 'string')
    ))).toEqual([]);
    expect(second.adjustmentDraft.adjustments.components
      .filter((component: any) => component.kind === 'REWARD' && component.accountId)
      .map((component: any) => ({
        key: component.key,
        expectedUserId: component.userId,
        expectedType: component.accountType,
        account: harness.rewardAccounts.get(component.accountId),
      }))
      .filter((entry: any) => (
        entry.account?.userId !== entry.expectedUserId
        || entry.account?.type !== entry.expectedType
      ))).toEqual([]);
    await harness.service.approveAndApplyAdjustment(
      second.adjustmentDraft.id,
      'admin-2',
      { note: '批准第二次利润修订' },
    );

    const directSources = harness.rewardLedgers.filter((row: any) => (
      row.meta?.scheme === 'NORMAL_DIRECT_REFERRAL'
    ));
    expect(directSources.filter((row: any) => row.status !== 'VOIDED')).toEqual([
      expect.objectContaining({ amount: 10, status: 'FROZEN' }),
    ]);
    expect(directSources.filter((row: any) => row.status === 'VOIDED').map((row: any) => row.amount))
      .toEqual(expect.arrayContaining([3, 9]));
    const secondDraftComponents = second.adjustmentDraft.adjustments.components;
    expect(secondDraftComponents.filter((component: any) => (
      component.kind === 'REWARD'
      && component.sourceMeta?.scheme === 'NORMAL_DIRECT_REFERRAL'
    ))).toEqual([
      expect.objectContaining({ beforeCents: 900, targetCents: 1_000, deltaCents: 100 }),
    ]);
    expect(harness.tx.rewardAccount.update.mock.calls.map(([call]: any[]) => call.data))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ balance: expect.objectContaining({ decrement: expect.any(Number) }) }),
      ]));
  });

  it('replaces a withdrawn upgrade delta without duplicating money on a later revision', async () => {
    const harness = makeHarness({ moneyExists: true });
    Object.assign(harness.rewardLedgers[0], {
      amount: 3,
      status: 'WITHDRAWN',
      entryType: 'WITHDRAW',
    });
    Object.assign(harness.rewardAccounts.get('reward-account-1'), {
      balance: 0,
      frozen: 0,
    });
    const first = await harness.service.recalculate('task-1', 'admin-1', {
      reason: '第一次财务复核补齐成本',
      costCorrections: validCorrections,
    });
    await harness.service.approveAndApplyAdjustment(
      first.adjustmentDraft.id,
      'admin-2',
      { note: '批准第一次利润修订' },
    );

    harness.reconciliationTasks.push({
      id: 'task-2', orderId: 'order-1', sourceSnapshotId: 'snapshot-2', status: 'PENDING',
      errorCode: 'ORDER_PROFIT_COST_CORRECTION', itemCostCorrections: null,
      resolutionNote: null, resolvedSnapshotId: null, resolvedByAdminId: null, resolvedAt: null,
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
      updatedAt: new Date('2026-07-11T00:00:00.000Z'),
    });
    const second = await harness.service.recalculate('task-2', 'admin-1', {
      reason: '第二次财务复核更正成本',
      costCorrections: [
        { orderItemId: 'item-a', unitCostCents: 2_000 },
        { orderItemId: 'item-b', unitCostCents: 1_000 },
      ],
    });
    expect(second.adjustmentDraft.adjustments.components.filter((component: any) => (
      component.kind === 'REWARD'
      && component.sourceMeta?.scheme === 'NORMAL_DIRECT_REFERRAL'
    ))).toEqual([
      expect.objectContaining({
        sourceStatus: 'WITHDRAWN', beforeCents: 300, targetCents: 1_000, deltaCents: 700,
      }),
      expect.objectContaining({
        sourceStatus: 'AVAILABLE', beforeCents: 600, targetCents: 0, deltaCents: -600,
      }),
    ]);
    await harness.service.approveAndApplyAdjustment(
      second.adjustmentDraft.id,
      'admin-2',
      { note: '批准第二次利润修订' },
    );

    const directSources = harness.rewardLedgers.filter((row: any) => (
      row.meta?.scheme === 'NORMAL_DIRECT_REFERRAL'
    ));
    const activeSources = directSources.filter((row: any) => row.status !== 'VOIDED');
    expect(activeSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 3, status: 'WITHDRAWN' }),
      expect.objectContaining({
        amount: 7,
        status: 'AVAILABLE',
        meta: expect.objectContaining({ adjustmentKind: 'WITHDRAWN_UPGRADE_DELTA' }),
      }),
    ]));
    expect(activeSources.reduce((sum: number, row: any) => sum + row.amount, 0)).toBe(10);
    expect(directSources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        amount: 6,
        status: 'VOIDED',
        meta: expect.objectContaining({ adjustmentKind: 'WITHDRAWN_UPGRADE_DELTA' }),
      }),
    ]));
    expect(harness.tx.rewardAccount.update.mock.calls.map(([call]: any[]) => call.data))
      .toEqual(expect.arrayContaining([
        { balance: { increment: 6 } },
        { balance: { increment: 7 } },
        { balance: { decrement: 6 } },
      ]));
    expect(harness.rewardAccounts.get('reward-account-1')).toEqual(expect.objectContaining({
      balance: 7,
      frozen: 0,
    }));
    expect(harness.tx.rewardLedger.create.mock.calls.map(([call]: any[]) => call.data.status))
      .not.toContain('CLAWBACK_PENDING');
  });

  it('refunds only the canonical sources from the approved target revision', async () => {
    const harness = makeHarness({ moneyExists: true });
    const resolution = await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });
    await harness.service.approveAndApplyAdjustment(
      resolution.adjustmentDraft.id,
      'admin-2',
      { note: '财务批准应用' },
    );

    const reversals: any[] = [];
    harness.tx.refund = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 100,
        items: [{
          orderItemId: 'item-a', quantity: 2, amount: 100,
          createdAt: new Date('2026-07-20T00:00:00.000Z'),
        }],
      }),
      findMany: jest.fn().mockResolvedValue([{
        id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 100,
        items: [{
          orderItemId: 'item-a', quantity: 2, amount: 100,
          createdAt: new Date('2026-07-20T00:00:00.000Z'),
        }],
      }]),
    };
    harness.tx.orderProfitRefundReversal = {
      findMany: jest.fn(async ({ where }: any) => reversals.filter((row) => (
        (!where.orderId || row.orderId === where.orderId)
        && (!where.snapshotId || row.snapshotId === where.snapshotId)
      ))),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `reversal-${reversals.length + 1}`, ...data };
        reversals.push(row);
        return row;
      }),
    };
    harness.tx.captainMonthlySettlementOrder.findUnique = jest.fn().mockResolvedValue(null);
    harness.tx.captainMonthlySettlement = { update: jest.fn() };

    const result = await new OrderProfitRefundService()
      .finalizeSuccessfulRefund(harness.tx, 'refund-1');

    const canonicalReward = harness.rewardLedgers.find((row: any) => (
      row.meta?.adjustmentDraftId === resolution.adjustmentDraft.id
    ));
    const canonicalCaptain = harness.captainLedgers.find((row: any) => (
      row.meta?.adjustmentDraftId === resolution.adjustmentDraft.id
    ));
    const currentFundingIds = new Set(harness.fundingLedgers
      .filter((row: any) => row.snapshotId === 'snapshot-2' && row.type !== 'REFUND_ADJUSTMENT')
      .map((row: any) => row.id));
    const reversalSourceIds = new Set(reversals.map((row) => row.sourceLedgerId));

    expect(result).toEqual(expect.objectContaining({ mode: 'V3' }));
    expect(harness.attribution).toEqual(expect.objectContaining({ profitSnapshotId: 'snapshot-2' }));
    expect(canonicalReward).toBeDefined();
    expect(canonicalCaptain).toBeDefined();
    expect(reversalSourceIds).toContain(canonicalReward!.id);
    expect(reversalSourceIds).toContain(canonicalCaptain!.id);
    expect(reversalSourceIds).not.toContain('reward-source-1');
    expect(reversalSourceIds).not.toContain('captain-source-1');
    expect([...reversalSourceIds].filter((id) => currentFundingIds.has(id as string)).length)
      .toBeGreaterThan(0);
    expect(reversals.every((row) => row.snapshotId === 'snapshot-2')).toBe(true);
  });

  it('applies reconciliation for an order already in monthly settlement and reopens monthly review', async () => {
    const harness = makeHarness({ moneyExists: true });
    harness.tx.captainMonthlySettlementOrder.findFirst.mockResolvedValue({
      id: 'settlement-order-1', orderAttributionId: 'attribution-1',
      profitBaseAmount: 20, baseManagementAmount: 2, growthBonusAmount: 1,
      cultivationBonusAmount: 0, performanceBonusAmount: 1,
      settlementId: 'settlement-1',
      settlement: { id: 'settlement-1', status: 'APPROVED', month: '2026-07' },
    });
    const resolution = await harness.service.recalculate('task-1', 'admin-1', {
      reason: '经财务复核补齐成本',
      costCorrections: validCorrections,
    });

    expect(resolution.adjustmentDraft.adjustments).toEqual(expect.objectContaining({
      approvalBlockedReason: null,
      monthlySettlement: expect.objectContaining({
        settlementOrderId: 'settlement-order-1',
        beforeProfitBaseCents: 2_000,
        targetProfitBaseCents: 9_000,
      }),
    }));
    await expect(harness.service.approveAndApplyAdjustment(
      resolution.adjustmentDraft.id,
      'admin-2',
      { note: '批准后重算月结' },
    )).resolves.toEqual(expect.objectContaining({ status: 'APPLIED' }));
    expect(harness.tx.captainMonthlySettlement.update).toHaveBeenCalledWith({
      where: { id: 'settlement-1' },
      data: expect.objectContaining({
        status: 'PENDING_REVIEW',
        reviewedByAdminId: null,
        reviewedAt: null,
      }),
    });
  });
});
