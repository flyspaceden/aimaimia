import {
  allocateOrderAssetAmount,
  calculateOrderAssetAmount,
  calculateRefundProductAmount,
  clampReversalAmount,
  roundMoney,
} from './digital-asset-ledger-calculator';

describe('digital asset ledger calculator', () => {
  it('calculates order asset amount excluding shipping, reward deduction, coupon and vip discount', () => {
    expect(calculateOrderAssetAmount({
      goodsAmount: 200,
      shippingFee: 12,
      discountAmount: 10,
      vipDiscountAmount: 20,
      totalCouponDiscount: 5,
    })).toBe(165);
  });

  it('clamps negative order asset amount to zero', () => {
    expect(calculateOrderAssetAmount({
      goodsAmount: 30,
      discountAmount: 20,
      vipDiscountAmount: 20,
      totalCouponDiscount: 10,
    })).toBe(0);
  });

  it('allocates residual to the last non-prize line in stable createdAt/id order', () => {
    const result = allocateOrderAssetAmount({
      orderAssetAmount: 10,
      items: [
        { orderItemId: 'b', skuId: 's2', quantity: 1, unitPrice: 10, isPrize: false, createdAt: new Date('2026-01-02') },
        { orderItemId: 'a', skuId: 's1', quantity: 1, unitPrice: 10, isPrize: false, createdAt: new Date('2026-01-01') },
        { orderItemId: 'gift', skuId: 's3', quantity: 1, unitPrice: 999, isPrize: true, createdAt: new Date('2026-01-01') },
      ],
    });

    expect(result).toEqual({
      allocations: [
        { orderItemId: 'a', skuId: 's1', quantity: 1, grossAmount: 10, assetAmount: 5 },
        { orderItemId: 'b', skuId: 's2', quantity: 1, grossAmount: 10, assetAmount: 5 },
      ],
      residualOrderItemId: 'b',
    });
  });

  it('puts fractional rounding residual on the last sorted line', () => {
    const result = allocateOrderAssetAmount({
      orderAssetAmount: 10,
      items: [
        { orderItemId: 'a', skuId: 's1', quantity: 1, unitPrice: 1, isPrize: false, createdAt: new Date('2026-01-01') },
        { orderItemId: 'b', skuId: 's2', quantity: 1, unitPrice: 1, isPrize: false, createdAt: new Date('2026-01-01') },
        { orderItemId: 'c', skuId: 's3', quantity: 1, unitPrice: 1, isPrize: false, createdAt: new Date('2026-01-01') },
      ],
    });

    expect(result.allocations.map((item) => item.assetAmount)).toEqual([3.33, 3.33, 3.34]);
    expect(result.residualOrderItemId).toBe('c');
  });

  it('returns no allocations for prize-only orders', () => {
    expect(allocateOrderAssetAmount({
      orderAssetAmount: 10,
      items: [
        { orderItemId: 'gift', skuId: 's1', quantity: 1, unitPrice: 10, isPrize: true, createdAt: new Date('2026-01-01') },
      ],
    })).toEqual({ allocations: [], residualOrderItemId: null });
  });

  it('removes return shipping and refunded after-sale shipping payments before reversal', () => {
    expect(calculateRefundProductAmount({
      refundAmount: 88,
      returnShippingFee: 8,
      shippingPaymentRefundAmount: 10,
    })).toBe(70);
  });

  it('clamps refund product amount to zero after shipping removal', () => {
    expect(calculateRefundProductAmount({
      refundAmount: 10,
      returnShippingFee: 8,
      shippingPaymentRefundAmount: 10,
    })).toBe(0);
  });

  it('caps reversal by line remaining and order remaining amounts', () => {
    expect(clampReversalAmount({
      requestedAmount: 60,
      lineRemainingAmount: 40,
      orderRemainingAmount: 30,
    })).toBe(30);
  });

  it('caps whole-order fallback by order remaining amount', () => {
    expect(clampReversalAmount({
      requestedAmount: 999,
      orderRemainingAmount: 81.23,
    })).toBe(81.23);
  });

  it('rounds money to two decimals with floating point tolerance', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});
