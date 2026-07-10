-- Align explicitly named V3 constraints and long indexes with Prisma's expected
-- physical names. PostgreSQL otherwise truncates the original migration names
-- differently, producing perpetual schema drift without changing semantics.

ALTER TABLE "CaptainOrderAttribution"
  RENAME CONSTRAINT "CaptainOrderAttribution_profitSnapshotId_fkey"
  TO "CaptainOrderAttribution_profitSnapshotId_orderId_fkey";

ALTER TABLE "OrderProfitAdjustmentDraft"
  RENAME CONSTRAINT "OrderProfitAdjustmentDraft_sourceSnapshotId_fkey"
  TO "OrderProfitAdjustmentDraft_sourceSnapshotId_orderId_fkey";
ALTER TABLE "OrderProfitAdjustmentDraft"
  RENAME CONSTRAINT "OrderProfitAdjustmentDraft_targetSnapshotId_fkey"
  TO "OrderProfitAdjustmentDraft_targetSnapshotId_orderId_fkey";

ALTER TABLE "OrderProfitFundingLedger"
  RENAME CONSTRAINT "OrderProfitFundingLedger_snapshotId_fkey"
  TO "OrderProfitFundingLedger_snapshotId_orderId_fkey";

ALTER TABLE "OrderProfitReconciliationTask"
  RENAME CONSTRAINT "OrderProfitReconciliationTask_resolvedSnapshotId_fkey"
  TO "OrderProfitReconciliationTask_resolvedSnapshotId_orderId_fkey";
ALTER TABLE "OrderProfitReconciliationTask"
  RENAME CONSTRAINT "OrderProfitReconciliationTask_sourceSnapshotId_fkey"
  TO "OrderProfitReconciliationTask_sourceSnapshotId_orderId_fkey";

ALTER TABLE "OrderProfitRefundReversal"
  RENAME CONSTRAINT "OrderProfitRefundReversal_orderItemId_fkey"
  TO "OrderProfitRefundReversal_orderItemId_orderId_fkey";
ALTER TABLE "OrderProfitRefundReversal"
  RENAME CONSTRAINT "OrderProfitRefundReversal_refundId_fkey"
  TO "OrderProfitRefundReversal_refundId_orderId_fkey";
ALTER TABLE "OrderProfitRefundReversal"
  RENAME CONSTRAINT "OrderProfitRefundReversal_snapshotId_fkey"
  TO "OrderProfitRefundReversal_snapshotId_orderId_fkey";

ALTER TABLE "OrderProfitSnapshot"
  RENAME CONSTRAINT "OrderProfitSnapshot_supersedesSnapshotId_fkey"
  TO "OrderProfitSnapshot_supersedesSnapshotId_orderId_fkey";

ALTER INDEX "CaptainMonthlySettlementOrder_settlementId_orderAttributionId_k"
  RENAME TO "CaptainMonthlySettlementOrder_settlementId_orderAttribution_key";
ALTER INDEX "CaptainOrderAttribution_directCaptainUserId_status_createdAt_id"
  RENAME TO "CaptainOrderAttribution_directCaptainUserId_status_createdA_idx";
ALTER INDEX "CaptainOrderAttribution_legacyIndirectCaptainUserId_status_crea"
  RENAME TO "CaptainOrderAttribution_legacyIndirectCaptainUserId_status__idx";
ALTER INDEX "CaptainRelation_legacyIndirectCaptainUserId_status_createdAt_id"
  RENAME TO "CaptainRelation_legacyIndirectCaptainUserId_status_createdA_idx";
ALTER INDEX "OrderProfitRefundReversal_refundId_orderItemId_sourceLedgerId_k"
  RENAME TO "OrderProfitRefundReversal_refundId_orderItemId_sourceLedger_key";
