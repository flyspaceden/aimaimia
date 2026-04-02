-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('ACTIVE', 'PAID', 'COMPLETED', 'EXPIRED', 'FAILED');

-- AlterEnum
ALTER TYPE "RewardLedgerStatus" ADD VALUE 'RESERVED';

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "itemsSnapshot" JSONB NOT NULL,
    "addressSnapshot" JSONB NOT NULL,
    "redPackId" TEXT,
    "expectedTotal" DOUBLE PRECISION NOT NULL,
    "goodsAmount" DOUBLE PRECISION NOT NULL,
    "shippingFee" DOUBLE PRECISION NOT NULL,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "merchantOrderNo" TEXT,
    "paymentChannel" "PaymentChannel",
    "providerTxnId" TEXT,
    "idempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_merchantOrderNo_key" ON "CheckoutSession"("merchantOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_providerTxnId_key" ON "CheckoutSession"("providerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutSession_idempotencyKey_key" ON "CheckoutSession"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CheckoutSession_userId_status_idx" ON "CheckoutSession"("userId", "status");

-- CreateIndex
CREATE INDEX "CheckoutSession_merchantOrderNo_idx" ON "CheckoutSession"("merchantOrderNo");

-- CreateIndex
CREATE INDEX "CheckoutSession_expiresAt_status_idx" ON "CheckoutSession"("expiresAt", "status");

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "checkoutSessionId" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
