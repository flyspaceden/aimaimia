BEGIN;
-- CreateEnum
CREATE TYPE "IndustryFundLedgerEventType" AS ENUM ('ACCRUAL', 'RELEASE', 'REVERSAL', 'REVERSAL_PENDING', 'PAYMENT_RESERVED', 'PAYMENT_UNRESERVED', 'PAYMENT_CONFIRMED', 'PAYMENT_REVERSED', 'RECOVERY');

-- CreateEnum
CREATE TYPE "IndustryFundPaymentStatus" AS ENUM ('RESERVED', 'PAID', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "IndustryFundUnassignedStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateTable
CREATE TABLE "industry_fund_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "frozenAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payableAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAccrued" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalReversed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRecovered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveryDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industry_fund_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_fund_accruals" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "scheme" VARCHAR(64) NOT NULL,
    "ledgerVersion" VARCHAR(64) NOT NULL DEFAULT 'COMPANY_LEDGER_V1',
    "profitBaseAmount" DOUBLE PRECISION NOT NULL,
    "companyShareAmount" DOUBLE PRECISION NOT NULL,
    "companyShareRatio" DOUBLE PRECISION NOT NULL,
    "industryFundRatio" DOUBLE PRECISION NOT NULL,
    "configSnapshot" JSONB,
    "originalAmount" DOUBLE PRECISION NOT NULL,
    "frozenAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payableAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reversedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reversedPaidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveredAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveryDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reversalPendingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reversalPendingReason" TEXT,
    "reversedAt" TIMESTAMP(3),
    "sourceEventAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industry_fund_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_fund_ledgers" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accrualId" TEXT,
    "companyId" TEXT,
    "allocationId" TEXT,
    "orderId" TEXT,
    "afterSaleId" TEXT,
    "paymentId" TEXT,
    "recoveryId" TEXT,
    "eventType" "IndustryFundLedgerEventType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frozenDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payableDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveredDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveryDueDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAccruedDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalReversedDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPaidDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRecoveredDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balanceFrozen" DOUBLE PRECISION NOT NULL,
    "balancePayable" DOUBLE PRECISION NOT NULL,
    "balanceReserved" DOUBLE PRECISION NOT NULL,
    "balanceRecoveryDue" DOUBLE PRECISION NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceLedgerId" TEXT,
    "relatedLedgerId" TEXT,
    "bankReference" TEXT,
    "reason" TEXT,
    "actorType" VARCHAR(32),
    "actorId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_fund_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_fund_payments" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "IndustryFundPaymentStatus" NOT NULL DEFAULT 'RESERVED',
    "payeeName" TEXT NOT NULL,
    "bankAccount" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "sourceAccountRef" TEXT,
    "bankReference" TEXT,
    "proofKey" TEXT,
    "actualPaidAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "confirmedBy" TEXT,
    "cancelledBy" TEXT,
    "reversedBy" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industry_fund_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_fund_payment_items" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "accrualId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reservedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveryDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveredAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_fund_payment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_fund_unassigned_entries" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "scheme" VARCHAR(64) NOT NULL,
    "profitBaseAmount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "IndustryFundUnassignedStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedCompanyId" TEXT,
    "resolvedAccrualId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,
    "reversedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industry_fund_unassigned_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_fund_recoveries" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "bankReference" TEXT NOT NULL,
    "proofKey" TEXT NOT NULL,
    "recoveredAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_fund_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_fund_recovery_items" (
    "id" TEXT NOT NULL,
    "recoveryId" TEXT NOT NULL,
    "accrualId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_fund_recovery_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_accounts_companyId_key" ON "industry_fund_accounts"("companyId");

-- CreateIndex
CREATE INDEX "industry_fund_accounts_updatedAt_idx" ON "industry_fund_accounts"("updatedAt");

-- CreateIndex
CREATE INDEX "industry_fund_accruals_companyId_createdAt_id_idx" ON "industry_fund_accruals"("companyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "industry_fund_accruals_accountId_createdAt_id_idx" ON "industry_fund_accruals"("accountId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "industry_fund_accruals_orderId_createdAt_idx" ON "industry_fund_accruals"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_accruals_reversalPendingAmount_createdAt_idx" ON "industry_fund_accruals"("reversalPendingAmount", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_accruals_allocationId_companyId_key" ON "industry_fund_accruals"("allocationId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_ledgers_idempotencyKey_key" ON "industry_fund_ledgers"("idempotencyKey");

-- CreateIndex
CREATE INDEX "industry_fund_ledgers_accountId_createdAt_id_idx" ON "industry_fund_ledgers"("accountId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "industry_fund_ledgers_accrualId_createdAt_idx" ON "industry_fund_ledgers"("accrualId", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_ledgers_companyId_createdAt_idx" ON "industry_fund_ledgers"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_ledgers_orderId_createdAt_idx" ON "industry_fund_ledgers"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_ledgers_afterSaleId_createdAt_idx" ON "industry_fund_ledgers"("afterSaleId", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_ledgers_paymentId_createdAt_idx" ON "industry_fund_ledgers"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_ledgers_eventType_createdAt_idx" ON "industry_fund_ledgers"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_payments_idempotencyKey_key" ON "industry_fund_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "industry_fund_payments_companyId_status_createdAt_idx" ON "industry_fund_payments"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_payments_accountId_status_createdAt_idx" ON "industry_fund_payments"("accountId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_payments_bankReference_idx" ON "industry_fund_payments"("bankReference");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_payments_sourceAccountRef_bankReference_key" ON "industry_fund_payments"("sourceAccountRef", "bankReference");

-- CreateIndex
CREATE INDEX "industry_fund_payment_items_accrualId_createdAt_idx" ON "industry_fund_payment_items"("accrualId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_payment_items_paymentId_accrualId_key" ON "industry_fund_payment_items"("paymentId", "accrualId");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_unassigned_entries_allocationId_key" ON "industry_fund_unassigned_entries"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_unassigned_entries_idempotencyKey_key" ON "industry_fund_unassigned_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "industry_fund_unassigned_entries_status_createdAt_id_idx" ON "industry_fund_unassigned_entries"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "industry_fund_unassigned_entries_orderId_createdAt_idx" ON "industry_fund_unassigned_entries"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_recoveries_bankReference_key" ON "industry_fund_recoveries"("bankReference");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_recoveries_idempotencyKey_key" ON "industry_fund_recoveries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "industry_fund_recoveries_companyId_createdAt_idx" ON "industry_fund_recoveries"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_recoveries_paymentId_createdAt_idx" ON "industry_fund_recoveries"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "industry_fund_recovery_items_accrualId_createdAt_idx" ON "industry_fund_recovery_items"("accrualId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "industry_fund_recovery_items_recoveryId_accrualId_key" ON "industry_fund_recovery_items"("recoveryId", "accrualId");

-- AddForeignKey
ALTER TABLE "industry_fund_accounts" ADD CONSTRAINT "industry_fund_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_accruals" ADD CONSTRAINT "industry_fund_accruals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "industry_fund_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_accruals" ADD CONSTRAINT "industry_fund_accruals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_accruals" ADD CONSTRAINT "industry_fund_accruals_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "RewardAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_accruals" ADD CONSTRAINT "industry_fund_accruals_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_ledgers" ADD CONSTRAINT "industry_fund_ledgers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "industry_fund_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_ledgers" ADD CONSTRAINT "industry_fund_ledgers_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "industry_fund_accruals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_ledgers" ADD CONSTRAINT "industry_fund_ledgers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_ledgers" ADD CONSTRAINT "industry_fund_ledgers_afterSaleId_fkey" FOREIGN KEY ("afterSaleId") REFERENCES "after_sale_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_ledgers" ADD CONSTRAINT "industry_fund_ledgers_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "industry_fund_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_ledgers" ADD CONSTRAINT "industry_fund_ledgers_recoveryId_fkey" FOREIGN KEY ("recoveryId") REFERENCES "industry_fund_recoveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_payments" ADD CONSTRAINT "industry_fund_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "industry_fund_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_payments" ADD CONSTRAINT "industry_fund_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_payment_items" ADD CONSTRAINT "industry_fund_payment_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "industry_fund_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_payment_items" ADD CONSTRAINT "industry_fund_payment_items_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "industry_fund_accruals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_unassigned_entries" ADD CONSTRAINT "industry_fund_unassigned_entries_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "RewardAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_unassigned_entries" ADD CONSTRAINT "industry_fund_unassigned_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_unassigned_entries" ADD CONSTRAINT "industry_fund_unassigned_entries_resolvedCompanyId_fkey" FOREIGN KEY ("resolvedCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_recoveries" ADD CONSTRAINT "industry_fund_recoveries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "industry_fund_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_recoveries" ADD CONSTRAINT "industry_fund_recoveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_recoveries" ADD CONSTRAINT "industry_fund_recoveries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "industry_fund_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_recovery_items" ADD CONSTRAINT "industry_fund_recovery_items_recoveryId_fkey" FOREIGN KEY ("recoveryId") REFERENCES "industry_fund_recoveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_fund_recovery_items" ADD CONSTRAINT "industry_fund_recovery_items_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "industry_fund_accruals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;
