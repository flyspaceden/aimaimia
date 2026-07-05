ALTER TABLE "CouponCampaign"
ADD COLUMN "growthExchangeEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CouponCampaign"
SET "growthExchangeEnabled" = true
WHERE "id" LIKE 'cc-growth-%'
  AND "triggerType" = 'MANUAL'
  AND "distributionMode" = 'MANUAL';
