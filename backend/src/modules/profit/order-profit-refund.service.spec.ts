import {
  buildCumulativeRefundTargets,
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
      { refundId: 'r1', orderItemId: 'item-a', quantity: null, goodsAmountCents: 2_500 },
      { refundId: 'r2', orderItemId: 'item-a', quantity: null, goodsAmountCents: 2_500 },
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
        quantity: null,
        goodsAmountCents: 4_000,
        channelRefundAmountCents: 5_500,
      },
    ]);

    expect(targets['item-b'].cumulativeRefundRatio).toBe(0.5);
    expect(targets['item-b'].cumulativeProfitTargetCents).toBe(1_000);
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
});
