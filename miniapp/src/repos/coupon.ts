import { ApiClient } from '@/api/client';
import type {
  CheckoutEligibleCoupon,
  CheckoutEligibleRequest,
  Result,
} from '@/types';

export const CouponRepo = {
  getCheckoutEligible: (
    input: CheckoutEligibleRequest,
  ): Promise<Result<CheckoutEligibleCoupon[]>> =>
    ApiClient.post<CheckoutEligibleCoupon[]>('/coupons/checkout-eligible', {
      orderAmount: input.previewOrderAmount,
      categoryIds: input.categoryIds,
      companyIds: input.companyIds,
    }),
};
