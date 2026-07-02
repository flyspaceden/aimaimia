-- Persist scheduled manual coupon issue jobs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CouponManualIssueTargetMode') THEN
    CREATE TYPE "CouponManualIssueTargetMode" AS ENUM ('SPECIFIC_USERS', 'ALL_USERS', 'VIP_USERS');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CouponManualIssueJobStatus') THEN
    CREATE TYPE "CouponManualIssueJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "CouponManualIssueJob" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "targetMode" "CouponManualIssueTargetMode" NOT NULL,
  "userIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" "CouponManualIssueJobStatus" NOT NULL DEFAULT 'PENDING',
  "issuedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedUsers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "errorMessage" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CouponManualIssueJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CouponManualIssueJob_status_scheduledAt_idx"
  ON "CouponManualIssueJob"("status", "scheduledAt");

CREATE INDEX IF NOT EXISTS "CouponManualIssueJob_campaignId_idx"
  ON "CouponManualIssueJob"("campaignId");

CREATE INDEX IF NOT EXISTS "CouponManualIssueJob_targetMode_idx"
  ON "CouponManualIssueJob"("targetMode");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponManualIssueJob_campaignId_fkey'
  ) THEN
    ALTER TABLE "CouponManualIssueJob"
      ADD CONSTRAINT "CouponManualIssueJob_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "CouponCampaign"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
