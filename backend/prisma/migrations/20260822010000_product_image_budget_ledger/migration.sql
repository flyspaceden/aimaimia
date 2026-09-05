-- Paid image generation is governed by an integer-cents reservation ledger before any provider call.
CREATE TYPE "ProductImageBudgetLedgerType" AS ENUM ('RESERVED', 'RELEASED', 'SETTLED');

CREATE TABLE "ProductImageBudgetLedger" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "optimizationId" TEXT NOT NULL,
  "type" "ProductImageBudgetLedgerType" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "budgetVersion" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductImageBudgetLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductImageBudgetLedger_amount_positive_check" CHECK ("amountCents" > 0)
);

CREATE UNIQUE INDEX "ProductImageBudgetLedger_idempotencyKey_key" ON "ProductImageBudgetLedger"("idempotencyKey");
CREATE UNIQUE INDEX "ProductImageBudgetLedger_optimizationId_type_key" ON "ProductImageBudgetLedger"("optimizationId", "type");
CREATE UNIQUE INDEX "ProductImageBudgetLedger_one_terminal_per_optimization_idx"
  ON "ProductImageBudgetLedger"("optimizationId")
  WHERE "type" IN ('RELEASED', 'SETTLED');
CREATE INDEX "ProductImageBudgetLedger_companyId_createdAt_idx" ON "ProductImageBudgetLedger"("companyId", "createdAt");
CREATE INDEX "ProductImageBudgetLedger_optimizationId_createdAt_idx" ON "ProductImageBudgetLedger"("optimizationId", "createdAt");

ALTER TABLE "ProductImageBudgetLedger" ADD CONSTRAINT "ProductImageBudgetLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImageBudgetLedger" ADD CONSTRAINT "ProductImageBudgetLedger_optimizationId_fkey" FOREIGN KEY ("optimizationId") REFERENCES "ProductImageOptimization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
