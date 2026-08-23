CREATE TYPE "RefundSideEffectKind" AS ENUM (
  'DIGITAL_ASSET_REVERSAL',
  'CAPTAIN_COMMISSION_VOID'
);

CREATE TYPE "RefundSideEffectStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "RefundSideEffectOutbox" (
  "id" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "refundAmount" DOUBLE PRECISION NOT NULL,
  "kind" "RefundSideEffectKind" NOT NULL,
  "source" VARCHAR(32) NOT NULL,
  "status" "RefundSideEffectStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RefundSideEffectOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundSideEffectOutbox_refundId_kind_key"
  ON "RefundSideEffectOutbox"("refundId", "kind");
CREATE INDEX "RefundSideEffectOutbox_status_runAt_createdAt_idx"
  ON "RefundSideEffectOutbox"("status", "runAt", "createdAt");
CREATE INDEX "RefundSideEffectOutbox_status_leaseExpiresAt_idx"
  ON "RefundSideEffectOutbox"("status", "leaseExpiresAt");
CREATE INDEX "RefundSideEffectOutbox_orderId_status_idx"
  ON "RefundSideEffectOutbox"("orderId", "status");

ALTER TABLE "RefundSideEffectOutbox"
  ADD CONSTRAINT "RefundSideEffectOutbox_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 历史已成功的非售后自动退款：数字资产均需幂等补偿。
INSERT INTO "RefundSideEffectOutbox" (
  "id", "refundId", "orderId", "refundAmount", "kind", "source",
  "status", "attempts", "runAt", "createdAt", "updatedAt"
)
SELECT
  'refund-effect-' || md5(r."id" || ':DIGITAL_ASSET_REVERSAL'),
  r."id", r."orderId", r."amount", 'DIGITAL_ASSET_REVERSAL', 'HISTORICAL_BACKFILL',
  'PENDING', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Refund" r
WHERE r."status" = 'REFUNDED'
  AND r."deletedAt" IS NULL
  AND r."afterSaleId" IS NULL
  AND r."merchantRefundNo" NOT LIKE 'AS-%'
ON CONFLICT ("refundId", "kind") DO NOTHING;

-- 只有 LEGACY/无 READY 利润快照自动退款需要整单团长佣金冲回。
-- V3 已在退款 CAS 事务中按利润来源冲正，不可重复执行 legacy void。
INSERT INTO "RefundSideEffectOutbox" (
  "id", "refundId", "orderId", "refundAmount", "kind", "source",
  "status", "attempts", "runAt", "createdAt", "updatedAt"
)
SELECT
  'refund-effect-' || md5(r."id" || ':CAPTAIN_COMMISSION_VOID'),
  r."id", r."orderId", r."amount", 'CAPTAIN_COMMISSION_VOID', 'HISTORICAL_BACKFILL',
  'PENDING', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Refund" r
WHERE r."status" = 'REFUNDED'
  AND r."deletedAt" IS NULL
  AND r."afterSaleId" IS NULL
  AND r."merchantRefundNo" NOT LIKE 'AS-%'
  AND NOT EXISTS (
    SELECT 1
    FROM "OrderProfitSnapshot" s
    WHERE s."orderId" = r."orderId"
      AND s."isCurrent" = true
      AND s."status" = 'READY'
  )
ON CONFLICT ("refundId", "kind") DO NOTHING;
