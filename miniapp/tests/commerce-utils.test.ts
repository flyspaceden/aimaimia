import { describe, expect, it } from 'vitest';
import {
  clampDeduction,
  isCartItemPurchasable,
  isUserCancelledPayment,
  newCheckoutIdempotencyKey,
  payableAfterDeduction,
  selectedCartItems,
  selectedCartTotal,
  toggleCheckoutCoupon,
} from '@/components/commerce-utils';
import type { CartItem, CheckoutPreview } from '@/types';

const item = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: 'ci-1', skuId: 'sku-1', quantity: 2, isSelected: true,
  product: { id: 'p-1', title: '蓝莓', image: null, price: 12.5, originalPrice: null, stock: 9 },
  ...overrides,
});

const preview: CheckoutPreview = {
  groups: [], pointsBalance: 100, pointsRatio: 0.1, maxDeductible: 20,
  summary: { totalGoodsAmount: 100, totalShippingFee: 0, totalDiscount: 0, vipDiscount: 0, totalPayable: 88.88 },
};

describe('commerce presentation rules', () => {
  it('excludes locked, unavailable, and out-of-stock rows from checkout', () => {
    const rows = [
      item(),
      item({ id: 'locked', isPrize: true, isLocked: true, threshold: 100 }),
      item({ id: 'missing', unavailableReason: 'SKU_MISSING' }),
      item({ id: 'out', stockStatus: 'OUT_OF_STOCK' }),
    ];
    expect(rows.map((row) => isCartItemPurchasable(row))).toEqual([true, false, false, false]);
    expect(selectedCartItems(rows).map((row) => row.id)).toEqual(['ci-1']);
    expect(selectedCartTotal(rows)).toBe(25);
  });

  it('includes a threshold gift only after selected normal goods unlock it', () => {
    const gift = item({
      id: 'gift', isPrize: true, isLocked: true, threshold: 20, selectable: false,
      product: { id: 'gift-product', title: '赠品', image: null, price: 0, originalPrice: null, stock: 1 },
    });
    expect(selectedCartItems([item(), gift]).map((row) => row.id)).toEqual(['ci-1', 'gift']);
    expect(selectedCartItems([item({ quantity: 1 }), gift]).map((row) => row.id)).toEqual(['ci-1']);
  });

  it('matches backend coupon stacking by group instead of replacing unrelated groups', () => {
    const coupon = (id: string, stackGroup: string | null, stackable: boolean): any => ({
      id, stackGroup, stackable, eligible: true,
    });
    const coupons = [coupon('a', 'fruit', false), coupon('b', 'fruit', true), coupon('c', 'farm', false), coupon('d', 'fruit', true)];
    expect(toggleCheckoutCoupon(['a', 'c'], coupons[1], coupons)).toEqual(['c', 'b']);
    expect(toggleCheckoutCoupon(['b'], coupons[3], coupons)).toEqual(['b', 'd']);
  });

  it('rotates checkout idempotency keys when a logical checkout attempt is finished', () => {
    expect(newCheckoutIdempotencyKey()).toMatch(/^mini-checkout-/);
  });

  it('clamps reward deduction to the server preview and derives the payable amount', () => {
    expect(clampDeduction('99', preview)).toBe(20);
    expect(clampDeduction('12.345', preview)).toBe(0);
    expect(payableAfterDeduction(preview, 20)).toBe(68.88);
  });

  it('recognizes only explicit WeChat cancellation errors as user cancellation', () => {
    expect(isUserCancelledPayment({ errMsg: 'requestPayment:fail cancel' })).toBe(true);
    expect(isUserCancelledPayment(new Error('network timeout'))).toBe(false);
  });
});
