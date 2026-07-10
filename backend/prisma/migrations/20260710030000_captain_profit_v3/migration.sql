-- Captain profit V3 persistence contract. This migration only adds storage;
-- existing SALES_V2 amounts remain untouched and are never reinterpreted.

CREATE TYPE "OrderProfitSnapshotStatus" AS ENUM ('READY', 'RECONCILIATION_REQUIRED');
CREATE TYPE "OrderProfitFundingType" AS ENUM (
  'PLATFORM_RETAINED_CREDIT',
  'CAPTAIN_DIRECT_HOLD',
  'CAPTAIN_MONTHLY_HOLD',
  'CAPTAIN_MONTHLY_RELEASE',
  'REFUND_ADJUSTMENT'
);
CREATE TYPE "OrderProfitReconciliationStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');
CREATE TYPE "OrderProfitAdjustmentStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'SUPERSEDED');

ALTER TABLE "Order"
  ADD COLUMN "groupBuyRebateDeductionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "CaptainOrderAttribution"
  ADD COLUMN "calculationModel" TEXT NOT NULL DEFAULT 'SALES_V2',
  ADD COLUMN "profitSnapshotId" TEXT,
  ADD COLUMN "profitConfigVersion" TEXT,
  ADD COLUMN "profitBaseAmount" DOUBLE PRECISION;

ALTER TABLE "RewardLedger"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "sourceLedgerId" TEXT;

ALTER TABLE "RuleVersion"
  ADD COLUMN "isComplete" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "safetySummary" JSONB;

CREATE TABLE "OrderProfitSnapshot" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "supersedesSnapshotId" TEXT,
  "status" "OrderProfitSnapshotStatus" NOT NULL,
  "grossGoodsAmount" DOUBLE PRECISION NOT NULL,
  "shippingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "vipDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "couponDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rewardDeductionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "groupBuyRebateDeductionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "otherGoodsDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "netGoodsRevenue" DOUBLE PRECISION NOT NULL,
  "productCostAmount" DOUBLE PRECISION NOT NULL,
  "distributableProfitAmount" DOUBLE PRECISION NOT NULL,
  "captainEligibleProfitAmount" DOUBLE PRECISION NOT NULL,
  "calculationVersion" TEXT NOT NULL,
  "itemBreakdown" JSONB NOT NULL,
  "ruleSnapshot" JSONB NOT NULL,
  "errorCode" TEXT,
  "errorMeta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByAdminId" TEXT,

  CONSTRAINT "OrderProfitSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProfitFundingLedger" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "type" "OrderProfitFundingType" NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "configVersion" TEXT NOT NULL,
  "sourceLedgerId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProfitFundingLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProfitRefundReversal" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "sourceLedgerId" TEXT NOT NULL,
  "sourceLedgerType" TEXT NOT NULL,
  "refundedQuantity" INTEGER,
  "refundedGoodsAmount" DOUBLE PRECISION NOT NULL,
  "cumulativeRefundRatio" DOUBLE PRECISION NOT NULL,
  "cumulativeTargetReversal" DOUBLE PRECISION NOT NULL,
  "incrementalReversal" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProfitRefundReversal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProfitReconciliationTask" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sourceSnapshotId" TEXT NOT NULL,
  "status" "OrderProfitReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  "errorCode" TEXT NOT NULL,
  "itemCostCorrections" JSONB,
  "resolutionNote" TEXT,
  "resolvedSnapshotId" TEXT,
  "resolvedByAdminId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderProfitReconciliationTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaptainMonthlySettlementOrder" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "orderAttributionId" TEXT NOT NULL,
  "configVersion" TEXT NOT NULL,
  "profitBaseAmount" DOUBLE PRECISION NOT NULL,
  "baseManagementAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "growthBonusAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cultivationBonusAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "performanceBonusAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reservedAmount" DOUBLE PRECISION NOT NULL,
  "releasedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reversedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CaptainMonthlySettlementOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProfitAdjustmentDraft" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sourceSnapshotId" TEXT NOT NULL,
  "targetSnapshotId" TEXT NOT NULL,
  "status" "OrderProfitAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
  "adjustments" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "supersededByDraftId" TEXT,
  "reviewNote" TEXT,
  "reviewedByAdminId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderProfitAdjustmentDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderProfitSnapshot_orderId_revision_key"
  ON "OrderProfitSnapshot"("orderId", "revision");
CREATE INDEX "OrderProfitSnapshot_orderId_isCurrent_idx"
  ON "OrderProfitSnapshot"("orderId", "isCurrent");
CREATE UNIQUE INDEX "OrderProfitSnapshot_one_current_per_order"
  ON "OrderProfitSnapshot"("orderId") WHERE "isCurrent" = true;

CREATE UNIQUE INDEX "OrderProfitFundingLedger_idempotencyKey_key"
  ON "OrderProfitFundingLedger"("idempotencyKey");
CREATE INDEX "OrderProfitFundingLedger_orderId_type_idx"
  ON "OrderProfitFundingLedger"("orderId", "type");
CREATE INDEX "OrderProfitFundingLedger_snapshotId_createdAt_idx"
  ON "OrderProfitFundingLedger"("snapshotId", "createdAt");

CREATE UNIQUE INDEX "OrderProfitRefundReversal_refundId_orderItemId_sourceLedgerId_key"
  ON "OrderProfitRefundReversal"("refundId", "orderItemId", "sourceLedgerId");
CREATE INDEX "OrderProfitRefundReversal_snapshotId_orderItemId_idx"
  ON "OrderProfitRefundReversal"("snapshotId", "orderItemId");

CREATE UNIQUE INDEX "OrderProfitReconciliationTask_sourceSnapshotId_key"
  ON "OrderProfitReconciliationTask"("sourceSnapshotId");
CREATE INDEX "OrderProfitReconciliationTask_status_createdAt_idx"
  ON "OrderProfitReconciliationTask"("status", "createdAt");
CREATE INDEX "OrderProfitReconciliationTask_orderId_status_idx"
  ON "OrderProfitReconciliationTask"("orderId", "status");

CREATE UNIQUE INDEX "CaptainMonthlySettlementOrder_settlementId_orderAttributionId_key"
  ON "CaptainMonthlySettlementOrder"("settlementId", "orderAttributionId");
CREATE INDEX "CaptainMonthlySettlementOrder_orderAttributionId_idx"
  ON "CaptainMonthlySettlementOrder"("orderAttributionId");

CREATE UNIQUE INDEX "OrderProfitAdjustmentDraft_idempotencyKey_key"
  ON "OrderProfitAdjustmentDraft"("idempotencyKey");
CREATE INDEX "OrderProfitAdjustmentDraft_orderId_status_idx"
  ON "OrderProfitAdjustmentDraft"("orderId", "status");

CREATE UNIQUE INDEX "RewardLedger_idempotencyKey_key" ON "RewardLedger"("idempotencyKey");
CREATE INDEX "CaptainOrderAttribution_profitSnapshotId_idx"
  ON "CaptainOrderAttribution"("profitSnapshotId");

ALTER TABLE "OrderProfitSnapshot"
  ADD CONSTRAINT "OrderProfitSnapshot_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderProfitSnapshot_supersedesSnapshotId_fkey"
  FOREIGN KEY ("supersedesSnapshotId") REFERENCES "OrderProfitSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderProfitFundingLedger"
  ADD CONSTRAINT "OrderProfitFundingLedger_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "OrderProfitSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderProfitFundingLedger_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderProfitRefundReversal"
  ADD CONSTRAINT "OrderProfitRefundReversal_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "OrderProfitSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderProfitRefundReversal_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderProfitRefundReversal_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderProfitReconciliationTask"
  ADD CONSTRAINT "OrderProfitReconciliationTask_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderProfitReconciliationTask_sourceSnapshotId_fkey"
  FOREIGN KEY ("sourceSnapshotId") REFERENCES "OrderProfitSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderProfitReconciliationTask_resolvedSnapshotId_fkey"
  FOREIGN KEY ("resolvedSnapshotId") REFERENCES "OrderProfitSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CaptainMonthlySettlementOrder"
  ADD CONSTRAINT "CaptainMonthlySettlementOrder_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "CaptainMonthlySettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CaptainMonthlySettlementOrder_orderAttributionId_fkey"
  FOREIGN KEY ("orderAttributionId") REFERENCES "CaptainOrderAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderProfitAdjustmentDraft"
  ADD CONSTRAINT "OrderProfitAdjustmentDraft_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderProfitAdjustmentDraft_sourceSnapshotId_fkey"
  FOREIGN KEY ("sourceSnapshotId") REFERENCES "OrderProfitSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OrderProfitAdjustmentDraft_targetSnapshotId_fkey"
  FOREIGN KEY ("targetSnapshotId") REFERENCES "OrderProfitSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CaptainOrderAttribution"
  ADD CONSTRAINT "CaptainOrderAttribution_profitSnapshotId_fkey"
  FOREIGN KEY ("profitSnapshotId") REFERENCES "OrderProfitSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
