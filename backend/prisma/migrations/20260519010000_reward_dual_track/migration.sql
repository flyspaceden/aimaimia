-- Reward dual-track foundation: realtime withdrawals + checkout point deduction metadata.

-- AlterEnum
ALTER TYPE "WithdrawStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "RewardEntryType" ADD VALUE IF NOT EXISTS 'DEDUCT';

-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN IF NOT EXISTS "deductionGroupId" TEXT;

ALTER TABLE "WithdrawRequest"
  ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "netAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.20,
  ADD COLUMN IF NOT EXISTS "providerFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "outBizNo" TEXT,
  ADD COLUMN IF NOT EXISTS "clientIdempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "providerFundOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "providerErrorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "providerErrorMessage" TEXT,
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastQueriedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "queryAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WithdrawRequest" ALTER COLUMN "status" SET DEFAULT 'PROCESSING';

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WithdrawRequest_outBizNo_key" ON "WithdrawRequest"("outBizNo");
CREATE UNIQUE INDEX IF NOT EXISTS "WithdrawRequest_clientIdempotencyKey_key" ON "WithdrawRequest"("clientIdempotencyKey");
CREATE INDEX IF NOT EXISTS "WithdrawRequest_userId_status_createdAt_idx" ON "WithdrawRequest"("userId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "WithdrawRequest_status_createdAt_idx" ON "WithdrawRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "WithdrawRequest_providerFundOrderId_idx" ON "WithdrawRequest"("providerFundOrderId");
CREATE INDEX IF NOT EXISTS "WithdrawRequest_userId_createdAt_idx" ON "WithdrawRequest"("userId", "createdAt");
