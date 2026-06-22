-- Group-buy share rebate: independent activity, code, referral, and rebate balance tables.

ALTER TYPE "CheckoutBizType" ADD VALUE 'GROUP_BUY';
ALTER TYPE "OrderBizType" ADD VALUE 'GROUP_BUY';

CREATE TYPE "GroupBuyActivityStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ENDED');
CREATE TYPE "GroupBuyInstanceStatus" AS ENUM (
  'QUALIFICATION_PENDING',
  'SHARING',
  'COMPLETED',
  'TERMINATED',
  'QUALIFICATION_ABANDONED',
  'QUALIFICATION_INVALID',
  'EXPIRED'
);
CREATE TYPE "GroupBuyCodeStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED', 'COMPLETED', 'EXPIRED');
CREATE TYPE "GroupBuyReferralStatus" AS ENUM ('CANDIDATE', 'VALID', 'INVALID', 'VOIDED');
CREATE TYPE "GroupBuyRebateLedgerType" AS ENUM (
  'PENDING_REBATE',
  'RELEASE',
  'VOID',
  'WITHDRAW',
  'DEDUCT',
  'REFUND_RETURN',
  'ADMIN_ADJUST'
);
CREATE TYPE "GroupBuyRebateLedgerStatus" AS ENUM (
  'PENDING',
  'AVAILABLE',
  'RESERVED',
  'COMPLETED',
  'VOIDED',
  'FAILED'
);

CREATE TABLE "GroupBuyActivity" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "price" DOUBLE PRECISION NOT NULL,
  "freeShipping" BOOLEAN NOT NULL DEFAULT false,
  "status" "GroupBuyActivityStatus" NOT NULL DEFAULT 'DRAFT',
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "ruleSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "GroupBuyActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuyTier" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "basisPoints" INTEGER NOT NULL,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupBuyTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuyInstance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "initiatorOrderId" TEXT NOT NULL,
  "status" "GroupBuyInstanceStatus" NOT NULL DEFAULT 'QUALIFICATION_PENDING',
  "priceSnapshot" DOUBLE PRECISION NOT NULL,
  "shippingFeeSnapshot" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "freeShippingSnapshot" BOOLEAN NOT NULL DEFAULT false,
  "tierSnapshot" JSONB NOT NULL,
  "activitySnapshot" JSONB,
  "validReferralCount" INTEGER NOT NULL DEFAULT 0,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "activatedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "terminatedAt" TIMESTAMP(3),
  "abandonedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "invalidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupBuyInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuyCode" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "GroupBuyCodeStatus" NOT NULL DEFAULT 'PENDING',
  "activatedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupBuyCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuyReferral" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "codeId" TEXT,
  "status" "GroupBuyReferralStatus" NOT NULL DEFAULT 'CANDIDATE',
  "referredUserId" TEXT NOT NULL,
  "referredOrderId" TEXT NOT NULL,
  "referredInstanceId" TEXT,
  "candidateSequence" INTEGER,
  "effectiveSequence" INTEGER,
  "amountSnapshot" DOUBLE PRECISION,
  "invalidReason" TEXT,
  "validAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupBuyReferral_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuyRebateAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "withdrawn" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "deducted" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GroupBuyRebateAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuyRebateLedger" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "instanceId" TEXT,
  "referralId" TEXT,
  "orderId" TEXT,
  "type" "GroupBuyRebateLedgerType" NOT NULL,
  "status" "GroupBuyRebateLedgerStatus" NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "balanceBefore" DOUBLE PRECISION NOT NULL,
  "balanceAfter" DOUBLE PRECISION NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "refType" TEXT,
  "refId" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "GroupBuyRebateLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupBuyTier_activityId_sequence_key" ON "GroupBuyTier"("activityId", "sequence");
CREATE UNIQUE INDEX "GroupBuyInstance_initiatorOrderId_key" ON "GroupBuyInstance"("initiatorOrderId");
CREATE UNIQUE INDEX "GroupBuyCode_instanceId_key" ON "GroupBuyCode"("instanceId");
CREATE UNIQUE INDEX "GroupBuyCode_code_key" ON "GroupBuyCode"("code");
CREATE UNIQUE INDEX "GroupBuyReferral_referredOrderId_key" ON "GroupBuyReferral"("referredOrderId");
CREATE UNIQUE INDEX "GroupBuyReferral_referredInstanceId_key" ON "GroupBuyReferral"("referredInstanceId");
CREATE UNIQUE INDEX "GroupBuyRebateAccount_userId_key" ON "GroupBuyRebateAccount"("userId");
CREATE UNIQUE INDEX "GroupBuyRebateLedger_idempotencyKey_key" ON "GroupBuyRebateLedger"("idempotencyKey");

CREATE INDEX "GroupBuyActivity_status_startAt_endAt_idx" ON "GroupBuyActivity"("status", "startAt", "endAt");
CREATE INDEX "GroupBuyActivity_productId_skuId_idx" ON "GroupBuyActivity"("productId", "skuId");
CREATE INDEX "GroupBuyTier_activityId_idx" ON "GroupBuyTier"("activityId");
CREATE INDEX "GroupBuyInstance_userId_status_createdAt_idx" ON "GroupBuyInstance"("userId", "status", "createdAt");
CREATE INDEX "GroupBuyInstance_activityId_status_idx" ON "GroupBuyInstance"("activityId", "status");
CREATE INDEX "GroupBuyInstance_status_createdAt_idx" ON "GroupBuyInstance"("status", "createdAt");
CREATE INDEX "GroupBuyCode_status_createdAt_idx" ON "GroupBuyCode"("status", "createdAt");
CREATE INDEX "GroupBuyReferral_instanceId_status_idx" ON "GroupBuyReferral"("instanceId", "status");
CREATE INDEX "GroupBuyReferral_codeId_status_idx" ON "GroupBuyReferral"("codeId", "status");
CREATE INDEX "GroupBuyReferral_referredUserId_createdAt_idx" ON "GroupBuyReferral"("referredUserId", "createdAt");
CREATE INDEX "GroupBuyRebateAccount_balance_idx" ON "GroupBuyRebateAccount"("balance");
CREATE INDEX "GroupBuyRebateAccount_updatedAt_idx" ON "GroupBuyRebateAccount"("updatedAt");
CREATE INDEX "GroupBuyRebateLedger_userId_status_createdAt_idx" ON "GroupBuyRebateLedger"("userId", "status", "createdAt");
CREATE INDEX "GroupBuyRebateLedger_accountId_createdAt_idx" ON "GroupBuyRebateLedger"("accountId", "createdAt");
CREATE INDEX "GroupBuyRebateLedger_instanceId_idx" ON "GroupBuyRebateLedger"("instanceId");
CREATE INDEX "GroupBuyRebateLedger_referralId_idx" ON "GroupBuyRebateLedger"("referralId");
CREATE INDEX "GroupBuyRebateLedger_orderId_idx" ON "GroupBuyRebateLedger"("orderId");

ALTER TABLE "GroupBuyActivity" ADD CONSTRAINT "GroupBuyActivity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyActivity" ADD CONSTRAINT "GroupBuyActivity_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyTier" ADD CONSTRAINT "GroupBuyTier_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "GroupBuyActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyInstance" ADD CONSTRAINT "GroupBuyInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyInstance" ADD CONSTRAINT "GroupBuyInstance_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "GroupBuyActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyInstance" ADD CONSTRAINT "GroupBuyInstance_initiatorOrderId_fkey" FOREIGN KEY ("initiatorOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyCode" ADD CONSTRAINT "GroupBuyCode_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "GroupBuyInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupBuyReferral" ADD CONSTRAINT "GroupBuyReferral_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "GroupBuyInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyReferral" ADD CONSTRAINT "GroupBuyReferral_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "GroupBuyCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyReferral" ADD CONSTRAINT "GroupBuyReferral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyReferral" ADD CONSTRAINT "GroupBuyReferral_referredOrderId_fkey" FOREIGN KEY ("referredOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyReferral" ADD CONSTRAINT "GroupBuyReferral_referredInstanceId_fkey" FOREIGN KEY ("referredInstanceId") REFERENCES "GroupBuyInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupBuyRebateAccount" ADD CONSTRAINT "GroupBuyRebateAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyRebateLedger" ADD CONSTRAINT "GroupBuyRebateLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GroupBuyRebateAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyRebateLedger" ADD CONSTRAINT "GroupBuyRebateLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyRebateLedger" ADD CONSTRAINT "GroupBuyRebateLedger_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "GroupBuyInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyRebateLedger" ADD CONSTRAINT "GroupBuyRebateLedger_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "GroupBuyReferral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyRebateLedger" ADD CONSTRAINT "GroupBuyRebateLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
