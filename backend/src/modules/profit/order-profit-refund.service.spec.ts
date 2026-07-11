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
  });

  it('subtracts APPLIED recovery from the cumulative replacement clawback', async () => {
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
            expect.objectContaining({ sourceLedgerId: 'reward-withdrawn', amountCents: 520 }),
          ]),
        }),
      }),
    }));
  });

  it('rebuilds clawback from cumulative reversal target minus recovered and APPLIED amounts', async () => {
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
            amountCents: 400,
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
    tx.captainCommissionLedger.findMany.mockResolvedValue([{
      id: 'monthly-management', accountId: 'captain-account', userId: 'captain-1',
      settlementId: 'settlement-1', type: 'MANAGEMENT_ALLOWANCE', amount: 3,
      status: ledgerStatus, programCode: 'SEAFOOD_PREPACKAGED', meta: {},
    }]);
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
