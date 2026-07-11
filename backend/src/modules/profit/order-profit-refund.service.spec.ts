import {
  buildCumulativeRefundTargets,
  buildRemainingProfitView,
  assertRefundSourceCaps,
  OrderProfitRefundService,
  type RefundProfitItem,
} from './order-profit-refund.service';

const ITEMS: RefundProfitItem[] = [
  {
    orderItemId: 'item-a',
    quantity: 3,
    netGoodsRevenueCents: 10_001,
    distributableProfitShareCents: 3_001,
    captainEligible: true,
  },
  {
    orderItemId: 'item-b',
    quantity: 2,
    netGoodsRevenueCents: 8_000,
    distributableProfitShareCents: 2_000,
    captainEligible: false,
  },
];

describe('buildCumulativeRefundTargets', () => {
  it('computes two consecutive quantity refunds from the cumulative quantity', () => {
    const first = buildCumulativeRefundTargets(ITEMS, [
      { refundId: 'r1', orderItemId: 'item-a', quantity: 1, goodsAmountCents: 3_334 },
    ]);
    const second = buildCumulativeRefundTargets(ITEMS, [
      { refundId: 'r1', orderItemId: 'item-a', quantity: 1, goodsAmountCents: 3_334 },
      { refundId: 'r2', orderItemId: 'item-a', quantity: 1, goodsAmountCents: 3_333 },
    ]);

    expect(first['item-a']).toMatchObject({
      cumulativeRefundRatio: 1 / 3,
      cumulativeProfitTargetCents: 1_000,
    });
    expect(second['item-a']).toMatchObject({
      cumulativeRefundRatio: 2 / 3,
      cumulativeProfitTargetCents: 2_001,
    });
  });

  it('handles multiple item quantities independently', () => {
    const targets = buildCumulativeRefundTargets(ITEMS, [
      { refundId: 'r1', orderItemId: 'item-a', quantity: 1, goodsAmountCents: 3_334 },
      { refundId: 'r1', orderItemId: 'item-b', quantity: 2, goodsAmountCents: 8_000 },
    ]);

    expect(targets['item-a'].cumulativeProfitTargetCents).toBe(1_000);
    expect(targets['item-b'].cumulativeProfitTargetCents).toBe(2_000);
  });

  it('uses discounted goods amount for amount-only refunds', () => {
    const targets = buildCumulativeRefundTargets(ITEMS, [
      { refundId: 'r1', orderItemId: 'item-a', quantity: 0, goodsAmountCents: 2_500 },
      { refundId: 'r2', orderItemId: 'item-a', quantity: 0, goodsAmountCents: 2_500 },
    ]);

    expect(targets['item-a'].cumulativeRefundRatio).toBeCloseTo(5_000 / 10_001, 10);
    expect(targets['item-a'].cumulativeProfitTargetCents).toBe(1_500);
  });

  it('absorbs the last cent on a full refund', () => {
    const targets = buildCumulativeRefundTargets(ITEMS, [
      { refundId: 'r1', orderItemId: 'item-a', quantity: 1, goodsAmountCents: 3_333 },
      { refundId: 'r2', orderItemId: 'item-a', quantity: 2, goodsAmountCents: 6_668 },
    ]);

    expect(targets['item-a'].cumulativeRefundRatio).toBe(1);
    expect(targets['item-a'].cumulativeProfitTargetCents).toBe(3_001);
  });

  it('does not include shipping in an amount-only refund ratio', () => {
    const targets = buildCumulativeRefundTargets(ITEMS, [
      {
        refundId: 'r1',
        orderItemId: 'item-b',
        quantity: 0,
        goodsAmountCents: 4_000,
        channelRefundAmountCents: 5_500,
      },
    ]);

    expect(targets['item-b'].cumulativeRefundRatio).toBe(0.5);
    expect(targets['item-b'].cumulativeProfitTargetCents).toBe(1_000);
  });

  it('rejects negative quantities instead of treating them as amount-only refunds', () => {
    expect(() => buildCumulativeRefundTargets(ITEMS, [
      { refundId: 'r1', orderItemId: 'item-a', quantity: -1, goodsAmountCents: 2_500 },
    ])).toThrow('refund quantity must be zero or a positive integer');
  });

  it('builds remaining D and C from cumulative item targets', () => {
    const view = buildRemainingProfitView(ITEMS, [
      { refundId: 'r1', orderItemId: 'item-a', quantity: 1, goodsAmountCents: 3_334 },
      { refundId: 'r1', orderItemId: 'item-b', quantity: 0, goodsAmountCents: 4_000 },
    ]);

    expect(view).toEqual({
      originalDistributableProfitCents: 5_001,
      originalCaptainEligibleProfitCents: 3_001,
      refundedDistributableProfitCents: 2_000,
      refundedCaptainEligibleProfitCents: 1_000,
      remainingDistributableProfitCents: 3_001,
      remainingCaptainEligibleProfitCents: 2_001,
      remainingItemProfitCents: {
        'item-a': 2_001,
        'item-b': 1_000,
      },
    });
  });

  it('keeps refunds from a later month linked to the original item economics', () => {
    const targets = buildCumulativeRefundTargets(ITEMS, [
      {
        refundId: 'r-july',
        orderItemId: 'item-a',
        quantity: 3,
        goodsAmountCents: 10_001,
        refundedAt: new Date('2026-08-02T01:00:00.000Z'),
      },
    ]);

    expect(targets['item-a'].cumulativeProfitTargetCents).toBe(3_001);
  });
});

describe('assertRefundSourceCaps', () => {
  it('rejects member and captain source totals above original D and C', () => {
    expect(() => assertRefundSourceCaps({
      distributableProfitCents: 5_001,
      captainEligibleProfitCents: 3_001,
      memberSourceCents: 5_002,
      captainSourceCents: 3_001,
      fundingSources: [],
    })).toThrow('member refund sources exceed original D');
    expect(() => assertRefundSourceCaps({
      distributableProfitCents: 5_001,
      captainEligibleProfitCents: 3_001,
      memberSourceCents: 5_001,
      captainSourceCents: 3_002,
      fundingSources: [],
    })).toThrow('captain refund sources exceed original C');
  });

  it('rejects platform funding above D and captain funding above C', () => {
    expect(() => assertRefundSourceCaps({
      distributableProfitCents: 5_001,
      captainEligibleProfitCents: 3_001,
      memberSourceCents: 2_000,
      captainSourceCents: 600,
      fundingSources: [{ type: 'PLATFORM_RETAINED_CREDIT', amountCents: 5_002 }],
    })).toThrow('platform funding exceeds original D');
    expect(() => assertRefundSourceCaps({
      distributableProfitCents: 5_001,
      captainEligibleProfitCents: 3_001,
      memberSourceCents: 2_000,
      captainSourceCents: 600,
      fundingSources: [
        { type: 'PLATFORM_RETAINED_CREDIT', amountCents: 4_000 },
        { type: 'CAPTAIN_MONTHLY_HOLD', amountCents: -3_002 },
      ],
    })).toThrow('captain funding source exceeds original C');
  });

  it('accepts the conservation golden vector at the exact cent boundaries', () => {
    expect(() => assertRefundSourceCaps({
      distributableProfitCents: 5_001,
      captainEligibleProfitCents: 3_001,
      memberSourceCents: 2_000,
      captainSourceCents: 600,
      fundingSources: [
        { type: 'PLATFORM_RETAINED_CREDIT', amountCents: 3_001 },
        { type: 'CAPTAIN_DIRECT_HOLD', amountCents: -600 },
      ],
    })).not.toThrow();

    const remainingD = 3_001;
    const remainingMember = 1_200;
    const remainingCaptain = 400;
    const remainingFunding = 1_401;
    expect(remainingMember + remainingCaptain + remainingFunding).toBe(remainingD);
  });
});

describe('OrderProfitRefundService', () => {
  function makeTx(overrides: Record<string, any> = {}) {
    const reversals: any[] = [];
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refund-1',
          orderId: 'order-1',
          status: 'REFUNDED',
          amount: 55,
          items: [{
            orderItemId: 'item-a',
            quantity: 1,
            amount: 33.34,
            createdAt: new Date('2026-07-20T00:00:00.000Z'),
          }],
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'refund-1', items: [{
          orderItemId: 'item-a', quantity: 1, amount: 33.34,
          createdAt: new Date('2026-07-20T00:00:00.000Z'),
        }] }]),
      },
      orderProfitSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'snapshot-1',
          orderId: 'order-1',
          status: 'READY',
          distributableProfitAmount: 50.01,
          captainEligibleProfitAmount: 30.01,
          itemBreakdown: ITEMS,
          ruleSnapshot: {},
        }),
      },
      orderProfitAdjustmentDraft: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({ id: 'draft-1' }),
      },
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'reward-reversal' }),
        update: jest.fn().mockResolvedValue({}),
      },
      rewardAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: 'reward-account', balance: 100, frozen: 100 }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      captainOrderAttribution: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      captainCommissionLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'captain-reversal' }),
        update: jest.fn().mockResolvedValue({}),
      },
      captainAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: 'captain-account', balance: 100, frozen: 100 }),
        update: jest.fn().mockResolvedValue({}),
      },
      captainMonthlySettlementOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      captainMonthlySettlement: {
        update: jest.fn().mockResolvedValue({}),
      },
      orderProfitFundingLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'funding-reversal' }),
      },
      orderProfitRefundReversal: {
        findMany: jest.fn().mockImplementation(async () => reversals),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `reversal-${reversals.length + 1}`, ...data };
          reversals.push(row);
          return row;
        }),
      },
      ...overrides,
    };
    return { tx, reversals };
  }

  it('returns legacy mode without touching V2 ledgers when no current snapshot exists', async () => {
    const { tx } = makeTx();
    tx.orderProfitSnapshot.findFirst.mockResolvedValue(null);
    const service = new OrderProfitRefundService();

    await expect(service.finalizeSuccessfulRefund(tx, 'refund-1'))
      .resolves.toEqual(expect.objectContaining({ mode: 'LEGACY' }));
    expect(tx.rewardLedger.findMany).not.toHaveBeenCalled();
    expect(tx.orderProfitRefundReversal.create).not.toHaveBeenCalled();
  });

  it('fails closed when a successful V3 refund has no line-level refund facts', async () => {
    const { tx } = makeTx();
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 20, items: [],
    });
    tx.refund.findMany.mockResolvedValue([{ id: 'refund-1', items: [] }]);

    await expect(new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1'))
      .rejects.toThrow('successful V3 refund refund-1 is missing line-level facts');
    expect(tx.orderProfitAdjustmentDraft.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when any successful refund in the cumulative sequence lacks line facts', async () => {
    const { tx } = makeTx();
    tx.refund.findMany.mockResolvedValue([
      { id: 'refund-missing', items: [] },
      { id: 'refund-1', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.34 }] },
    ]);

    await expect(new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1'))
      .rejects.toThrow('successful V3 refund refund-missing is missing line-level facts');
    expect(tx.orderProfitRefundReversal.create).not.toHaveBeenCalled();
  });

  it('reverses upstream fallback rewards routed to PLATFORM_PROFIT', async () => {
    const { tx, reversals } = makeTx();
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'platform-fallback-1',
      allocationId: 'allocation-1',
      accountId: 'platform-profit-account',
      userId: 'PLATFORM',
      amount: 15,
      status: 'AVAILABLE',
      entryType: 'RELEASE',
      account: { type: 'PLATFORM_PROFIT' },
      meta: { scheme: 'VIP_UPSTREAM_FALLBACK' },
    }]);

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(reversals).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceLedgerId: 'platform-fallback-1' }),
    ]));
    expect(tx.rewardAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'platform-profit-account' },
    }));
  });

  it('reverses every V3 reward bucket for this order without widening beyond its allocation', async () => {
    const { tx, reversals } = makeTx();
    const sources = [
      ['vip-tree', 'VIP_REWARD', 'VIP_UPSTREAM'],
      ['normal-tree', 'NORMAL_REWARD', 'NORMAL_TREE'],
      ['vip-direct', 'VIP_REWARD', 'VIP_DIRECT_REFERRAL'],
      ['normal-direct', 'NORMAL_REWARD', 'NORMAL_DIRECT_REFERRAL'],
      ['industry', 'INDUSTRY_FUND', 'NORMAL_PLATFORM_SPLIT'],
      ['platform', 'PLATFORM_PROFIT', 'NORMAL_PLATFORM_SPLIT'],
      ['charity', 'CHARITY_FUND', 'NORMAL_PLATFORM_SPLIT'],
      ['tech', 'TECH_FUND', 'NORMAL_PLATFORM_SPLIT'],
      ['reserve', 'RESERVE_FUND', 'NORMAL_PLATFORM_SPLIT'],
    ].map(([id, accountType, scheme]) => ({
      id,
      allocationId: `allocation-${id}`,
      accountId: `account-${id}`,
      userId: `user-${id}`,
      amount: 1,
      status: 'FROZEN',
      entryType: 'FREEZE',
      refType: 'ORDER',
      refId: 'order-1',
      allocation: { orderId: 'order-1' },
      account: { type: accountType },
      meta: { scheme, accountType },
    }));
    const historicalSource = {
      ...sources[0],
      id: 'historical-vip-referral',
      allocationId: 'allocation-historical',
      meta: { scheme: 'VIP_REFERRAL', accountType: 'VIP_REWARD' },
    };
    tx.rewardLedger.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.amount?.lt === 0) return [];
      expect(where).toEqual(expect.objectContaining({
        refType: 'ORDER',
        refId: 'order-1',
        allocation: { orderId: 'order-1' },
      }));
      expect(where.account.type.in).toEqual(expect.arrayContaining([
        'VIP_REWARD',
        'NORMAL_REWARD',
        'INDUSTRY_FUND',
        'PLATFORM_PROFIT',
        'CHARITY_FUND',
        'TECH_FUND',
        'RESERVE_FUND',
      ]));
      return [...sources, historicalSource];
    });

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(new Set(reversals.map((row) => row.sourceLedgerId))).toEqual(
      new Set(sources.map((row) => row.id)),
    );
  });

  it('allocates the complete reward distribution and retained funding as parallel accounting layers', async () => {
    const { tx, reversals } = makeTx();
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'complete-reward-layer', allocationId: 'allocation-1',
      accountId: 'platform-profit-account', userId: 'PLATFORM', amount: 50.01,
      status: 'AVAILABLE', entryType: 'RELEASE',
      account: { type: 'PLATFORM_PROFIT' },
      meta: { scheme: 'NORMAL_PLATFORM_SPLIT', accountType: 'PLATFORM_PROFIT' },
    }]);
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([{
      id: 'retained-funding-layer', snapshotId: 'snapshot-1', orderId: 'order-1',
      type: 'PLATFORM_RETAINED_CREDIT', amount: 30.01, configVersion: 'cfg-1',
    }]);

    await expect(new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1'))
      .resolves.toEqual(expect.objectContaining({ mode: 'V3' }));

    expect(new Set(reversals.map((row) => row.sourceLedgerId))).toEqual(new Set([
      'complete-reward-layer',
      'retained-funding-layer',
    ]));
  });

  it('carries unresolved clawback from superseded drafts into the replacement draft', async () => {
    const { tx, reversals } = makeTx();
    reversals.push({
      refundId: 'refund-old', orderItemId: 'item-a', sourceLedgerId: 'reward-withdrawn',
      sourceLedgerType: 'MEMBER_REWARD', incrementalReversal: 4,
    });
    tx.refund.findMany.mockResolvedValue([
      { id: 'refund-old', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.34 }] },
      { id: 'refund-1', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.33 }] },
    ]);
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'reward-withdrawn',
      allocationId: 'allocation-1',
      accountId: 'reward-account',
      userId: 'member-1',
      amount: 18,
      status: 'WITHDRAWN',
      entryType: 'WITHDRAW',
      account: { type: 'VIP_REWARD' },
      meta: { scheme: 'VIP_UPSTREAM' },
    }]);
    tx.rewardAccount.findUnique.mockResolvedValue({
      id: 'reward-account', balance: 0, frozen: 0,
    });
    tx.orderProfitAdjustmentDraft.findMany.mockResolvedValue([{
      id: 'draft-old',
      status: 'PENDING',
      adjustments: {
        reason: 'CLAWBACK_PENDING',
        sources: [{
          sourceLedgerId: 'reward-withdrawn',
          sourceLedgerType: 'MEMBER_REWARD',
          userId: 'member-1',
          amountCents: 400,
        }],
      },
    }]);

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.orderProfitAdjustmentDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        adjustments: expect.objectContaining({
          sources: expect.arrayContaining([
            expect.objectContaining({ sourceLedgerId: 'reward-withdrawn', amountCents: 720 }),
          ]),
        }),
      }),
    }));
    expect(tx.orderProfitAdjustmentDraft.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        status: 'PENDING',
        id: { not: 'draft-1' },
      },
      data: {
        status: 'SUPERSEDED',
        supersededByDraftId: 'draft-1',
      },
    });
  });

  it('replaces a pending reconciliation draft with the complete refund-adjusted target', async () => {
    const { tx } = makeTx();
    const currentSnapshot = await tx.orderProfitSnapshot.findFirst();
    tx.orderProfitSnapshot.findMany = jest.fn().mockResolvedValue([
      { ...currentSnapshot, id: 'snapshot-old' },
      currentSnapshot,
    ]);
    const sourceAttribution = {
      id: 'attribution-old', orderId: 'order-1', programCode: 'SEAFOOD_PREPACKAGED',
      calculationModel: 'PROFIT_V3', profitSnapshotId: 'snapshot-old',
      eligibleGoodsAmount: 100.01,
    };
    tx.captainOrderAttribution.findFirst.mockImplementation(async ({ where }: any) => (
      where.profitSnapshotId === 'snapshot-old' ? sourceAttribution : null
    ));
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'reward-old', allocationId: 'allocation-1', accountId: 'reward-account',
      userId: 'member-1', amount: 3, status: 'FROZEN', entryType: 'FREEZE',
      account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
    }]);
    tx.captainCommissionLedger.findMany.mockResolvedValue([{
      id: 'captain-old', accountId: 'captain-account', userId: 'captain-1',
      orderAttributionId: 'attribution-old', orderId: 'order-1',
      programCode: 'SEAFOOD_PREPACKAGED', type: 'DIRECT_ORDER', amount: 2,
      status: 'FROZEN', meta: {},
    }]);
    const funding = [
      { id: 'platform-old', snapshotId: 'snapshot-old', type: 'PLATFORM_RETAINED_CREDIT', amount: 20, configVersion: 'cfg-1' },
      { id: 'direct-hold-old', snapshotId: 'snapshot-old', type: 'CAPTAIN_DIRECT_HOLD', amount: -2, configVersion: 'cfg-1' },
    ];
    tx.orderProfitFundingLedger.findMany.mockImplementation(async ({ where }: any) => {
      const snapshotIds = Array.isArray(where.snapshotId?.in)
        ? where.snapshotId.in
        : [where.snapshotId];
      return funding.filter((row) => snapshotIds.includes(row.snapshotId));
    });
    tx.orderProfitAdjustmentDraft.findMany.mockResolvedValue([{
      id: 'revision-draft', orderId: 'order-1', status: 'PENDING',
      sourceSnapshotId: 'snapshot-old', targetSnapshotId: 'snapshot-1',
      adjustments: {
        version: 1,
        reason: 'RECONCILIATION_REVISION',
        reconciliationTaskId: 'task-1',
        attributionUpdate: {
          attributionId: 'attribution-old',
          sourceSnapshotId: 'snapshot-old',
          targetSnapshotId: 'snapshot-1',
        },
        components: [
          { key: 'reward:old', kind: 'REWARD', sourceLedgerId: 'reward-old', beforeCents: 300, targetCents: 900, deltaCents: 600 },
          { key: 'captain:old', kind: 'CAPTAIN', sourceLedgerId: 'captain-old', beforeCents: 200, targetCents: 450, deltaCents: 250 },
          { key: 'funding:platform', kind: 'FUNDING', fundingType: 'PLATFORM_RETAINED_CREDIT', sourceLedgerId: 'platform-old', sourceLedgerIds: ['platform-old'], beforeCents: 2_000, targetCents: 5_400, deltaCents: 3_400 },
          { key: 'funding:direct', kind: 'FUNDING', fundingType: 'CAPTAIN_DIRECT_HOLD', sourceLedgerId: 'direct-hold-old', sourceLedgerIds: ['direct-hold-old'], beforeCents: -200, targetCents: -450, deltaCents: -250 },
        ],
      },
    }]);

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.orderProfitAdjustmentDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceSnapshotId: 'snapshot-old',
        targetSnapshotId: 'snapshot-1',
        adjustments: expect.objectContaining({
          version: 1,
          reason: 'RECONCILIATION_REVISION_REFUND',
          reconciliationTaskId: 'task-1',
          components: expect.arrayContaining([
            expect.objectContaining({ key: 'reward:old', sourceLedgerId: 'reward-old', targetCents: 720 }),
            expect.objectContaining({ key: 'captain:old', sourceLedgerId: 'captain-old', targetCents: 300 }),
            expect.objectContaining({ key: 'funding:platform', sourceLedgerIds: ['platform-old'], targetCents: 4_320 }),
            expect.objectContaining({ key: 'funding:direct', sourceLedgerIds: ['direct-hold-old'], targetCents: -300 }),
          ]),
        }),
      }),
    }));
    expect(tx.orderProfitAdjustmentDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUPERSEDED' }),
    }));
  });

  it('keeps the unrefunded revision baseline and scales consecutive refunds only once', async () => {
    const { tx } = makeTx();
    const refundRows: any[] = [{
      id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 33.34,
      items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.34 }],
    }];
    tx.refund.findUnique.mockImplementation(async ({ where }: any) => (
      refundRows.find((row) => row.id === where.id)
    ));
    tx.refund.findMany.mockImplementation(async () => refundRows);
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([{
      id: 'platform-source', snapshotId: 'snapshot-1', orderId: 'order-1',
      type: 'PLATFORM_RETAINED_CREDIT', amount: 30.01, configVersion: 'cfg-1',
    }]);
    let pendingDraft: any = {
      id: 'revision-original', orderId: 'order-1', status: 'PENDING',
      sourceSnapshotId: 'snapshot-1', targetSnapshotId: 'snapshot-1',
      adjustments: {
        version: 1,
        reason: 'RECONCILIATION_REVISION',
        components: [{
          key: 'funding:platform', kind: 'FUNDING',
          fundingType: 'PLATFORM_RETAINED_CREDIT',
          sourceLedgerId: 'platform-source', sourceLedgerIds: ['platform-source'],
          beforeCents: 3_001, targetCents: 3_001, deltaCents: 0,
        }],
      },
    };
    tx.orderProfitAdjustmentDraft.findMany.mockImplementation(async () => [pendingDraft]);
    tx.orderProfitAdjustmentDraft.create.mockImplementation(async ({ data }: any) => {
      pendingDraft = { id: `revision-${data.adjustments.refundId}`, ...data };
      return pendingDraft;
    });

    const service = new OrderProfitRefundService();
    await service.finalizeSuccessfulRefund(tx, 'refund-1');
    refundRows.push({
      id: 'refund-2', orderId: 'order-1', status: 'REFUNDED', amount: 33.33,
      items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.33 }],
    });
    await service.finalizeSuccessfulRefund(tx, 'refund-2');

    expect(pendingDraft.adjustments.refundBaseline).toEqual({
      originalDistributableProfitCents: 5_001,
      originalCaptainEligibleProfitCents: 3_001,
      components: [{ key: 'funding:platform', beforeCents: 3_001, targetCents: 3_001 }],
    });
    expect(pendingDraft.adjustments.components).toEqual([
      expect.objectContaining({
        key: 'funding:platform',
        beforeCents: 1_800,
        targetCents: 1_800,
        deltaCents: 0,
      }),
    ]);
  });

  it('keeps an unrecovered refund clawback outstanding and nets revision credit against actual recovery', async () => {
    const { tx } = makeTx();
    tx.rewardLedger.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.amount?.lt === 0) return [];
      return [{
        id: 'reward-withdrawn', allocationId: 'allocation-1', accountId: 'reward-account',
        userId: 'member-1', amount: 3, status: 'WITHDRAWN', entryType: 'WITHDRAW',
        account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
      }];
    });
    tx.rewardAccount.findUnique.mockResolvedValue({
      id: 'reward-account', balance: 0, frozen: 0,
    });
    tx.orderProfitAdjustmentDraft.findMany.mockResolvedValue([{
      id: 'revision-draft', orderId: 'order-1', status: 'PENDING',
      sourceSnapshotId: 'snapshot-1', targetSnapshotId: 'snapshot-1',
      adjustments: {
        version: 1,
        reason: 'RECONCILIATION_REVISION',
        components: [{
          key: 'reward:old', kind: 'REWARD', sourceLedgerId: 'reward-withdrawn',
          beforeCents: 300, targetCents: 900, deltaCents: 600,
        }],
      },
    }]);

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    const replacement = tx.orderProfitAdjustmentDraft.create.mock.calls[0][0].data.adjustments;
    expect(replacement.sources).toEqual([
      expect.objectContaining({ sourceLedgerId: 'reward-withdrawn', amountCents: 60 }),
    ]);
    expect(replacement.components).toEqual([
      expect.objectContaining({
        key: 'reward:old', beforeCents: 300, targetCents: 720, deltaCents: 420,
      }),
    ]);
  });

  it.each([
    ['partial', [{ orderItemId: 'item-a', quantity: 1, amount: 50 }], [1_600, 2_401]],
    ['full', [
      { orderItemId: 'item-a', quantity: 3, amount: 100 },
      { orderItemId: 'item-b', quantity: 2, amount: 80 },
    ], [0, 0]],
  ])(
    'refunds %s against the old source basis when old member plus platform exceeds target D',
    async (_label, refundItems, expectedTargets) => {
      const { tx, reversals } = makeTx();
      const currentSnapshot = await tx.orderProfitSnapshot.findFirst();
      const oldSnapshot = {
        ...currentSnapshot,
        id: 'snapshot-old',
        distributableProfitAmount: 100,
        captainEligibleProfitAmount: 60,
        itemBreakdown: [
          { ...ITEMS[0], distributableProfitShareCents: 6_000 },
          { ...ITEMS[1], distributableProfitShareCents: 4_000 },
        ],
      };
      tx.orderProfitSnapshot.findMany = jest.fn().mockResolvedValue([oldSnapshot, currentSnapshot]);
      const refund = {
        id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 180,
        items: refundItems,
      };
      tx.refund.findUnique.mockResolvedValue(refund);
      tx.refund.findMany.mockResolvedValue([refund]);
      tx.rewardLedger.findMany.mockResolvedValue([{
        id: 'member-old', allocationId: 'allocation-old', accountId: 'reward-account',
        userId: 'member-1', amount: 60, status: 'FROZEN', entryType: 'FREEZE',
        account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
      }]);
      tx.orderProfitFundingLedger.findMany.mockResolvedValue([{
        id: 'platform-old', snapshotId: 'snapshot-old', orderId: 'order-1',
        type: 'PLATFORM_RETAINED_CREDIT', amount: 40, configVersion: 'cfg-old',
      }]);
      tx.orderProfitAdjustmentDraft.findMany.mockResolvedValue([{
        id: 'revision-draft', orderId: 'order-1', status: 'PENDING',
        sourceSnapshotId: 'snapshot-old', targetSnapshotId: 'snapshot-1',
        adjustments: {
          version: 1,
          reason: 'RECONCILIATION_REVISION',
          reconciliationTaskId: 'task-1',
          components: [
            {
              key: 'reward:old', kind: 'REWARD', sourceLedgerId: 'member-old',
              sourceBasisSnapshotId: 'snapshot-old', beforeCents: 6_000,
              targetCents: 2_000, deltaCents: -4_000,
            },
            {
              key: 'funding:old', kind: 'FUNDING', fundingType: 'PLATFORM_RETAINED_CREDIT',
              sourceLedgerId: 'platform-old', sourceLedgerIds: ['platform-old'],
              sourceBasisSnapshotId: 'snapshot-old', beforeCents: 4_000,
              targetCents: 3_001, deltaCents: -999,
            },
          ],
        },
      }]);

      await expect(new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1'))
        .resolves.toEqual(expect.objectContaining({ mode: 'V3' }));

      expect(reversals).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceLedgerId: 'member-old', snapshotId: 'snapshot-old' }),
        expect.objectContaining({ sourceLedgerId: 'platform-old', snapshotId: 'snapshot-old' }),
      ]));
      const replacement = tx.orderProfitAdjustmentDraft.create.mock.calls[0][0].data;
      expect(replacement.adjustments.components).toEqual(expect.arrayContaining([
        expect.objectContaining({
          key: 'reward:old', sourceBasisSnapshotId: 'snapshot-old',
          targetCents: expectedTargets[0],
        }),
        expect.objectContaining({
          key: 'funding:old', sourceBasisSnapshotId: 'snapshot-old',
          targetCents: expectedTargets[1],
        }),
      ]));
      expect(replacement.adjustments.components).toHaveLength(2);
    },
  );

  it('does not treat an APPLIED clawback review as recovered money', async () => {
    const { tx, reversals } = makeTx();
    reversals.push({
      refundId: 'refund-old', orderItemId: 'item-a', sourceLedgerId: 'reward-withdrawn',
      sourceLedgerType: 'MEMBER_REWARD', incrementalReversal: 4,
    });
    tx.refund.findMany.mockResolvedValue([
      { id: 'refund-old', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.34 }] },
      { id: 'refund-1', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.33 }] },
    ]);
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'reward-withdrawn', allocationId: 'allocation-1', accountId: 'reward-account',
      userId: 'member-1', amount: 18, status: 'WITHDRAWN', entryType: 'WITHDRAW',
      account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
    }]);
    tx.rewardAccount.findUnique.mockResolvedValue({
      id: 'reward-account', balance: 0, frozen: 0,
    });
    tx.orderProfitAdjustmentDraft.findMany.mockResolvedValue([
      {
        id: 'draft-old', status: 'PENDING',
        adjustments: { sources: [{
          sourceLedgerId: 'reward-withdrawn', sourceLedgerType: 'MEMBER_REWARD',
          userId: 'member-1', amountCents: 400,
        }] },
      },
      {
        id: 'draft-applied', status: 'APPLIED',
        adjustments: { sources: [{
          sourceLedgerId: 'reward-withdrawn', sourceLedgerType: 'MEMBER_REWARD',
          userId: 'member-1', amountCents: 200,
        }] },
      },
    ]);

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.orderProfitAdjustmentDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        adjustments: expect.objectContaining({
          sources: expect.arrayContaining([
            expect.objectContaining({ sourceLedgerId: 'reward-withdrawn', amountCents: 720 }),
          ]),
        }),
      }),
    }));
  });

  it('rebuilds clawback from cumulative reversal target minus actual ledger recovery only', async () => {
    const { tx, reversals } = makeTx();
    reversals.push({
      refundId: 'refund-old', orderItemId: 'item-a', sourceLedgerId: 'reward-withdrawn',
      sourceLedgerType: 'MEMBER_REWARD', incrementalReversal: 3,
    });
    tx.refund.findMany.mockResolvedValue([
      { id: 'refund-old', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.34 }] },
      { id: 'refund-1', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.33 }] },
    ]);
    tx.rewardLedger.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.amount?.lt === 0) {
        return [{
          sourceLedgerId: 'reward-withdrawn', userId: 'member-1',
          meta: { recoveredAmount: 1 },
        }];
      }
      return [{
        id: 'reward-withdrawn', allocationId: 'allocation-1', accountId: 'reward-account',
        userId: 'member-1', amount: 15, status: 'WITHDRAWN', entryType: 'WITHDRAW',
        account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
      }];
    });
    tx.rewardAccount.findUnique.mockResolvedValue({
      id: 'reward-account', balance: 0, frozen: 0,
    });
    tx.orderProfitAdjustmentDraft.findMany.mockResolvedValue([{
      id: 'draft-applied', status: 'APPLIED',
      adjustments: { sources: [{
        sourceLedgerId: 'reward-withdrawn', sourceLedgerType: 'MEMBER_REWARD',
        userId: 'member-1', amountCents: 100,
      }] },
    }]);

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.orderProfitAdjustmentDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        adjustments: expect.objectContaining({
          sources: [expect.objectContaining({
            sourceLedgerId: 'reward-withdrawn',
            amountCents: 500,
          })],
        }),
      }),
    }));
  });

  it('loads historical captain recoveries by order before filtering original source ids', async () => {
    const { tx, reversals } = makeTx();
    reversals.push({
      refundId: 'refund-old', orderItemId: 'item-a', sourceLedgerId: 'captain-withdrawn',
      sourceLedgerType: 'CAPTAIN_DIRECT', incrementalReversal: 2,
    });
    tx.refund.findMany.mockResolvedValue([
      { id: 'refund-old', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.34 }] },
      { id: 'refund-1', items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.33 }] },
    ]);
    tx.captainOrderAttribution.findFirst.mockResolvedValue({
      id: 'attribution-1', orderId: 'order-1', programCode: 'SEAFOOD_PREPACKAGED',
      calculationModel: 'PROFIT_V3', eligibleGoodsAmount: 100.01,
    });
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([
      { id: 'platform-funding', type: 'PLATFORM_RETAINED_CREDIT', amount: 6, configVersion: 'cfg-1' },
      { id: 'direct-hold', type: 'CAPTAIN_DIRECT_HOLD', amount: -6, configVersion: 'cfg-1' },
    ]);
    const source = {
      id: 'captain-withdrawn', accountId: 'captain-account', userId: 'captain-1',
      orderAttributionId: 'attribution-1', orderId: 'order-1',
      programCode: 'SEAFOOD_PREPACKAGED', type: 'DIRECT_ORDER', amount: 6,
      status: 'WITHDRAWN', meta: {},
    };
    tx.captainCommissionLedger.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.amount?.lt === 0) {
        return [{
          userId: 'captain-1',
          meta: { originalLedgerId: 'captain-withdrawn', recoveredAmount: 1, sourceType: 'CAPTAIN_DIRECT' },
        }];
      }
      return [source];
    });

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.captainCommissionLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orderId: 'order-1', amount: { lt: 0 } }),
    }));
  });

  it('fails before account mutation when original member sources exceed D', async () => {
    const { tx } = makeTx();
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'reward-corrupt', allocationId: 'allocation-1', accountId: 'reward-account',
      userId: 'member-1', amount: 50.02, status: 'FROZEN', entryType: 'FREEZE',
      account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
    }]);

    await expect(new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1'))
      .rejects.toThrow('member refund sources exceed original D');
    expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.orderProfitRefundReversal.create).not.toHaveBeenCalled();
  });

  it('fails before account mutation when signed funding exceeds D', async () => {
    const { tx } = makeTx();
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'reward-source', allocationId: 'allocation-1', accountId: 'reward-account',
      userId: 'member-1', amount: 20, status: 'FROZEN', entryType: 'FREEZE',
      account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
    }]);
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([{
      id: 'funding-corrupt', snapshotId: 'snapshot-1', orderId: 'order-1',
      type: 'PLATFORM_RETAINED_CREDIT', amount: 50.02, configVersion: 'cfg-1',
    }]);

    await expect(new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1'))
      .rejects.toThrow('platform funding exceeds original D');
    expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.orderProfitRefundReversal.create).not.toHaveBeenCalled();
  });

  it('does not supersede the current clawback draft on an idempotent replay', async () => {
    const { tx, reversals } = makeTx();
    reversals.push({
      refundId: 'refund-1',
      orderItemId: 'item-a',
      sourceLedgerId: 'reward-withdrawn',
      incrementalReversal: 3,
    });
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'reward-withdrawn', allocationId: 'allocation-1', accountId: 'reward-account',
      userId: 'member-1', amount: 15, status: 'WITHDRAWN', entryType: 'WITHDRAW',
      account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
    }]);
    tx.orderProfitAdjustmentDraft.findMany.mockResolvedValue([{
      id: 'draft-current', status: 'PENDING', idempotencyKey: 'profit:refund:refund-1:clawback',
      adjustments: { reason: 'CLAWBACK_PENDING', sources: [] },
    }]);

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.orderProfitAdjustmentDraft.updateMany).not.toHaveBeenCalled();
    expect(tx.orderProfitAdjustmentDraft.create).not.toHaveBeenCalled();
  });

  it.each(['FROZEN', 'AVAILABLE', 'WITHDRAWN'])(
    'reverses a %s member source and records withdrawn recovery as pending clawback',
    async (status) => {
      const { tx, reversals } = makeTx();
      tx.rewardLedger.findMany.mockResolvedValue([{
        id: `reward-${status}`,
        allocationId: 'allocation-1',
        accountId: 'reward-account',
        userId: 'member-1',
        amount: 15,
        status,
        entryType: status === 'FROZEN' ? 'FREEZE' : status === 'WITHDRAWN' ? 'WITHDRAW' : 'RELEASE',
        account: { type: 'VIP_REWARD' },
        meta: { scheme: 'VIP_UPSTREAM' },
      }]);
      if (status === 'WITHDRAWN') {
        tx.rewardAccount.findUnique.mockResolvedValue({
          id: 'reward-account', balance: 0, frozen: 0,
        });
      }
      const service = new OrderProfitRefundService();

      await service.finalizeSuccessfulRefund(tx, 'refund-1');

      expect(reversals).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceLedgerId: `reward-${status}`, sourceLedgerType: 'MEMBER_REWARD' }),
      ]));
      if (status === 'WITHDRAWN') {
        expect(tx.orderProfitAdjustmentDraft.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING',
            adjustments: expect.objectContaining({ reason: 'CLAWBACK_PENDING' }),
          }),
        }));
      }
    },
  );

  it('recovers an available reward upgrade delta before clawing back the withdrawn canonical source', async () => {
    const { tx } = makeTx();
    const item = {
      orderItemId: 'item-a', quantity: 1, netGoodsRevenueCents: 1_500,
      distributableProfitShareCents: 1_500, captainEligible: true,
    };
    const refund = {
      id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 15,
      items: [{ orderItemId: 'item-a', quantity: 1, amount: 15 }],
    };
    tx.orderProfitSnapshot.findFirst.mockResolvedValue({
      id: 'snapshot-1', orderId: 'order-1', status: 'READY',
      distributableProfitAmount: 15, captainEligibleProfitAmount: 15,
      itemBreakdown: [item], ruleSnapshot: {},
    });
    tx.refund.findUnique.mockResolvedValue(refund);
    tx.refund.findMany.mockResolvedValue([refund]);
    const sources = [
      {
        id: 'reward-withdrawn', allocationId: 'allocation-1', accountId: 'reward-account',
        userId: 'member-1', amount: 10, status: 'WITHDRAWN', entryType: 'WITHDRAW',
        account: { type: 'NORMAL_REWARD' }, meta: { scheme: 'NORMAL_TREE' },
      },
      {
        id: 'reward-upgrade-delta', allocationId: 'allocation-1', accountId: 'reward-account',
        userId: 'member-1', amount: 5, status: 'AVAILABLE', entryType: 'ADJUST',
        account: { type: 'NORMAL_REWARD' },
        meta: { scheme: 'NORMAL_TREE', adjustmentKind: 'WITHDRAWN_UPGRADE_DELTA' },
      },
    ];
    tx.rewardLedger.findMany.mockImplementation(async ({ where }: any) => (
      where?.amount?.lt === 0 ? [] : sources
    ));
    tx.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'reward-account', balance: 5, frozen: 0 })
      .mockResolvedValueOnce({ id: 'reward-account', balance: 0, frozen: 0 });

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    const reversalSources = tx.rewardLedger.create.mock.calls
      .map(([call]: any[]) => call.data.sourceLedgerId);
    expect(reversalSources.slice(0, 2)).toEqual([
      'reward-upgrade-delta',
      'reward-withdrawn',
    ]);
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'reward-account' },
      data: { balance: { decrement: 5 } },
    });
    expect(tx.orderProfitAdjustmentDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        adjustments: expect.objectContaining({
          sources: [expect.objectContaining({
            sourceLedgerId: 'reward-withdrawn',
            amountCents: 1_000,
          })],
        }),
      }),
    }));
  });

  it('uses remaining reward upgrade balance before creating clawback on a partial refund', async () => {
    const { tx } = makeTx();
    const item = {
      orderItemId: 'item-a', quantity: 1, netGoodsRevenueCents: 1_500,
      distributableProfitShareCents: 1_500, captainEligible: true,
    };
    const refund = {
      id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 3,
      items: [{ orderItemId: 'item-a', quantity: 0, amount: 3 }],
    };
    tx.orderProfitSnapshot.findFirst.mockResolvedValue({
      id: 'snapshot-1', orderId: 'order-1', status: 'READY',
      distributableProfitAmount: 15, captainEligibleProfitAmount: 15,
      itemBreakdown: [item], ruleSnapshot: {},
    });
    tx.refund.findUnique.mockResolvedValue(refund);
    tx.refund.findMany.mockResolvedValue([refund]);
    tx.rewardLedger.findMany.mockImplementation(async ({ where }: any) => (
      where?.amount?.lt === 0 ? [] : [
        {
          id: 'reward-withdrawn', allocationId: 'allocation-1', accountId: 'reward-account',
          userId: 'member-1', amount: 10, status: 'WITHDRAWN', entryType: 'WITHDRAW',
          account: { type: 'NORMAL_REWARD' }, meta: { scheme: 'NORMAL_TREE' },
        },
        {
          id: 'reward-upgrade-delta', allocationId: 'allocation-1', accountId: 'reward-account',
          userId: 'member-1', amount: 5, status: 'AVAILABLE', entryType: 'ADJUST',
          account: { type: 'NORMAL_REWARD' },
          meta: { scheme: 'NORMAL_TREE', adjustmentKind: 'WITHDRAWN_UPGRADE_DELTA' },
        },
      ]
    ));
    tx.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'reward-account', balance: 5, frozen: 0 })
      .mockResolvedValueOnce({ id: 'reward-account', balance: 4, frozen: 0 });

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.rewardAccount.update.mock.calls.map(([call]: any[]) => call.data)).toEqual([
      { balance: { decrement: 1 } },
      { balance: { decrement: 2 } },
    ]);
    expect(tx.orderProfitAdjustmentDraft.create).not.toHaveBeenCalled();
  });

  it('updates cumulative captain-eligible refunded GMV for cross-month metric recalculation', async () => {
    const { tx } = makeTx();
    tx.captainOrderAttribution.findFirst.mockResolvedValue({
      id: 'attribution-1', orderId: 'order-1', programCode: 'SEAFOOD_PREPACKAGED',
      calculationModel: 'PROFIT_V3', eligibleGoodsAmount: 100.01,
    });
    const service = new OrderProfitRefundService();

    await service.finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.captainOrderAttribution.update).toHaveBeenCalledWith({
      where: { id: 'attribution-1' },
      data: { refundAmount: 33.34 },
    });
  });

  it.each(['FROZEN', 'AVAILABLE', 'WITHDRAWN'])(
    'reverses a %s captain direct source without making the spendable balance negative',
    async (status) => {
      const { tx, reversals } = makeTx();
      tx.captainOrderAttribution.findFirst.mockResolvedValue({
        id: 'attribution-1',
        orderId: 'order-1',
        programCode: 'SEAFOOD_PREPACKAGED',
        calculationModel: 'PROFIT_V3',
      });
      tx.captainCommissionLedger.findMany.mockResolvedValue([{
        id: `captain-${status}`,
        accountId: 'captain-account',
        userId: 'captain-1',
        orderAttributionId: 'attribution-1',
        orderId: 'order-1',
        programCode: 'SEAFOOD_PREPACKAGED',
        type: 'DIRECT_ORDER',
        amount: 6,
        status,
        meta: {},
      }]);
      tx.orderProfitFundingLedger.findMany.mockResolvedValue([
        { id: 'platform-funding', type: 'PLATFORM_RETAINED_CREDIT', amount: 6, configVersion: 'cfg-1' },
        { id: 'direct-hold', type: 'CAPTAIN_DIRECT_HOLD', amount: -6, configVersion: 'cfg-1' },
      ]);
      if (status === 'WITHDRAWN') {
        tx.captainAccount.findUnique.mockResolvedValue({
          id: 'captain-account', balance: 0, frozen: 0, clawback: 0,
        });
      }
      const service = new OrderProfitRefundService();

      await service.finalizeSuccessfulRefund(tx, 'refund-1');

      expect(reversals).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceLedgerId: `captain-${status}`, sourceLedgerType: 'CAPTAIN_DIRECT' }),
      ]));
      if (status === 'WITHDRAWN') {
        expect(tx.captainCommissionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ status: 'CLAWBACK_PENDING' }),
        }));
      }
    },
  );

  it('recovers an available captain upgrade delta before recording withdrawn clawback', async () => {
    const { tx } = makeTx();
    const item = {
      orderItemId: 'item-a', quantity: 1, netGoodsRevenueCents: 1_500,
      distributableProfitShareCents: 1_500, captainEligible: true,
    };
    const refund = {
      id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 15,
      items: [{ orderItemId: 'item-a', quantity: 1, amount: 15 }],
    };
    tx.orderProfitSnapshot.findFirst.mockResolvedValue({
      id: 'snapshot-1', orderId: 'order-1', status: 'READY',
      distributableProfitAmount: 15, captainEligibleProfitAmount: 15,
      itemBreakdown: [item], ruleSnapshot: {},
    });
    tx.refund.findUnique.mockResolvedValue(refund);
    tx.refund.findMany.mockResolvedValue([refund]);
    tx.captainOrderAttribution.findFirst.mockResolvedValue({
      id: 'attribution-1', orderId: 'order-1', directCaptainUserId: 'captain-1',
      programCode: 'SEAFOOD_PREPACKAGED', calculationModel: 'PROFIT_V3',
      eligibleGoodsAmount: 15, profitSnapshotId: 'snapshot-1',
    });
    const sources = [
      {
        id: 'captain-withdrawn', accountId: 'captain-account', userId: 'captain-1',
        orderAttributionId: 'attribution-1', orderId: 'order-1',
        programCode: 'SEAFOOD_PREPACKAGED', type: 'DIRECT_ORDER', amount: 10,
        status: 'WITHDRAWN', meta: {},
      },
      {
        id: 'captain-upgrade-delta', accountId: 'captain-account', userId: 'captain-1',
        orderAttributionId: 'attribution-1', orderId: 'order-1',
        programCode: 'SEAFOOD_PREPACKAGED', type: 'DIRECT_ORDER', amount: 5,
        status: 'AVAILABLE', meta: { adjustmentKind: 'WITHDRAWN_UPGRADE_DELTA' },
      },
    ];
    tx.captainCommissionLedger.findMany.mockImplementation(async ({ where }: any) => (
      where?.amount?.lt === 0 ? [] : sources
    ));
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([
      {
        id: 'platform-retained', snapshotId: 'snapshot-1', orderId: 'order-1',
        type: 'PLATFORM_RETAINED_CREDIT', amount: 15, configVersion: 'cfg-1',
      },
      {
        id: 'captain-direct-hold', snapshotId: 'snapshot-1', orderId: 'order-1',
        type: 'CAPTAIN_DIRECT_HOLD', amount: -15, configVersion: 'cfg-1',
      },
    ]);
    tx.captainAccount.findUnique
      .mockResolvedValueOnce({ id: 'captain-account', balance: 5, frozen: 0, clawback: 0 })
      .mockResolvedValueOnce({ id: 'captain-account', balance: 0, frozen: 0, clawback: 0 });

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    const accountUpdates = tx.captainAccount.update.mock.calls.map(([call]: any[]) => call.data);
    expect(accountUpdates[0]).toEqual({ balance: { decrement: 5 } });
    expect(accountUpdates).toContainEqual({ clawback: { increment: 10 } });
    expect(tx.orderProfitAdjustmentDraft.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        adjustments: expect.objectContaining({
          sources: [expect.objectContaining({
            sourceLedgerId: 'captain-withdrawn',
            amountCents: 1_000,
          })],
        }),
      }),
    }));
  });

  it('uses remaining captain upgrade balance before recording clawback on a partial refund', async () => {
    const { tx } = makeTx();
    const item = {
      orderItemId: 'item-a', quantity: 1, netGoodsRevenueCents: 1_500,
      distributableProfitShareCents: 1_500, captainEligible: true,
    };
    const refund = {
      id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 3,
      items: [{ orderItemId: 'item-a', quantity: 0, amount: 3 }],
    };
    tx.orderProfitSnapshot.findFirst.mockResolvedValue({
      id: 'snapshot-1', orderId: 'order-1', status: 'READY',
      distributableProfitAmount: 15, captainEligibleProfitAmount: 15,
      itemBreakdown: [item], ruleSnapshot: {},
    });
    tx.refund.findUnique.mockResolvedValue(refund);
    tx.refund.findMany.mockResolvedValue([refund]);
    tx.captainOrderAttribution.findFirst.mockResolvedValue({
      id: 'attribution-1', orderId: 'order-1', directCaptainUserId: 'captain-1',
      programCode: 'SEAFOOD_PREPACKAGED', calculationModel: 'PROFIT_V3',
      eligibleGoodsAmount: 15, profitSnapshotId: 'snapshot-1',
    });
    tx.captainCommissionLedger.findMany.mockImplementation(async ({ where }: any) => (
      where?.amount?.lt === 0 ? [] : [
        {
          id: 'captain-withdrawn', accountId: 'captain-account', userId: 'captain-1',
          orderAttributionId: 'attribution-1', orderId: 'order-1',
          programCode: 'SEAFOOD_PREPACKAGED', type: 'DIRECT_ORDER', amount: 10,
          status: 'WITHDRAWN', meta: {},
        },
        {
          id: 'captain-upgrade-delta', accountId: 'captain-account', userId: 'captain-1',
          orderAttributionId: 'attribution-1', orderId: 'order-1',
          programCode: 'SEAFOOD_PREPACKAGED', type: 'DIRECT_ORDER', amount: 5,
          status: 'AVAILABLE', meta: { adjustmentKind: 'WITHDRAWN_UPGRADE_DELTA' },
        },
      ]
    ));
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([
      {
        id: 'platform-retained', snapshotId: 'snapshot-1', orderId: 'order-1',
        type: 'PLATFORM_RETAINED_CREDIT', amount: 15, configVersion: 'cfg-1',
      },
      {
        id: 'captain-direct-hold', snapshotId: 'snapshot-1', orderId: 'order-1',
        type: 'CAPTAIN_DIRECT_HOLD', amount: -15, configVersion: 'cfg-1',
      },
    ]);
    tx.captainAccount.findUnique
      .mockResolvedValueOnce({ id: 'captain-account', balance: 5, frozen: 0, clawback: 0 })
      .mockResolvedValueOnce({ id: 'captain-account', balance: 4, frozen: 0, clawback: 0 });

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    expect(tx.captainAccount.update.mock.calls.map(([call]: any[]) => call.data)).toEqual([
      { balance: { decrement: 1 } },
      { balance: { decrement: 2 } },
    ]);
    expect(tx.orderProfitAdjustmentDraft.create).not.toHaveBeenCalled();
  });

  it.each([
    ['APPROVED', 'AVAILABLE'],
    ['PENDING_REVIEW', 'AVAILABLE'],
    ['PAID', 'WITHDRAWN'],
  ])('adjusts a %s monthly source using its original settlement order', async (settlementStatus, ledgerStatus) => {
    const { tx, reversals } = makeTx();
    tx.captainOrderAttribution.findFirst.mockResolvedValue({
      id: 'attribution-1', orderId: 'order-1', programCode: 'SEAFOOD_PREPACKAGED', calculationModel: 'PROFIT_V3',
    });
    tx.captainMonthlySettlementOrder.findUnique.mockResolvedValue({
      id: 'settlement-order-1',
      orderAttributionId: 'attribution-1',
      settlementId: 'settlement-1',
      baseManagementAmount: 3,
      growthBonusAmount: 2,
      cultivationBonusAmount: 1,
      performanceBonusAmount: 1,
      reversedAmount: 0,
      settlement: { id: 'settlement-1', status: settlementStatus, captainUserId: 'captain-1' },
    });
    tx.captainCommissionLedger.findMany.mockResolvedValue([
      {
        id: 'monthly-management', accountId: 'captain-account', userId: 'captain-1',
        settlementId: 'settlement-1', type: 'MANAGEMENT_ALLOWANCE', amount: 3,
        status: ledgerStatus, programCode: 'SEAFOOD_PREPACKAGED', meta: {},
      },
      {
        id: 'monthly-growth', accountId: 'captain-account', userId: 'captain-1',
        settlementId: 'settlement-1', type: 'GROWTH_BONUS', amount: 2,
        status: ledgerStatus, programCode: 'SEAFOOD_PREPACKAGED', meta: {},
      },
      {
        id: 'monthly-cultivation', accountId: 'captain-account', userId: 'captain-1',
        settlementId: 'settlement-1', type: 'CULTIVATION_BONUS', amount: 1,
        status: ledgerStatus, programCode: 'SEAFOOD_PREPACKAGED', meta: {},
      },
      {
        id: 'monthly-performance', accountId: 'captain-account', userId: 'captain-1',
        settlementId: 'settlement-1', type: 'PERFORMANCE_BONUS', amount: 1,
        status: ledgerStatus, programCode: 'SEAFOOD_PREPACKAGED', meta: {},
      },
    ]);
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([
      { id: 'platform-funding', type: 'PLATFORM_RETAINED_CREDIT', amount: 7, configVersion: 'cfg-1' },
      { id: 'monthly-hold', type: 'CAPTAIN_MONTHLY_HOLD', amount: -7, configVersion: 'cfg-1' },
    ]);
    if (settlementStatus === 'PAID') {
      tx.captainAccount.findUnique.mockResolvedValue({
        id: 'captain-account', balance: 0, frozen: 0, clawback: 0,
      });
    }
    const service = new OrderProfitRefundService();

    await service.finalizeSuccessfulRefund(tx, 'refund-1');

    expect(reversals).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceLedgerId: 'monthly-management', sourceLedgerType: 'CAPTAIN_MONTHLY' }),
    ]));
    if (settlementStatus === 'PAID') {
      expect(tx.captainCommissionLedger.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'CLAWBACK_PENDING' }),
      }));
    } else {
      expect(tx.captainMonthlySettlement.update).toHaveBeenCalled();
    }
  });

  it('refunds a draft settlement with partial release and positive monthly actual without breaking conservation', async () => {
    const { tx } = makeTx();
    tx.orderProfitSnapshot.findFirst.mockResolvedValue({
      id: 'snapshot-1', orderId: 'order-1', status: 'READY',
      distributableProfitAmount: 50.01, captainEligibleProfitAmount: 50.01,
      itemBreakdown: ITEMS.map((item) => ({ ...item, captainEligible: true })),
      ruleSnapshot: {},
    });
    tx.captainOrderAttribution.findFirst.mockResolvedValue({
      id: 'attribution-1', orderId: 'order-1', programCode: 'SEAFOOD_PREPACKAGED',
      calculationModel: 'PROFIT_V3', profitSnapshotId: 'snapshot-1', eligibleGoodsAmount: 100.01,
    });
    tx.captainMonthlySettlementOrder.findUnique.mockResolvedValue({
      id: 'settlement-order-1', orderAttributionId: 'attribution-1', settlementId: 'settlement-1',
      baseManagementAmount: 3, growthBonusAmount: 0, cultivationBonusAmount: 0,
      performanceBonusAmount: 0, reservedAmount: 10, releasedAmount: 7,
      settlement: { id: 'settlement-1', status: 'DRAFT', captainUserId: 'captain-1' },
    });
    tx.captainCommissionLedger.findMany.mockResolvedValue([]);
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([
      { id: 'platform-funding', snapshotId: 'snapshot-1', type: 'PLATFORM_RETAINED_CREDIT', amount: 3, configVersion: 'cfg-1' },
      { id: 'monthly-hold', snapshotId: 'snapshot-1', type: 'CAPTAIN_MONTHLY_HOLD', amount: -10, configVersion: 'cfg-1' },
      { id: 'monthly-release', snapshotId: 'snapshot-1', type: 'CAPTAIN_MONTHLY_RELEASE', amount: 7, configVersion: 'cfg-1' },
    ]);

    await expect(new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1'))
      .resolves.toEqual(expect.objectContaining({ mode: 'V3' }));

    const fundingAdjustments = new Map<string, number>(
      tx.orderProfitFundingLedger.create.mock.calls.map(([call]: any[]) => [
        call.data.sourceLedgerId,
        Math.round(call.data.amount * 100),
      ]),
    );
    const remainingNetCents = 300 - 1_000 + 700
      + [...fundingAdjustments.values()].reduce((sum, cents) => sum + cents, 0);
    expect(fundingAdjustments.has('monthly-hold')).toBe(true);
    expect(fundingAdjustments.has('monthly-release')).toBe(true);
    expect(remainingNetCents).toBe(0);
  });

  it('applies consecutive refunds to a PENDING_REVIEW monthly settlement cumulatively', async () => {
    const { tx, reversals } = makeTx();
    const refundRows: any[] = [{
      id: 'refund-1', orderId: 'order-1', status: 'REFUNDED', amount: 33.34,
      items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.34 }],
    }];
    tx.refund.findUnique.mockImplementation(async ({ where }: any) =>
      refundRows.find((row) => row.id === where.id));
    tx.refund.findMany.mockImplementation(async () => refundRows);
    tx.captainOrderAttribution.findFirst.mockResolvedValue({
      id: 'attribution-1', orderId: 'order-1', programCode: 'SEAFOOD_PREPACKAGED',
      calculationModel: 'PROFIT_V3', eligibleGoodsAmount: 100.01,
    });
    const settlementOrder = {
      id: 'settlement-order-1', orderAttributionId: 'attribution-1', settlementId: 'settlement-1',
      baseManagementAmount: 3, growthBonusAmount: 0, cultivationBonusAmount: 0,
      performanceBonusAmount: 0, reversedAmount: 0,
      settlement: {
        id: 'settlement-1', status: 'APPROVED', captainUserId: 'captain-1',
        totalAmount: 3, taxAmount: 0,
      },
    };
    tx.captainMonthlySettlementOrder.findUnique.mockImplementation(async () => settlementOrder);
    tx.captainMonthlySettlement.update.mockImplementation(async ({ data }: any) => {
      settlementOrder.settlement.status = data.status;
      return settlementOrder.settlement;
    });
    tx.captainCommissionLedger.findMany.mockResolvedValue([{
      id: 'monthly-management', accountId: 'captain-account', userId: 'captain-1',
      settlementId: 'settlement-1', type: 'MANAGEMENT_ALLOWANCE', amount: 3,
      status: 'AVAILABLE', programCode: 'SEAFOOD_PREPACKAGED', meta: {},
    }]);
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([
      { id: 'platform-funding', type: 'PLATFORM_RETAINED_CREDIT', amount: 3, configVersion: 'cfg-1' },
      { id: 'monthly-hold', type: 'CAPTAIN_MONTHLY_HOLD', amount: -3, configVersion: 'cfg-1' },
    ]);
    const service = new OrderProfitRefundService();

    await service.finalizeSuccessfulRefund(tx, 'refund-1');
    refundRows.push({
      id: 'refund-2', orderId: 'order-1', status: 'REFUNDED', amount: 33.33,
      items: [{ orderItemId: 'item-a', quantity: 1, amount: 33.33 }],
    });
    await service.finalizeSuccessfulRefund(tx, 'refund-2');

    const monthlyRows = reversals.filter((row) => row.sourceLedgerId === 'monthly-management');
    expect(monthlyRows.map((row) => row.incrementalReversal)).toEqual([1, 1]);
    expect(tx.captainMonthlySettlement.update).toHaveBeenCalledTimes(2);
    expect(tx.captainMonthlySettlement.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING_REVIEW', totalAmount: { decrement: 1 } }),
    }));
    expect(tx.captainMonthlySettlementOrder.update).toHaveBeenCalledTimes(2);
    expect(tx.captainOrderAttribution.update).toHaveBeenLastCalledWith({
      where: { id: 'attribution-1' },
      data: { refundAmount: 66.67 },
    });
  });

  it('is idempotent when the same successful refund callback is replayed', async () => {
    const { tx, reversals } = makeTx();
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([{
      id: 'funding-1', snapshotId: 'snapshot-1', orderId: 'order-1',
      type: 'PLATFORM_RETAINED_CREDIT', amount: 50.01, configVersion: 'cfg-1',
    }]);
    const service = new OrderProfitRefundService();

    await service.finalizeSuccessfulRefund(tx, 'refund-1');
    const firstCount = reversals.length;
    await service.finalizeSuccessfulRefund(tx, 'refund-1');

    expect(reversals).toHaveLength(firstCount);
  });

  it('preserves order-level D after member, captain and funding reversals', async () => {
    const { tx } = makeTx();
    tx.rewardLedger.findMany.mockResolvedValue([{
      id: 'member-source', allocationId: 'allocation-1', accountId: 'reward-account',
      userId: 'member-1', amount: 20, status: 'AVAILABLE', entryType: 'RELEASE',
      account: { type: 'VIP_REWARD' }, meta: { scheme: 'VIP_UPSTREAM' },
    }]);
    tx.captainOrderAttribution.findFirst.mockResolvedValue({
      id: 'attribution-1', orderId: 'order-1', programCode: 'SEAFOOD_PREPACKAGED',
      calculationModel: 'PROFIT_V3', eligibleGoodsAmount: 100.01,
    });
    tx.captainCommissionLedger.findMany.mockResolvedValue([{
      id: 'captain-source', accountId: 'captain-account', userId: 'captain-1',
      orderAttributionId: 'attribution-1', orderId: 'order-1',
      programCode: 'SEAFOOD_PREPACKAGED', type: 'DIRECT_ORDER', amount: 6,
      status: 'AVAILABLE', meta: {},
    }]);
    tx.orderProfitFundingLedger.findMany.mockResolvedValue([
      {
        id: 'platform-funding', snapshotId: 'snapshot-1', orderId: 'order-1',
        type: 'PLATFORM_RETAINED_CREDIT', amount: 30.01, configVersion: 'cfg-1',
      },
      {
        id: 'captain-direct-hold', snapshotId: 'snapshot-1', orderId: 'order-1',
        type: 'CAPTAIN_DIRECT_HOLD', amount: -6, configVersion: 'cfg-1',
      },
    ]);

    await new OrderProfitRefundService().finalizeSuccessfulRefund(tx, 'refund-1');

    const memberReversalCents = Math.round(
      Math.abs(tx.rewardLedger.create.mock.calls[0][0].data.amount) * 100,
    );
    const captainReversalCents = Math.round(
      Math.abs(tx.captainCommissionLedger.create.mock.calls[0][0].data.amount) * 100,
    );
    const fundingAdjustments = new Map<string, number>(
      tx.orderProfitFundingLedger.create.mock.calls.map(([call]: any[]) => [
        call.data.sourceLedgerId,
        Math.round(call.data.amount * 100),
      ]),
    );
    const remainingMember = 2_000 - memberReversalCents;
    const remainingCaptain = 600 - captainReversalCents;
    const remainingFunding = 3_001 - 600
      + (fundingAdjustments.get('platform-funding') ?? 0)
      + (fundingAdjustments.get('captain-direct-hold') ?? 0);

    expect({ memberReversalCents, captainReversalCents, fundingAdjustments }).toEqual({
      memberReversalCents: 400,
      captainReversalCents: 200,
      fundingAdjustments: new Map([
        ['platform-funding', -600],
        ['captain-direct-hold', 200],
      ]),
    });
    expect(remainingMember + remainingCaptain + remainingFunding).toBe(4_001);
  });
});
