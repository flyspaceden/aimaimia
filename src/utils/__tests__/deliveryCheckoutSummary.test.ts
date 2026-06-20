declare const describe: any;
declare const it: any;
declare const expect: any;

import { resolveDeliveryCheckoutSummary } from '../deliveryCheckoutSummary';

describe('resolveDeliveryCheckoutSummary', () => {
  it('shows local cart amount before the backend checkout is locked', () => {
    expect(resolveDeliveryCheckoutSummary({
      localGoodsAmount: 128,
      lockedCheckout: null,
    })).toEqual({
      source: 'LOCAL_CART',
      goodsAmount: 128,
      shippingFee: null,
      totalAmount: 128,
    });
  });

  it('uses backend locked goods, shipping, and total amounts before payment starts', () => {
    expect(resolveDeliveryCheckoutSummary({
      localGoodsAmount: 128,
      lockedCheckout: {
        goodsAmount: 128,
        shippingFee: 18,
        totalAmount: 146,
      },
    })).toEqual({
      source: 'LOCKED_CHECKOUT',
      goodsAmount: 128,
      shippingFee: 18,
      totalAmount: 146,
    });
  });
});
