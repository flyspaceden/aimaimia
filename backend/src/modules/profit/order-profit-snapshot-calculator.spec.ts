import { OrderProfitSnapshotCalculator } from './order-profit-snapshot-calculator';
import { allocateCentsByLargestRemainder, yuanToCents } from './money-allocation';

describe('OrderProfitSnapshotCalculator', () => {
  const calculator = new OrderProfitSnapshotCalculator();

  it('calculates the golden discounted-profit vector in integer cents', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 13_500,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 13_500,
          quantity: 1,
          unitCostCents: 10_000,
          isPrize: false,
          captainEligible: true,
        },
      ],
      vipDiscountCents: 675,
      rewardDeductionCents: 500,
      couponDiscountCents: 1_000,
    });

    expect(result).toMatchObject({
      status: 'READY',
      grossGoodsAmountCents: 13_500,
      netGoodsRevenueCents: 11_325,
      productCostCents: 10_000,
      distributableProfitCents: 1_325,
      captainEligibleProfitCents: 1_325,
    });
    expect(result.itemBreakdown).toEqual([
      expect.objectContaining({
        orderItemId: 'item-a',
        vipDiscountCents: 675,
        rewardDeductionCents: 500,
        groupBuyRebateDeductionCents: 0,
        couponDiscountCents: 1_000,
        totalDiscountCents: 2_175,
        netGoodsRevenueCents: 11_325,
        grossProfitCents: 1_325,
        distributableProfitShareCents: 1_325,
      }),
    ]);
  });

  it('floors profit once at order level after an explicit item discount', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 13_500,
      otherGoodsDiscountCents: 1_500,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 13_500,
          quantity: 1,
          unitCostCents: 10_000,
          explicitDiscountCents: 1_500,
          isPrize: false,
          captainEligible: true,
        },
      ],
      vipDiscountCents: 675,
      rewardDeductionCents: 500,
      couponDiscountCents: 1_000,
    });

    expect(result.status).toBe('READY');
    expect(result.netGoodsRevenueCents).toBe(9_825);
    expect(result.itemBreakdown[0].grossProfitCents).toBe(-175);
    expect(result.distributableProfitCents).toBe(0);
    expect(result.captainEligibleProfitCents).toBe(0);
  });

  it('sums positive and negative item margins before applying the order floor', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 10_000,
      items: [
        {
          id: 'positive',
          unitPriceCents: 5_000,
          quantity: 1,
          unitCostCents: 3_000,
          isPrize: false,
          captainEligible: true,
        },
        {
          id: 'negative',
          unitPriceCents: 5_000,
          quantity: 1,
          unitCostCents: 6_500,
          isPrize: false,
          captainEligible: false,
        },
      ],
    });

    expect(result.distributableProfitCents).toBe(500);
    expect(result.itemBreakdown).toEqual([
      expect.objectContaining({
        orderItemId: 'negative',
        grossProfitCents: -1_500,
        distributableProfitShareCents: 0,
      }),
      expect.objectContaining({
        orderItemId: 'positive',
        grossProfitCents: 2_000,
        distributableProfitShareCents: 500,
      }),
    ]);
    expect(result.captainEligibleProfitCents).toBe(500);
  });

  it('applies explicit discounts first and redistributes later discounts by remaining capacity', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 200,
      otherGoodsDiscountCents: 100,
      vipDiscountCents: 50,
      rewardDeductionCents: 50,
      groupBuyRebateDeductionCents: 0,
      couponDiscountCents: 0,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 100,
          quantity: 1,
          unitCostCents: 10,
          explicitDiscountCents: 100,
          isPrize: false,
          captainEligible: false,
        },
        {
          id: 'item-b',
          unitPriceCents: 100,
          quantity: 1,
          unitCostCents: 10,
          isPrize: false,
          captainEligible: false,
        },
      ],
    });

    expect(result.status).toBe('READY');
    expect(result.itemBreakdown).toEqual([
      expect.objectContaining({
        orderItemId: 'item-a',
        explicitDiscountCents: 100,
        vipDiscountCents: 0,
        rewardDeductionCents: 0,
        netGoodsRevenueCents: 0,
      }),
      expect.objectContaining({
        orderItemId: 'item-b',
        explicitDiscountCents: 0,
        vipDiscountCents: 50,
        rewardDeductionCents: 50,
        netGoodsRevenueCents: 0,
      }),
    ]);
  });

  it('uses largest remainders with OrderItem.id as the stable last-cent tie-breaker', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 300,
      vipDiscountCents: 1,
      items: [
        { id: 'item-c', unitPriceCents: 100, quantity: 1, unitCostCents: 10, isPrize: false, captainEligible: false },
        { id: 'item-b', unitPriceCents: 100, quantity: 1, unitCostCents: 10, isPrize: false, captainEligible: false },
        { id: 'item-a', unitPriceCents: 100, quantity: 1, unitCostCents: 10, isPrize: false, captainEligible: false },
      ],
    });

    expect(result.itemBreakdown.map((item) => [item.orderItemId, item.vipDiscountCents])).toEqual([
      ['item-a', 1],
      ['item-b', 0],
      ['item-c', 0],
    ]);
  });

  it('excludes prize items from revenue, cost, discounts and profit', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 1_000,
      couponDiscountCents: 100,
      items: [
        {
          id: 'prize',
          unitPriceCents: 99_999,
          quantity: 1,
          unitCostCents: null,
          isPrize: true,
          captainEligible: true,
        },
        {
          id: 'regular',
          unitPriceCents: 1_000,
          quantity: 1,
          unitCostCents: 600,
          isPrize: false,
          captainEligible: true,
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'READY',
      grossGoodsAmountCents: 1_000,
      netGoodsRevenueCents: 900,
      productCostCents: 600,
      distributableProfitCents: 300,
      captainEligibleProfitCents: 300,
    });
    expect(result.itemBreakdown.map((item) => item.orderItemId)).toEqual(['regular']);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['zero', 0],
    ['negative', -1],
  ])('requires reconciliation when a non-prize item cost is %s', (_label, unitCostCents) => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 1_000,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 1_000,
          quantity: 1,
          unitCostCents,
          isPrize: false,
          captainEligible: true,
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      errorCode: 'ORDER_PROFIT_COST_MISSING',
      distributableProfitCents: 0,
      captainEligibleProfitCents: 0,
    });
  });

  it('requires reconciliation when declared gross does not equal non-prize item gross', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 999,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 1_000,
          quantity: 1,
          unitCostCents: 600,
          isPrize: false,
          captainEligible: false,
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      errorCode: 'ORDER_PROFIT_CONSERVATION_FAILED',
      distributableProfitCents: 0,
      captainEligibleProfitCents: 0,
    });
  });

  it('requires reconciliation instead of creating negative item revenue when discounts exceed capacity', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 1_000,
      vipDiscountCents: 1_001,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 1_000,
          quantity: 1,
          unitCostCents: 600,
          isPrize: false,
          captainEligible: true,
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      errorCode: 'ORDER_PROFIT_CONSERVATION_FAILED',
      distributableProfitCents: 0,
      captainEligibleProfitCents: 0,
    });
    expect(result.itemBreakdown[0].netGoodsRevenueCents).toBeGreaterThanOrEqual(0);
  });

  it('derives C only from captain-eligible item profit shares and keeps 0 <= C <= D', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 15_000,
      items: [
        {
          id: 'captain-item',
          unitPriceCents: 5_000,
          quantity: 1,
          unitCostCents: 3_000,
          isPrize: false,
          captainEligible: true,
        },
        {
          id: 'loss-item',
          unitPriceCents: 5_000,
          quantity: 1,
          unitCostCents: 5_500,
          isPrize: false,
          captainEligible: false,
        },
        {
          id: 'other-item',
          unitPriceCents: 5_000,
          quantity: 1,
          unitCostCents: 4_000,
          isPrize: false,
          captainEligible: false,
        },
      ],
    });

    expect(result.distributableProfitCents).toBe(2_500);
    expect(result.itemBreakdown.map((item) => [item.orderItemId, item.distributableProfitShareCents])).toEqual([
      ['captain-item', 1_667],
      ['loss-item', 0],
      ['other-item', 833],
    ]);
    expect(result.captainEligibleProfitCents).toBe(1_667);
    expect(result.captainEligibleProfitCents).toBeGreaterThanOrEqual(0);
    expect(result.captainEligibleProfitCents).toBeLessThanOrEqual(result.distributableProfitCents);
  });

  it('does not deduct a product promotion again because unitPriceCents is already promotional', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 9_000,
      items: [
        {
          id: 'promotional-item',
          unitPriceCents: 9_000,
          quantity: 1,
          unitCostCents: 7_000,
          isPrize: false,
          captainEligible: false,
        },
      ],
    });

    expect(result.netGoodsRevenueCents).toBe(9_000);
    expect(result.distributableProfitCents).toBe(2_000);
  });

  it('applies the complete discount sequence against each stage remaining capacity', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 200,
      otherGoodsDiscountCents: 90,
      vipDiscountCents: 20,
      rewardDeductionCents: 20,
      groupBuyRebateDeductionCents: 30,
      couponDiscountCents: 40,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 100,
          quantity: 1,
          unitCostCents: 1,
          explicitDiscountCents: 90,
          isPrize: false,
          captainEligible: false,
        },
        {
          id: 'item-b',
          unitPriceCents: 100,
          quantity: 1,
          unitCostCents: 1,
          isPrize: false,
          captainEligible: false,
        },
      ],
    });

    expect(result.status).toBe('READY');
    expect(result.itemBreakdown).toEqual([
      expect.objectContaining({
        orderItemId: 'item-a',
        explicitDiscountCents: 90,
        vipDiscountCents: 2,
        rewardDeductionCents: 2,
        groupBuyRebateDeductionCents: 3,
        couponDiscountCents: 3,
        netGoodsRevenueCents: 0,
      }),
      expect.objectContaining({
        orderItemId: 'item-b',
        explicitDiscountCents: 0,
        vipDiscountCents: 18,
        rewardDeductionCents: 18,
        groupBuyRebateDeductionCents: 27,
        couponDiscountCents: 37,
        netGoodsRevenueCents: 0,
      }),
    ]);
  });

  it('redistributes all remaining cents after a high-weight target reaches capacity', () => {
    expect(allocateCentsByLargestRemainder(50, [
      { id: 'item-a', weightCents: 100, capacityCents: 1 },
      { id: 'item-b', weightCents: 1, capacityCents: 100 },
    ])).toEqual({
      allocations: { 'item-a': 1, 'item-b': 49 },
      unallocatedCents: 0,
    });
  });

  it('fails closed instead of throwing when aggregate item amounts exceed safe integers', () => {
    expect(() => calculator.calculate({
      grossGoodsAmountCents: 2,
      vipDiscountCents: 1,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 1,
          quantity: 1,
          unitCostCents: Number.MAX_SAFE_INTEGER,
          isPrize: false,
          captainEligible: true,
        },
        {
          id: 'item-b',
          unitPriceCents: 1,
          quantity: 1,
          unitCostCents: Number.MAX_SAFE_INTEGER,
          isPrize: false,
          captainEligible: false,
        },
      ],
    })).not.toThrow();

    expect(calculator.calculate({
      grossGoodsAmountCents: 2,
      vipDiscountCents: 1,
      items: [
        {
          id: 'item-a',
          unitPriceCents: 1,
          quantity: 1,
          unitCostCents: Number.MAX_SAFE_INTEGER,
          isPrize: false,
          captainEligible: true,
        },
        {
          id: 'item-b',
          unitPriceCents: 1,
          quantity: 1,
          unitCostCents: Number.MAX_SAFE_INTEGER,
          isPrize: false,
          captainEligible: false,
        },
      ],
    })).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      errorCode: 'ORDER_PROFIT_CONSERVATION_FAILED',
      distributableProfitCents: 0,
      captainEligibleProfitCents: 0,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'sanitizes non-finite cost %s in the reconciliation breakdown',
    (unitCostCents) => {
      const result = calculator.calculate({
        grossGoodsAmountCents: 100,
        items: [{
          id: 'item-a',
          unitPriceCents: 100,
          quantity: 1,
          unitCostCents,
          isPrize: false,
          captainEligible: true,
        }],
      });

      expect(result.status).toBe('RECONCILIATION_REQUIRED');
      expect(result.itemBreakdown[0].unitCostCents).toBe(0);
      expect(Number.isFinite(result.itemBreakdown[0].unitCostCents)).toBe(true);
    },
  );

  it('keeps C at zero when captain-eligible items lose money and only other items profit', () => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 3_000,
      items: [
        {
          id: 'captain-loss',
          unitPriceCents: 1_000,
          quantity: 1,
          unitCostCents: 1_500,
          isPrize: false,
          captainEligible: true,
        },
        {
          id: 'other-profit',
          unitPriceCents: 2_000,
          quantity: 1,
          unitCostCents: 1_000,
          isPrize: false,
          captainEligible: false,
        },
      ],
    });

    expect(result.distributableProfitCents).toBe(500);
    expect(result.captainEligibleProfitCents).toBe(0);
  });

  it('rounds yuan to cents half-up and rejects unsafe or non-finite conversions', () => {
    expect(yuanToCents(10.075)).toBe(1_008);
    expect(yuanToCents(0.1 + 0.2)).toBe(30);
    expect(() => yuanToCents(Number.NaN)).toThrow();
    expect(() => yuanToCents(Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it.each([
    'grossGoodsAmountCents',
    'vipDiscountCents',
    'rewardDeductionCents',
    'groupBuyRebateDeductionCents',
    'couponDiscountCents',
    'otherGoodsDiscountCents',
  ] as const)('sanitizes non-finite top-level amount %s for persistence', (field) => {
    const result = calculator.calculate({
      grossGoodsAmountCents: 100,
      vipDiscountCents: 0,
      rewardDeductionCents: 0,
      groupBuyRebateDeductionCents: 0,
      couponDiscountCents: 0,
      otherGoodsDiscountCents: 0,
      items: [],
      [field]: Number.NaN,
    });

    expect(result).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      errorCode: 'ORDER_PROFIT_CONSERVATION_FAILED',
      distributableProfitCents: 0,
      captainEligibleProfitCents: 0,
      errorMeta: {
        reason: 'INVALID_ORDER_AMOUNT',
        invalidAmountFields: [field],
      },
    });
    for (const value of [
      result.grossGoodsAmountCents,
      result.vipDiscountCents,
      result.rewardDeductionCents,
      result.groupBuyRebateDeductionCents,
      result.couponDiscountCents,
      result.otherGoodsDiscountCents,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
