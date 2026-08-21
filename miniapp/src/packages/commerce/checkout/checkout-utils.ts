import type {
  CheckoutItemInput,
  CheckoutPreviewInput,
  FulfillmentInput,
  FulfillmentMode,
} from '@/types';

type BuildCheckoutPreviewInputOptions = {
  items: CheckoutItemInput[];
  isBuyNow: boolean;
  fulfillmentMode: FulfillmentMode;
  fulfillmentReady: boolean;
  addressId: string;
  fulfillment: FulfillmentInput;
  couponIds: string[];
};

/**
 * 配送预结算允许暂时没有地址，让用户先核对商品和基础金额。
 * 自提预结算仍需完整的点位和取货人，避免把配送运费误展示为自提价格。
 */
export function buildCheckoutPreviewInput({
  items,
  isBuyNow,
  fulfillmentMode,
  fulfillmentReady,
  addressId,
  fulfillment,
  couponIds,
}: BuildCheckoutPreviewInputOptions): CheckoutPreviewInput {
  return {
    items,
    checkoutSource: isBuyNow ? 'BUY_NOW' : 'CART',
    ...(fulfillmentMode === 'DELIVERY' && addressId
      ? { addressId, fulfillment }
      : fulfillmentMode === 'PICKUP' && fulfillmentReady
        ? { fulfillment }
        : {}),
    ...(couponIds.length ? { couponInstanceIds: couponIds } : {}),
  };
}

export function canLoadCheckoutPreview(
  itemCount: number,
  fulfillmentMode: FulfillmentMode,
  fulfillmentReady: boolean,
) {
  return itemCount > 0 && (fulfillmentMode === 'DELIVERY' || fulfillmentReady);
}

export function buildCheckoutPreviewQueryKey(
  fulfillmentMode: FulfillmentMode,
  input: CheckoutPreviewInput,
) {
  return ['commerce', 'checkout-preview', fulfillmentMode, input] as const;
}
