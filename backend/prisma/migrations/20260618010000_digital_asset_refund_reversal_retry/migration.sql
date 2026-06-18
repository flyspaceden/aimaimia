-- Track refund-success cases where digital asset reversal failed and needs retry.

CREATE TYPE "DigitalAssetRefundReversalFailureStatus" AS ENUM ('PENDING', 'RESOLVED', 'FAILED');

CREATE TABLE "DigitalAssetRefundReversalFailure" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderId" TEXT,
    "afterSaleId" TEXT,
    "userId" TEXT,
    "source" TEXT NOT NULL,
    "status" "DigitalAssetRefundReversalFailureStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalAssetRefundReversalFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DigitalAssetRefundReversalFailure_refundId_key"
    ON "DigitalAssetRefundReversalFailure"("refundId");

CREATE INDEX "DigitalAssetRefundReversalFailure_status_nextRetryAt_idx"
    ON "DigitalAssetRefundReversalFailure"("status", "nextRetryAt");

CREATE INDEX "DigitalAssetRefundReversalFailure_userId_createdAt_idx"
    ON "DigitalAssetRefundReversalFailure"("userId", "createdAt");

CREATE INDEX "DigitalAssetRefundReversalFailure_orderId_createdAt_idx"
    ON "DigitalAssetRefundReversalFailure"("orderId", "createdAt");

CREATE INDEX "DigitalAssetRefundReversalFailure_afterSaleId_createdAt_idx"
    ON "DigitalAssetRefundReversalFailure"("afterSaleId", "createdAt");
