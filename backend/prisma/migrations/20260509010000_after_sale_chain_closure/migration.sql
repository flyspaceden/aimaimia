-- Preflight: fail clearly before any mutating migration statement if legacy orphan refundId values exist.
DO $$
DECLARE
  orphan_record RECORD;
BEGIN
  SELECT id, "refundId"
  INTO orphan_record
  FROM "after_sale_request" a
  WHERE a."refundId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Refund" r WHERE r.id = a."refundId"
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot add after_sale_request.refundId FK: orphan refundId values exist. Example after_sale_request.id=%, refundId=%',
      orphan_record.id,
      orphan_record."refundId";
  END IF;
END $$;

-- AlterEnum: additive no-reason exchange support
ALTER TYPE "AfterSaleType" ADD VALUE IF NOT EXISTS 'NO_REASON_EXCHANGE';

-- CreateEnum
CREATE TYPE "ReturnShippingPayer" AS ENUM ('BUYER', 'SELLER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "AfterSaleOperatorType" AS ENUM ('BUYER', 'SELLER_STAFF', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AfterSaleShippingPaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUNDING', 'REFUNDED', 'CLOSED');

-- AlterTable: after_sale_request - additive chain-closure fields only
ALTER TABLE "after_sale_request" ADD COLUMN "arbitrationSourceStatus" "AfterSaleStatus";
ALTER TABLE "after_sale_request" ADD COLUMN "targetSkuId" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "targetQuantity" INTEGER;
ALTER TABLE "after_sale_request" ADD COLUMN "returnCarrierCode" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "returnWaybillUrl" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "returnSfOrderId" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "returnLabelUrl" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "returnShippingFee" DOUBLE PRECISION;
ALTER TABLE "after_sale_request" ADD COLUMN "returnShippingPayer" "ReturnShippingPayer";
ALTER TABLE "after_sale_request" ADD COLUMN "returnShippingPaidAt" TIMESTAMP(3);
ALTER TABLE "after_sale_request" ADD COLUMN "returnShippingFeeDeducted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "after_sale_request" ADD COLUMN "manualReviewReason" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "manualReviewRequestedAt" TIMESTAMP(3);
ALTER TABLE "after_sale_request" ADD COLUMN "manualReviewResolvedAt" TIMESTAMP(3);
ALTER TABLE "after_sale_request" ADD COLUMN "sellerReturnCarrierCode" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "sellerReturnCarrierName" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "sellerReturnWaybillUrl" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "sellerReturnSfOrderId" TEXT;

-- AlterTable: Refund - optional after-sale relation
ALTER TABLE "Refund" ADD COLUMN "afterSaleId" TEXT;

-- Backfill: grandfather existing return-required after-sale rows with payer defaults.
-- Legacy manual logistics rows with returnWaybillNo and no returnSfOrderId remain valid and do not require payment rows.
UPDATE "after_sale_request"
SET "returnShippingPayer" = CASE
  WHEN "afterSaleType" = 'NO_REASON_RETURN' THEN 'BUYER'::"ReturnShippingPayer"
  ELSE 'SELLER'::"ReturnShippingPayer"
END
WHERE "requiresReturn" = true
  AND "returnShippingPayer" IS NULL;

-- CreateTable
CREATE TABLE "after_sale_status_history" (
    "id" TEXT NOT NULL,
    "afterSaleId" TEXT NOT NULL,
    "fromStatus" "AfterSaleStatus",
    "toStatus" "AfterSaleStatus" NOT NULL,
    "reason" TEXT,
    "operatorType" "AfterSaleOperatorType",
    "operatorId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sale_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sale_shipping_payments" (
    "id" TEXT NOT NULL,
    "afterSaleId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "AfterSaleShippingPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "merchantPaymentNo" TEXT NOT NULL,
    "providerPaymentNo" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'ALIPAY',
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "after_sale_shipping_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_afterSaleId_key" ON "Refund"("afterSaleId");

-- CreateIndex
CREATE INDEX "after_sale_request_refundId_idx" ON "after_sale_request"("refundId");

-- CreateIndex
CREATE INDEX "after_sale_status_history_afterSaleId_createdAt_idx" ON "after_sale_status_history"("afterSaleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_shipping_payments_afterSaleId_key" ON "after_sale_shipping_payments"("afterSaleId");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_shipping_payments_merchantPaymentNo_key" ON "after_sale_shipping_payments"("merchantPaymentNo");

-- CreateIndex
CREATE INDEX "after_sale_shipping_payments_status_createdAt_idx" ON "after_sale_shipping_payments"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_afterSaleId_fkey" FOREIGN KEY ("afterSaleId") REFERENCES "after_sale_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sale_request" ADD CONSTRAINT "after_sale_request_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sale_status_history" ADD CONSTRAINT "after_sale_status_history_afterSaleId_fkey" FOREIGN KEY ("afterSaleId") REFERENCES "after_sale_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sale_shipping_payments" ADD CONSTRAINT "after_sale_shipping_payments_afterSaleId_fkey" FOREIGN KEY ("afterSaleId") REFERENCES "after_sale_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
