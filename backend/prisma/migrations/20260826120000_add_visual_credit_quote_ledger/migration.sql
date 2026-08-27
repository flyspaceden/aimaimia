-- AI Visual Agent v2 credit, rate-card and quote foundation. This migration is
-- intentionally not applied by local development work.
CREATE TYPE "VisualRateCardStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RETIRED');
CREATE TYPE "VisualCreditQuoteStatus" AS ENUM ('ISSUED', 'RESERVED', 'RECONCILING', 'SETTLED', 'RELEASED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "VisualCreditLedgerType" AS ENUM ('WELCOME_GRANT', 'PURCHASE', 'RESERVE', 'SETTLE', 'RELEASE', 'EXPIRE', 'ADMIN_ADJUST', 'REVERSAL');

CREATE TABLE "VisualCreditAccount" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "billingOwnerType" TEXT NOT NULL,
  "billingOwnerId" TEXT NOT NULL,
  "availableCredits" INTEGER NOT NULL DEFAULT 0,
  "reservedCredits" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualCreditAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisualCreditAccount_balances_nonnegative" CHECK ("availableCredits" >= 0 AND "reservedCredits" >= 0)
);

CREATE TABLE "VisualCreditWelcomePolicy" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "grantCredits" INTEGER NOT NULL DEFAULT 200,
  "creditValueCents" INTEGER NOT NULL DEFAULT 2000,
  "policyVersion" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualCreditWelcomePolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisualCreditWelcomePolicy_grant_positive" CHECK ("grantCredits" > 0 AND "creditValueCents" >= 0)
);

CREATE TABLE "VisualRateCard" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "adapterNamespace" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "modelProfile" TEXT NOT NULL,
  "outputSpec" JSONB NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "creditCost" INTEGER NOT NULL,
  "status" "VisualRateCardStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualRateCard_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisualRateCard_candidate_and_cost_nonnegative" CHECK ("candidateCount" > 0 AND "creditCost" >= 0)
);

CREATE TABLE "VisualCreditQuote" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "adapterNamespace" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "rateCardId" TEXT NOT NULL,
  "externalObjectId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "visualPlanHash" TEXT NOT NULL,
  "rateCardSnapshot" JSONB NOT NULL,
  "creditCost" INTEGER NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "status" "VisualCreditQuoteStatus" NOT NULL DEFAULT 'ISSUED',
  "idempotencyKey" TEXT NOT NULL,
  "quoteHash" TEXT NOT NULL,
  "quotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualCreditQuote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisualCreditQuote_cost_and_candidates_nonnegative" CHECK ("creditCost" >= 0 AND "candidateCount" > 0)
);

CREATE TABLE "VisualCreditLedger" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "quoteId" TEXT,
  "type" "VisualCreditLedgerType" NOT NULL,
  "availableDelta" INTEGER NOT NULL,
  "reservedDelta" INTEGER NOT NULL,
  "availableBalanceAfter" INTEGER NOT NULL,
  "reservedBalanceAfter" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisualCreditLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisualCreditLedger_balances_nonnegative" CHECK ("availableBalanceAfter" >= 0 AND "reservedBalanceAfter" >= 0)
);

CREATE UNIQUE INDEX "VCAccount_tenant_owner_key" ON "VisualCreditAccount"("tenantId", "billingOwnerType", "billingOwnerId");
CREATE INDEX "VisualCreditAccount_tenantId_updatedAt_idx" ON "VisualCreditAccount"("tenantId", "updatedAt");
CREATE UNIQUE INDEX "VisualCreditWelcomePolicy_tenantId_key" ON "VisualCreditWelcomePolicy"("tenantId");
CREATE INDEX "VisualCreditWelcomePolicy_enabled_effectiveFrom_idx" ON "VisualCreditWelcomePolicy"("enabled", "effectiveFrom");
CREATE UNIQUE INDEX "VRateCard_scope_code_version_key" ON "VisualRateCard"("tenantId", "clientId", "adapterNamespace", "code", "version");
CREATE INDEX "VRateCard_scope_status_effective_idx" ON "VisualRateCard"("tenantId", "clientId", "adapterNamespace", "status", "effectiveFrom");
CREATE UNIQUE INDEX "VisualRateCard_one_active_code"
  ON "VisualRateCard"("tenantId", "clientId", "adapterNamespace", "code") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "VCQuote_scope_idempotency_key" ON "VisualCreditQuote"("tenantId", "clientId", "adapterNamespace", "idempotencyKey");
CREATE INDEX "VisualCreditQuote_billingAccountId_status_createdAt_idx" ON "VisualCreditQuote"("billingAccountId", "status", "createdAt");
CREATE INDEX "VCQuote_scope_object_status_idx" ON "VisualCreditQuote"("tenantId", "clientId", "adapterNamespace", "externalObjectId", "status");
CREATE INDEX "VisualCreditQuote_expiresAt_idx" ON "VisualCreditQuote"("expiresAt");
CREATE UNIQUE INDEX "VisualCreditLedger_idempotencyKey_key" ON "VisualCreditLedger"("idempotencyKey");
CREATE INDEX "VisualCreditLedger_accountId_createdAt_idx" ON "VisualCreditLedger"("accountId", "createdAt");
CREATE INDEX "VisualCreditLedger_quoteId_createdAt_idx" ON "VisualCreditLedger"("quoteId", "createdAt");

ALTER TABLE "VisualCreditAccount" ADD CONSTRAINT "VisualCreditAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "VisualAgentTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualCreditWelcomePolicy" ADD CONSTRAINT "VisualCreditWelcomePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "VisualAgentTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualRateCard" ADD CONSTRAINT "VisualRateCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "VisualAgentTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualCreditQuote" ADD CONSTRAINT "VisualCreditQuote_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "VisualCreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualCreditQuote" ADD CONSTRAINT "VisualCreditQuote_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "VisualRateCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualCreditLedger" ADD CONSTRAINT "VisualCreditLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "VisualCreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualCreditLedger" ADD CONSTRAINT "VisualCreditLedger_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "VisualCreditQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
