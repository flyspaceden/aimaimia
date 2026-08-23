import { describe, expect, it } from 'vitest';

import type { FulfillmentInput } from '@/types';
import {
  buildCheckoutPreviewInput,
  buildCheckoutPreviewQueryKey,
  canLoadCheckoutPreview,
} from './checkout-utils';

const items = [{ skuId: 'sku-1', quantity: 2, cartItemId: 'cart-1' }];
const delivery = { mode: 'DELIVERY', addressId: '' } as const;
const pickup: FulfillmentInput = {
  mode: 'PICKUP',
  recipientName: '张三',
  recipientPhone: '13800000000',
  selections: [{ companyId: 'company-1', pickupPointId: 'point-1' }],
};

describe('normal checkout preview input', () => {
  it('没有收货地址时仍允许配送基础预结算，且不发送空地址', () => {
    const input = buildCheckoutPreviewInput({
      items,
      isBuyNow: false,
      fulfillmentMode: 'DELIVERY',
      fulfillmentReady: false,
      addressId: '',
      fulfillment: delivery,
      couponIds: [],
    });

    expect(canLoadCheckoutPreview(items.length, 'DELIVERY', false)).toBe(true);
    expect(input).toEqual({ items, checkoutSource: 'CART' });
    expect(input).not.toHaveProperty('addressId');
    expect(input).not.toHaveProperty('fulfillment');
  });

  it('自提信息不完整时不请求容易误导的配送价格', () => {
    const deliveryInput = buildCheckoutPreviewInput({
      items,
      isBuyNow: true,
      fulfillmentMode: 'DELIVERY',
      fulfillmentReady: false,
      addressId: '',
      fulfillment: delivery,
      couponIds: [],
    });
    const input = buildCheckoutPreviewInput({
      items,
      isBuyNow: true,
      fulfillmentMode: 'PICKUP',
      fulfillmentReady: false,
      addressId: '',
      fulfillment: pickup,
      couponIds: [],
    });

    expect(canLoadCheckoutPreview(items.length, 'PICKUP', false)).toBe(false);
    expect(input).toEqual({ items, checkoutSource: 'BUY_NOW' });
    expect(input).toEqual(deliveryInput);
    expect(buildCheckoutPreviewQueryKey('PICKUP', input)).not.toEqual(
      buildCheckoutPreviewQueryKey('DELIVERY', deliveryInput),
    );
  });

  it('自提信息完整时提交自提契约并保留红包', () => {
    const input = buildCheckoutPreviewInput({
      items,
      isBuyNow: false,
      fulfillmentMode: 'PICKUP',
      fulfillmentReady: true,
      addressId: '',
      fulfillment: pickup,
      couponIds: ['coupon-1'],
    });

    expect(canLoadCheckoutPreview(items.length, 'PICKUP', true)).toBe(true);
    expect(input).toEqual({
      items,
      checkoutSource: 'CART',
      fulfillment: pickup,
      couponInstanceIds: ['coupon-1'],
    });
  });
});
