import { describe, expect, it } from 'vitest';
import type { CartItem } from '@/types';
import {
  cartExpiryText,
  cartLowStockText,
  cartSelectedQuantity,
  getCartCheckboxState,
  selectableNormalCartItems,
} from '../cart-utils';

const item = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: 'cart-1',
  skuId: 'sku-1',
  quantity: 2,
  isSelected: true,
  product: {
    id: 'product-1', title: '蓝莓', image: null, price: 18, originalPrice: null, stock: 8,
  },
  ...overrides,
});

describe('miniapp cart presentation rules', () => {
  it('shows a threshold gift checked only after the selected normal-goods amount unlocks it', () => {
    const gift = item({
      isPrize: true,
      isLocked: true,
      threshold: 30,
      selectable: false,
      product: { id: 'gift', title: '赠品', image: null, price: 0, originalPrice: 30, stock: 1 },
    });

    expect(getCartCheckboxState(gift, 20)).toMatchObject({ checked: false, disabled: true, locked: true });
    expect(getCartCheckboxState(gift, 30)).toMatchObject({ checked: true, disabled: true, locked: false });
  });

  it('does not treat a non-threshold prize as intrinsically disabled by the App checkbox rule', () => {
    const discountPrize = item({ isPrize: true, isLocked: false, threshold: null, isSelected: false });
    expect(getCartCheckboxState(discountPrize, 0)).toMatchObject({ checked: false, disabled: false, isThresholdGift: false });
    expect(getCartCheckboxState(discountPrize, 0, true)).toMatchObject({ checked: true, disabled: false });
  });

  it('limits server-side select-all candidates to purchasable normal goods', () => {
    const normal = item();
    const outOfStock = item({ id: 'out', stockStatus: 'OUT_OF_STOCK' });
    const prize = item({ id: 'prize', isPrize: true, threshold: null });
    expect(selectableNormalCartItems([normal, outOfStock, prize], 36).map((row) => row.id)).toEqual(['cart-1']);
  });

  it('counts selected quantities and formats stock and prize expiry exactly for the cart', () => {
    expect(cartSelectedQuantity([item(), item({ id: 'two', quantity: 3 })])).toBe(5);
    expect(cartLowStockText(item(), 10)).toBe('仅剩 8 件');
    expect(cartLowStockText(item(), 0)).toBeNull();
    expect(cartExpiryText('2026-08-10T12:01:01.000Z', Date.parse('2026-08-10T12:00:00.000Z'))).toBe('剩余 0:01:01');
    expect(cartExpiryText('2026-08-10T11:59:59.000Z', Date.parse('2026-08-10T12:00:00.000Z'))).toBe('已过期');
  });

  it('counts a locally selected non-threshold prize without changing the server selection flag', () => {
    const prize = item({ id: 'prize', isPrize: true, isSelected: false, quantity: 1 });
    expect(cartSelectedQuantity([item(), prize], { prize: true })).toBe(3);
    expect(cartSelectedQuantity([item(), prize], { prize: false })).toBe(2);
  });
});
