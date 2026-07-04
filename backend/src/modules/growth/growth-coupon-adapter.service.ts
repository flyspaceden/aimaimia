import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CouponService } from '../coupon/coupon.service';

type IssueExchangeCouponParams = {
  userId: string;
  campaignId: string;
  tx?: Prisma.TransactionClient;
  source?: {
    type?: string;
    id?: string;
  };
};

@Injectable()
export class GrowthCouponAdapterService {
  constructor(private readonly couponService: CouponService) {}

  issueExchangeCoupon(params: IssueExchangeCouponParams) {
    return this.couponService.issueSystemCoupon(params);
  }
}
