-- CreateEnum
CREATE TYPE "DigitalAssetLedgerType" AS ENUM ('ORDER_RECEIVED', 'REFUND_REVERSAL', 'ADMIN_ADJUSTMENT', 'BACKFILL');

-- CreateEnum
CREATE TYPE "DigitalAssetLedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EXPORT';

-- CreateTable
CREATE TABLE "DigitalAssetAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cumulativeSpendAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalAssetAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalAssetLedger" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "DigitalAssetLedgerType" NOT NULL,
    "direction" "DigitalAssetLedgerDirection" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "refundId" TEXT,
    "afterSaleId" TEXT,
    "adminUserId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalAssetLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigitalAssetAccount_userId_key" ON "DigitalAssetAccount"("userId");

-- CreateIndex
CREATE INDEX "DigitalAssetAccount_cumulativeSpendAmount_idx" ON "DigitalAssetAccount"("cumulativeSpendAmount");

-- CreateIndex
CREATE INDEX "DigitalAssetAccount_updatedAt_idx" ON "DigitalAssetAccount"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalAssetLedger_idempotencyKey_key" ON "DigitalAssetLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DigitalAssetLedger_userId_createdAt_idx" ON "DigitalAssetLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DigitalAssetLedger_accountId_createdAt_idx" ON "DigitalAssetLedger"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "DigitalAssetLedger_orderId_idx" ON "DigitalAssetLedger"("orderId");

-- CreateIndex
CREATE INDEX "DigitalAssetLedger_orderItemId_idx" ON "DigitalAssetLedger"("orderItemId");

-- CreateIndex
CREATE INDEX "DigitalAssetLedger_refundId_idx" ON "DigitalAssetLedger"("refundId");

-- CreateIndex
CREATE INDEX "DigitalAssetLedger_afterSaleId_idx" ON "DigitalAssetLedger"("afterSaleId");

-- CreateIndex
CREATE INDEX "DigitalAssetLedger_adminUserId_createdAt_idx" ON "DigitalAssetLedger"("adminUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "DigitalAssetAccount" ADD CONSTRAINT "DigitalAssetAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAssetLedger" ADD CONSTRAINT "DigitalAssetLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "DigitalAssetAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAssetLedger" ADD CONSTRAINT "DigitalAssetLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAssetLedger" ADD CONSTRAINT "DigitalAssetLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAssetLedger" ADD CONSTRAINT "DigitalAssetLedger_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAssetLedger" ADD CONSTRAINT "DigitalAssetLedger_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAssetLedger" ADD CONSTRAINT "DigitalAssetLedger_afterSaleId_fkey" FOREIGN KEY ("afterSaleId") REFERENCES "after_sale_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalAssetLedger" ADD CONSTRAINT "DigitalAssetLedger_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
