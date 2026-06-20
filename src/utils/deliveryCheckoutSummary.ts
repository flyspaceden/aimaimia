export type DeliveryCheckoutSummarySource = 'LOCAL_CART' | 'LOCKED_CHECKOUT';

export type DeliveryCheckoutSummary = {
  source: DeliveryCheckoutSummarySource;
  goodsAmount: number;
  shippingFee: number | null;
  totalAmount: number;
};

export type DeliveryLockedCheckoutAmounts = {
  goodsAmount: number;
  shippingFee: number;
  totalAmount: number;
};

export function resolveDeliveryCheckoutSummary(input: {
  localGoodsAmount: number;
  lockedCheckout?: DeliveryLockedCheckoutAmounts | null;
}): DeliveryCheckoutSummary {
  if (input.lockedCheckout) {
    return {
      source: 'LOCKED_CHECKOUT',
      goodsAmount: input.lockedCheckout.goodsAmount,
      shippingFee: input.lockedCheckout.shippingFee,
      totalAmount: input.lockedCheckout.totalAmount,
    };
  }

  return {
    source: 'LOCAL_CART',
    goodsAmount: input.localGoodsAmount,
    shippingFee: null,
    totalAmount: input.localGoodsAmount,
  };
}
