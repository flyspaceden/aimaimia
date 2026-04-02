-- Coupon enums（幂等）
DO $$
BEGIN
  CREATE TYPE "CouponCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CouponDiscountType" AS ENUM ('FIXED', 'PERCENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CouponTriggerType" AS ENUM (
    'REGISTER',
    'FIRST_ORDER',
    'BIRTHDAY',
    'CHECK_IN',
    'INVITE',
    'REVIEW',
    'SHARE',
    'CUMULATIVE_SPEND',
    'WIN_BACK',
    'HOLIDAY',
    'FLASH',
    'MANUAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CouponDistributionMode" AS ENUM ('AUTO', 'CLAIM', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CouponInstanceStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'USED', 'EXPIRED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- CheckoutSession / Order coupon columns（幂等）
ALTER TABLE "CheckoutSession"
  ADD COLUMN IF NOT EXISTS "couponInstanceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "couponPerAmounts" JSONB,
  ADD COLUMN IF NOT EXISTS "totalCouponDiscount" DOUBLE PRECISION DEFAULT 0;

UPDATE "CheckoutSession"
SET "totalCouponDiscount" = 0
WHERE "totalCouponDiscount" IS NULL;

ALTER TABLE "CheckoutSession"
  ALTER COLUMN "couponInstanceIds" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "totalCouponDiscount" SET DEFAULT 0,
  ALTER COLUMN "totalCouponDiscount" SET NOT NULL;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "totalCouponDiscount" DOUBLE PRECISION;

-- Coupon tables（幂等）
CREATE TABLE IF NOT EXISTS "CouponCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "CouponCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "triggerType" "CouponTriggerType" NOT NULL,
  "distributionMode" "CouponDistributionMode" NOT NULL,
  "triggerConfig" JSONB,
  "discountType" "CouponDiscountType" NOT NULL,
  "discountValue" DOUBLE PRECISION NOT NULL,
  "maxDiscountAmount" DOUBLE PRECISION,
  "minOrderAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "applicableCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "applicableCompanyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "stackable" BOOLEAN NOT NULL DEFAULT true,
  "stackGroup" TEXT,
  "totalQuota" INTEGER NOT NULL,
  "issuedCount" INTEGER NOT NULL DEFAULT 0,
  "maxPerUser" INTEGER NOT NULL DEFAULT 1,
  "validDays" INTEGER NOT NULL DEFAULT 7,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CouponCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CouponInstance" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "CouponInstanceStatus" NOT NULL DEFAULT 'AVAILABLE',
  "discountType" "CouponDiscountType" NOT NULL,
  "discountValue" DOUBLE PRECISION NOT NULL,
  "maxDiscountAmount" DOUBLE PRECISION,
  "minOrderAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "usedOrderId" TEXT,
  "usedAmount" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CouponInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CouponUsageRecord" (
  "id" TEXT NOT NULL,
  "couponInstanceId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "discountAmount" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CouponUsageRecord_pkey" PRIMARY KEY ("id")
);

-- Coupon indexes（幂等）
CREATE INDEX IF NOT EXISTS "CouponCampaign_status_startAt_endAt_idx"
  ON "CouponCampaign"("status", "startAt", "endAt");

CREATE INDEX IF NOT EXISTS "CouponCampaign_triggerType_idx"
  ON "CouponCampaign"("triggerType");

CREATE INDEX IF NOT EXISTS "CouponInstance_userId_status_idx"
  ON "CouponInstance"("userId", "status");

CREATE INDEX IF NOT EXISTS "CouponInstance_campaignId_idx"
  ON "CouponInstance"("campaignId");

CREATE INDEX IF NOT EXISTS "CouponInstance_expiresAt_idx"
  ON "CouponInstance"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CouponInstance_campaignId_userId_issuedAt_key"
  ON "CouponInstance"("campaignId", "userId", "issuedAt");

CREATE INDEX IF NOT EXISTS "CouponUsageRecord_orderId_idx"
  ON "CouponUsageRecord"("orderId");

CREATE INDEX IF NOT EXISTS "CouponUsageRecord_couponInstanceId_idx"
  ON "CouponUsageRecord"("couponInstanceId");

-- Coupon foreign keys（幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponInstance_campaignId_fkey'
  ) THEN
    ALTER TABLE "CouponInstance"
      ADD CONSTRAINT "CouponInstance_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "CouponCampaign"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponInstance_userId_fkey'
  ) THEN
    ALTER TABLE "CouponInstance"
      ADD CONSTRAINT "CouponInstance_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponUsageRecord_couponInstanceId_fkey'
  ) THEN
    ALTER TABLE "CouponUsageRecord"
      ADD CONSTRAINT "CouponUsageRecord_couponInstanceId_fkey"
      FOREIGN KEY ("couponInstanceId") REFERENCES "CouponInstance"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponUsageRecord_orderId_fkey'
  ) THEN
    ALTER TABLE "CouponUsageRecord"
      ADD CONSTRAINT "CouponUsageRecord_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
