-- CreateEnum
CREATE TYPE "CaptainProfileStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "CaptainRelationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CaptainLedgerType" AS ENUM ('DIRECT_ORDER', 'INDIRECT_ORDER', 'MANAGEMENT_ALLOWANCE', 'GROWTH_BONUS', 'CULTIVATION_BONUS', 'TEAM_POOL', 'VOID', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CaptainLedgerStatus" AS ENUM ('FROZEN', 'AVAILABLE', 'VOIDED', 'WITHDRAWN', 'CLAWBACK_PENDING');

-- CreateEnum
CREATE TYPE "CaptainSettlementStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'PAID', 'REJECTED');

-- CreateTable
CREATE TABLE "CaptainProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "captainCode" TEXT NOT NULL,
    "programCode" TEXT NOT NULL DEFAULT 'SEAFOOD_PREPACKAGED',
    "displayName" TEXT,
    "status" "CaptainProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "approvedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "statusReason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptainProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptainRelation" (
    "id" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "directCaptainUserId" TEXT NOT NULL,
    "indirectCaptainUserId" TEXT,
    "programCode" TEXT NOT NULL DEFAULT 'SEAFOOD_PREPACKAGED',
    "codeUsed" TEXT NOT NULL,
    "source" TEXT,
    "status" "CaptainRelationStatus" NOT NULL DEFAULT 'ACTIVE',
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptainRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptainOrderAttribution" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "directCaptainUserId" TEXT NOT NULL,
    "indirectCaptainUserId" TEXT,
    "programCode" TEXT NOT NULL DEFAULT 'SEAFOOD_PREPACKAGED',
    "commissionBase" DOUBLE PRECISION NOT NULL,
    "eligibleGoodsAmount" DOUBLE PRECISION NOT NULL,
    "couponDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rewardDeductionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refundAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "directRate" DOUBLE PRECISION NOT NULL,
    "indirectRate" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FROZEN',
    "configSnapshot" JSONB NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptainOrderAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptainAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "programCode" TEXT NOT NULL DEFAULT 'SEAFOOD_PREPACKAGED',
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frozen" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "withdrawn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clawback" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptainAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptainMonthlyMetric" (
    "id" TEXT NOT NULL,
    "captainUserId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "programCode" TEXT NOT NULL DEFAULT 'SEAFOOD_PREPACKAGED',
    "personalGmv" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "teamGmv" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "directEffectiveBuyers" INTEGER NOT NULL DEFAULT 0,
    "teamEffectiveMembers" INTEGER NOT NULL DEFAULT 0,
    "newEffectiveMembers" INTEGER NOT NULL DEFAULT 0,
    "refundRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "qualifiedTier" TEXT,
    "configSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptainMonthlyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptainMonthlySettlement" (
    "id" TEXT NOT NULL,
    "captainUserId" TEXT NOT NULL,
    "metricId" TEXT,
    "month" TEXT NOT NULL,
    "programCode" TEXT NOT NULL DEFAULT 'SEAFOOD_PREPACKAGED',
    "status" "CaptainSettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "baseManagementAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growthBonusAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cultivationBonusAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "teamPoolAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewedByAdminId" TEXT,
    "paidByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "configSnapshot" JSONB NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptainMonthlySettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptainCommissionLedger" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderAttributionId" TEXT,
    "orderId" TEXT,
    "settlementId" TEXT,
    "programCode" TEXT NOT NULL DEFAULT 'SEAFOOD_PREPACKAGED',
    "type" "CaptainLedgerType" NOT NULL,
    "status" "CaptainLedgerStatus" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "commissionBase" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "balanceAfter" DOUBLE PRECISION,
    "frozenAfter" DOUBLE PRECISION,
    "idempotencyKey" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "configSnapshot" JSONB,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CaptainCommissionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaptainProfile_userId_key" ON "CaptainProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainProfile_captainCode_key" ON "CaptainProfile"("captainCode");

-- CreateIndex
CREATE INDEX "CaptainProfile_status_createdAt_idx" ON "CaptainProfile"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainProfile_programCode_status_idx" ON "CaptainProfile"("programCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainRelation_buyerUserId_programCode_key" ON "CaptainRelation"("buyerUserId", "programCode");

-- CreateIndex
CREATE INDEX "CaptainRelation_directCaptainUserId_status_createdAt_idx" ON "CaptainRelation"("directCaptainUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainRelation_indirectCaptainUserId_status_createdAt_idx" ON "CaptainRelation"("indirectCaptainUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainRelation_codeUsed_idx" ON "CaptainRelation"("codeUsed");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainOrderAttribution_orderId_programCode_key" ON "CaptainOrderAttribution"("orderId", "programCode");

-- CreateIndex
CREATE INDEX "CaptainOrderAttribution_buyerUserId_createdAt_idx" ON "CaptainOrderAttribution"("buyerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainOrderAttribution_directCaptainUserId_status_createdAt_idx" ON "CaptainOrderAttribution"("directCaptainUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainOrderAttribution_indirectCaptainUserId_status_createdAt_idx" ON "CaptainOrderAttribution"("indirectCaptainUserId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainAccount_userId_programCode_key" ON "CaptainAccount"("userId", "programCode");

-- CreateIndex
CREATE INDEX "CaptainAccount_balance_idx" ON "CaptainAccount"("balance");

-- CreateIndex
CREATE INDEX "CaptainAccount_frozen_idx" ON "CaptainAccount"("frozen");

-- CreateIndex
CREATE INDEX "CaptainAccount_updatedAt_idx" ON "CaptainAccount"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainMonthlyMetric_captainUserId_month_programCode_key" ON "CaptainMonthlyMetric"("captainUserId", "month", "programCode");

-- CreateIndex
CREATE INDEX "CaptainMonthlyMetric_month_qualified_idx" ON "CaptainMonthlyMetric"("month", "qualified");

-- CreateIndex
CREATE INDEX "CaptainMonthlyMetric_programCode_month_idx" ON "CaptainMonthlyMetric"("programCode", "month");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainMonthlySettlement_metricId_key" ON "CaptainMonthlySettlement"("metricId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainMonthlySettlement_captainUserId_month_programCode_key" ON "CaptainMonthlySettlement"("captainUserId", "month", "programCode");

-- CreateIndex
CREATE INDEX "CaptainMonthlySettlement_month_status_idx" ON "CaptainMonthlySettlement"("month", "status");

-- CreateIndex
CREATE INDEX "CaptainMonthlySettlement_programCode_month_idx" ON "CaptainMonthlySettlement"("programCode", "month");

-- CreateIndex
CREATE UNIQUE INDEX "CaptainCommissionLedger_idempotencyKey_key" ON "CaptainCommissionLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CaptainCommissionLedger_userId_status_createdAt_idx" ON "CaptainCommissionLedger"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainCommissionLedger_accountId_createdAt_idx" ON "CaptainCommissionLedger"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainCommissionLedger_orderAttributionId_idx" ON "CaptainCommissionLedger"("orderAttributionId");

-- CreateIndex
CREATE INDEX "CaptainCommissionLedger_orderId_idx" ON "CaptainCommissionLedger"("orderId");

-- CreateIndex
CREATE INDEX "CaptainCommissionLedger_settlementId_idx" ON "CaptainCommissionLedger"("settlementId");

-- CreateIndex
CREATE INDEX "CaptainCommissionLedger_type_status_idx" ON "CaptainCommissionLedger"("type", "status");

-- AddForeignKey
ALTER TABLE "CaptainProfile" ADD CONSTRAINT "CaptainProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainRelation" ADD CONSTRAINT "CaptainRelation_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainRelation" ADD CONSTRAINT "CaptainRelation_directCaptainUserId_fkey" FOREIGN KEY ("directCaptainUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainRelation" ADD CONSTRAINT "CaptainRelation_indirectCaptainUserId_fkey" FOREIGN KEY ("indirectCaptainUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainOrderAttribution" ADD CONSTRAINT "CaptainOrderAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainOrderAttribution" ADD CONSTRAINT "CaptainOrderAttribution_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainOrderAttribution" ADD CONSTRAINT "CaptainOrderAttribution_directCaptainUserId_fkey" FOREIGN KEY ("directCaptainUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainOrderAttribution" ADD CONSTRAINT "CaptainOrderAttribution_indirectCaptainUserId_fkey" FOREIGN KEY ("indirectCaptainUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainAccount" ADD CONSTRAINT "CaptainAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainMonthlyMetric" ADD CONSTRAINT "CaptainMonthlyMetric_captainUserId_fkey" FOREIGN KEY ("captainUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainMonthlySettlement" ADD CONSTRAINT "CaptainMonthlySettlement_captainUserId_fkey" FOREIGN KEY ("captainUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainMonthlySettlement" ADD CONSTRAINT "CaptainMonthlySettlement_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "CaptainMonthlyMetric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainCommissionLedger" ADD CONSTRAINT "CaptainCommissionLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CaptainAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainCommissionLedger" ADD CONSTRAINT "CaptainCommissionLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainCommissionLedger" ADD CONSTRAINT "CaptainCommissionLedger_orderAttributionId_fkey" FOREIGN KEY ("orderAttributionId") REFERENCES "CaptainOrderAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainCommissionLedger" ADD CONSTRAINT "CaptainCommissionLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptainCommissionLedger" ADD CONSTRAINT "CaptainCommissionLedger_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "CaptainMonthlySettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
