-- Delivery orders support one payment with one or more independently fulfilled SF batches.
CREATE TYPE "DeliveryPickupMode" AS ENUM ('SINGLE', 'MULTI_BATCH');
CREATE TYPE "DeliveryPickupStatus" AS ENUM ('NOT_STARTED', 'PARTIAL_PICKED', 'ALL_PICKED', 'CANCELED');
CREATE TYPE "DeliveryPickupBatchStatus" AS ENUM ('PLANNED', 'READY_TO_CALL', 'CALLING_CARRIER', 'WAITING_DRIVER', 'DRIVER_ASSIGNED', 'ARRIVED', 'LOADED', 'DELIVERING', 'COMPLETED', 'CANCELED', 'EXCEPTION');
CREATE TYPE "DeliveryCarrierProvider" AS ENUM ('SF');
CREATE TYPE "DeliveryCarrierPaymentMode" AS ENUM ('PLATFORM_MONTHLY');
CREATE TYPE "DeliveryShippingCostLedgerType" AS ENUM ('PREPAID_BY_USER', 'CARRIER_ESTIMATE', 'CARRIER_ACTUAL', 'MANUAL_ADJUSTMENT');

ALTER TABLE "DeliveryCheckoutSession"
  ADD COLUMN "pickupMode" "DeliveryPickupMode" NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN "pickupPlanSnapshot" JSONB,
  ADD COLUMN "plannedPickupCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "prepaidPickupShippingFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "DeliveryCheckoutSession_plannedPickupCount_check" CHECK ("plannedPickupCount" >= 1),
  ADD CONSTRAINT "DeliveryCheckoutSession_prepaidPickupShippingFeeCents_check" CHECK ("prepaidPickupShippingFeeCents" >= 0);

ALTER TABLE "DeliveryOrder"
  ADD COLUMN "actualCarrierCostCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pickupMode" "DeliveryPickupMode" NOT NULL DEFAULT 'SINGLE',
  ADD COLUMN "pickupStatus" "DeliveryPickupStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "plannedPickupCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "prepaidPickupShippingFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shippingCostDiffCents" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "DeliveryOrder_plannedPickupCount_check" CHECK ("plannedPickupCount" >= 1),
  ADD CONSTRAINT "DeliveryOrder_prepaidPickupShippingFeeCents_check" CHECK ("prepaidPickupShippingFeeCents" >= 0),
  ADD CONSTRAINT "DeliveryOrder_actualCarrierCostCents_check" CHECK ("actualCarrierCostCents" >= 0);

ALTER TABLE "DeliverySubOrder"
  ADD COLUMN "pickupStatus" "DeliveryPickupStatus" NOT NULL DEFAULT 'NOT_STARTED';

ALTER TABLE "DeliveryOrderItem"
  ADD COLUMN "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reservedPickupQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "DeliveryOrderItem_pickup_quantities_check"
    CHECK (
      "pickedQuantity" >= 0
      AND "reservedPickupQuantity" >= 0
      AND "pickedQuantity" + "reservedPickupQuantity" <= "quantity"
    );

CREATE TABLE "DeliveryPickupBatch" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "subOrderId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "batchNo" INTEGER NOT NULL,
  "status" "DeliveryPickupBatchStatus" NOT NULL DEFAULT 'PLANNED',
  "provider" "DeliveryCarrierProvider" NOT NULL DEFAULT 'SF',
  "plannedPickupAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "calledAt" TIMESTAMP(3),
  "loadedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "receiverSnapshot" JSONB,
  "senderSnapshot" JSONB,
  "cargoSnapshot" JSONB,
  "estimatedShippingFeeCents" INTEGER,
  "actualCarrierCostCents" INTEGER,
  "shippingCostDiffCents" INTEGER,
  "createdByAdminId" TEXT,
  "lastOperatorType" "DeliveryAuditActorType",
  "lastOperatorId" TEXT,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryPickupBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryPickupBatch_batchNo_check" CHECK ("batchNo" >= 1),
  CONSTRAINT "DeliveryPickupBatch_estimatedShippingFeeCents_check" CHECK ("estimatedShippingFeeCents" IS NULL OR "estimatedShippingFeeCents" >= 0),
  CONSTRAINT "DeliveryPickupBatch_actualCarrierCostCents_check" CHECK ("actualCarrierCostCents" IS NULL OR "actualCarrierCostCents" >= 0)
);

CREATE TABLE "DeliveryPickupBatchItem" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "subOrderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "productSnapshot" JSONB NOT NULL,
  "quantity" INTEGER NOT NULL,
  "pickedQuantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryPickupBatchItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryPickupBatchItem_quantities_check"
    CHECK ("quantity" >= 1 AND "pickedQuantity" >= 0 AND "pickedQuantity" <= "quantity")
);

CREATE TABLE "DeliveryCarrierOrder" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "provider" "DeliveryCarrierProvider" NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "outsideOrderId" TEXT NOT NULL,
  "carrierOrderNo" TEXT,
  "expressTypeId" INTEGER,
  "expressTypeName" TEXT,
  "packageCount" INTEGER,
  "totalWeightKg" DOUBLE PRECISION,
  "waybillUrl" TEXT,
  "payType" "DeliveryCarrierPaymentMode" NOT NULL DEFAULT 'PLATFORM_MONTHLY',
  "status" TEXT NOT NULL,
  "estimatePayload" JSONB,
  "orderPayload" JSONB,
  "detailPayload" JSONB,
  "cancelPayload" JSONB,
  "estimatedFeeCents" INTEGER,
  "actualFeeCents" INTEGER,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryCarrierOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryCarrierOrder_attempt_check" CHECK ("attempt" >= 1),
  CONSTRAINT "DeliveryCarrierOrder_expressTypeId_check" CHECK ("expressTypeId" IS NULL OR "expressTypeId" >= 1),
  CONSTRAINT "DeliveryCarrierOrder_packageCount_check" CHECK ("packageCount" IS NULL OR ("packageCount" >= 1 AND "packageCount" <= 999)),
  CONSTRAINT "DeliveryCarrierOrder_totalWeightKg_check" CHECK ("totalWeightKg" IS NULL OR "totalWeightKg" > 0),
  CONSTRAINT "DeliveryCarrierOrder_estimatedFeeCents_check" CHECK ("estimatedFeeCents" IS NULL OR "estimatedFeeCents" >= 0),
  CONSTRAINT "DeliveryCarrierOrder_actualFeeCents_check" CHECK ("actualFeeCents" IS NULL OR "actualFeeCents" >= 0)
);

CREATE TABLE "DeliveryCarrierWaybill" (
  "id" TEXT NOT NULL,
  "carrierOrderId" TEXT NOT NULL,
  "trackingNo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'WAITING_PICKUP',
  "deliveredAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryCarrierWaybill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryShippingCostLedger" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "subOrderId" TEXT,
  "batchId" TEXT,
  "provider" "DeliveryCarrierProvider" NOT NULL,
  "type" "DeliveryShippingCostLedgerType" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "sourceRefId" TEXT,
  "payloadSnapshot" JSONB,
  "createdByType" "DeliveryAuditActorType" NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryShippingCostLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryShippingCostLedger_amount_check"
    CHECK ("type" = 'MANUAL_ADJUSTMENT' OR "amountCents" >= 0)
);

CREATE INDEX "DeliveryPickupBatch_orderId_status_createdAt_idx" ON "DeliveryPickupBatch"("orderId", "status", "createdAt");
CREATE INDEX "DeliveryPickupBatch_merchantId_status_createdAt_idx" ON "DeliveryPickupBatch"("merchantId", "status", "createdAt");
CREATE UNIQUE INDEX "DeliveryPickupBatch_id_orderId_key" ON "DeliveryPickupBatch"("id", "orderId");
CREATE UNIQUE INDEX "DeliveryPickupBatch_id_orderId_subOrderId_key" ON "DeliveryPickupBatch"("id", "orderId", "subOrderId");
CREATE UNIQUE INDEX "DeliveryPickupBatch_id_subOrderId_key" ON "DeliveryPickupBatch"("id", "subOrderId");
CREATE UNIQUE INDEX "DeliveryPickupBatch_subOrderId_batchNo_key" ON "DeliveryPickupBatch"("subOrderId", "batchNo");
CREATE INDEX "DeliveryPickupBatchItem_orderItemId_subOrderId_idx" ON "DeliveryPickupBatchItem"("orderItemId", "subOrderId");
CREATE UNIQUE INDEX "DeliveryPickupBatchItem_batchId_orderItemId_key" ON "DeliveryPickupBatchItem"("batchId", "orderItemId");
CREATE UNIQUE INDEX "DeliveryCarrierOrder_outsideOrderId_key" ON "DeliveryCarrierOrder"("outsideOrderId");
CREATE INDEX "DeliveryCarrierOrder_batchId_provider_idx" ON "DeliveryCarrierOrder"("batchId", "provider");
CREATE INDEX "DeliveryCarrierOrder_carrierOrderNo_idx" ON "DeliveryCarrierOrder"("carrierOrderNo");
CREATE UNIQUE INDEX "DeliveryCarrierOrder_batchId_attempt_key" ON "DeliveryCarrierOrder"("batchId", "attempt");
CREATE UNIQUE INDEX "DeliveryCarrierWaybill_trackingNo_key" ON "DeliveryCarrierWaybill"("trackingNo");
CREATE INDEX "DeliveryCarrierWaybill_carrierOrderId_status_idx" ON "DeliveryCarrierWaybill"("carrierOrderId", "status");
CREATE INDEX "DeliveryShippingCostLedger_orderId_createdAt_idx" ON "DeliveryShippingCostLedger"("orderId", "createdAt");
CREATE INDEX "DeliveryShippingCostLedger_batchId_createdAt_idx" ON "DeliveryShippingCostLedger"("batchId", "createdAt");
CREATE UNIQUE INDEX "DeliverySubOrder_id_orderId_key" ON "DeliverySubOrder"("id", "orderId");
CREATE UNIQUE INDEX "DeliverySubOrder_id_orderId_merchantId_key" ON "DeliverySubOrder"("id", "orderId", "merchantId");
CREATE UNIQUE INDEX "DeliveryOrderItem_id_subOrderId_key" ON "DeliveryOrderItem"("id", "subOrderId");

ALTER TABLE "DeliveryPickupBatch" ADD CONSTRAINT "DeliveryPickupBatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryPickupBatch" ADD CONSTRAINT "DeliveryPickupBatch_subOrderId_orderId_merchantId_fkey" FOREIGN KEY ("subOrderId", "orderId", "merchantId") REFERENCES "DeliverySubOrder"("id", "orderId", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryPickupBatch" ADD CONSTRAINT "DeliveryPickupBatch_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryPickupBatchItem" ADD CONSTRAINT "DeliveryPickupBatchItem_batchId_subOrderId_fkey" FOREIGN KEY ("batchId", "subOrderId") REFERENCES "DeliveryPickupBatch"("id", "subOrderId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryPickupBatchItem" ADD CONSTRAINT "DeliveryPickupBatchItem_orderItemId_subOrderId_fkey" FOREIGN KEY ("orderItemId", "subOrderId") REFERENCES "DeliveryOrderItem"("id", "subOrderId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryCarrierOrder" ADD CONSTRAINT "DeliveryCarrierOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DeliveryPickupBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryCarrierWaybill" ADD CONSTRAINT "DeliveryCarrierWaybill_carrierOrderId_fkey" FOREIGN KEY ("carrierOrderId") REFERENCES "DeliveryCarrierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryShippingCostLedger" ADD CONSTRAINT "DeliveryShippingCostLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryShippingCostLedger" ADD CONSTRAINT "DeliveryShippingCostLedger_subOrderId_orderId_fkey" FOREIGN KEY ("subOrderId", "orderId") REFERENCES "DeliverySubOrder"("id", "orderId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryShippingCostLedger" ADD CONSTRAINT "DeliveryShippingCostLedger_batchId_orderId_fkey" FOREIGN KEY ("batchId", "orderId") REFERENCES "DeliveryPickupBatch"("id", "orderId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryShippingCostLedger" ADD CONSTRAINT "DeliveryShippingCostLedger_batchId_subOrderId_fkey" FOREIGN KEY ("batchId", "subOrderId") REFERENCES "DeliveryPickupBatch"("id", "subOrderId") ON DELETE CASCADE ON UPDATE CASCADE;
