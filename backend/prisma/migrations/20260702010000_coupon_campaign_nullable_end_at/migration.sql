-- Allow evergreen coupon campaigns. Business validation keeps HOLIDAY/FLASH time-bound.
ALTER TABLE "CouponCampaign" ALTER COLUMN "endAt" DROP NOT NULL;
