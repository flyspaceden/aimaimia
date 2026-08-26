-- Generic AI Visual Agent Core: no product/menu foreign keys by design.
-- These records are local-only until an explicit future migration/deployment.
CREATE TYPE "VisualAgentInvocationStatus" AS ENUM (
  'RESERVED',
  'SUBMITTING',
  'QUEUED',
  'RUNNING',
  'RECONCILING',
  'VERIFYING',
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
  'RELEASED',
  'BILLING_EXCEPTION',
  'CANCELLED'
);

CREATE TYPE "VisualAgentBudgetScope" AS ENUM (
  'PLATFORM',
  'PROVIDER',
  'TENANT',
  'CLIENT',
  'EXTERNAL_OBJECT',
  'ACTOR'
);

CREATE TABLE "VisualAgentInvocation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ownerClientId" TEXT NOT NULL,
  "adapterNamespace" TEXT NOT NULL,
  "externalObjectId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "visualMode" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "visualPlanHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "providerIdempotencyKey" TEXT NOT NULL,
  "status" "VisualAgentInvocationStatus" NOT NULL DEFAULT 'RESERVED',
  "reservedCostCents" INTEGER NOT NULL,
  "actualCostCents" INTEGER,
  "policySnapshotVersion" TEXT NOT NULL,
  "providerTaskId" TEXT,
  "providerRequestId" TEXT,
  "providerOutputUrl" TEXT,
  "reconciliationReason" TEXT,
  "leaseToken" TEXT,
  "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualAgentInvocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisualAgentInvocation_providerIdempotencyKey_key"
  ON "VisualAgentInvocation"("providerIdempotencyKey");
CREATE UNIQUE INDEX "VisualAgentInvocation_providerTaskId_key"
  ON "VisualAgentInvocation"("providerTaskId");
CREATE UNIQUE INDEX "VisualAgentInvocation_tenantId_ownerClientId_adapterNamespace_idempotencyKey_key"
  ON "VisualAgentInvocation"("tenantId", "ownerClientId", "adapterNamespace", "idempotencyKey");
CREATE INDEX "VisualAgentInvocation_tenantId_ownerClientId_adapterNamespace_externalObjectId_status_idx"
  ON "VisualAgentInvocation"("tenantId", "ownerClientId", "adapterNamespace", "externalObjectId", "status");
CREATE INDEX "VisualAgentInvocation_provider_model_status_createdAt_idx"
  ON "VisualAgentInvocation"("provider", "model", "status", "createdAt");
CREATE INDEX "VisualAgentInvocation_leaseExpiresAt_idx"
  ON "VisualAgentInvocation"("leaseExpiresAt");
ALTER TABLE "VisualAgentInvocation"
  ADD CONSTRAINT "VisualAgentInvocation_reservedCostCents_positive"
  CHECK ("reservedCostCents" > 0),
  ADD CONSTRAINT "VisualAgentInvocation_actualCostCents_nonnegative"
  CHECK ("actualCostCents" IS NULL OR "actualCostCents" >= 0);

CREATE TABLE "VisualAgentBudgetPolicy" (
  "id" TEXT NOT NULL,
  "scope" "VisualAgentBudgetScope" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "visualMode" TEXT NOT NULL,
  "reserveCents" INTEGER NOT NULL,
  "perTaskCapCents" INTEGER NOT NULL,
  "dailyCapCents" INTEGER NOT NULL,
  "weeklyCapCents" INTEGER NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "policyVersion" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualAgentBudgetPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisualAgentBudgetPolicy_scope_scopeKey_provider_model_visualMode_policyVersion_key"
  ON "VisualAgentBudgetPolicy"("scope", "scopeKey", "provider", "model", "visualMode", "policyVersion");
CREATE INDEX "VisualAgentBudgetPolicy_scope_scopeKey_provider_model_visualMode_enabled_effectiveFrom_idx"
  ON "VisualAgentBudgetPolicy"("scope", "scopeKey", "provider", "model", "visualMode", "enabled", "effectiveFrom");
ALTER TABLE "VisualAgentBudgetPolicy"
  ADD CONSTRAINT "VisualAgentBudgetPolicy_positive_caps"
  CHECK ("reserveCents" > 0 AND "perTaskCapCents" >= "reserveCents" AND "dailyCapCents" > 0 AND "weeklyCapCents" > 0);

CREATE TABLE "VisualAgentBudgetReservation" (
  "id" TEXT NOT NULL,
  "invocationId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "scope" "VisualAgentBudgetScope" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisualAgentBudgetReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisualAgentBudgetReservation_invocationId_scope_key"
  ON "VisualAgentBudgetReservation"("invocationId", "scope");
CREATE INDEX "VisualAgentBudgetReservation_policyId_createdAt_idx"
  ON "VisualAgentBudgetReservation"("policyId", "createdAt");
CREATE INDEX "VisualAgentBudgetReservation_scope_scopeKey_createdAt_idx"
  ON "VisualAgentBudgetReservation"("scope", "scopeKey", "createdAt");
ALTER TABLE "VisualAgentBudgetReservation"
  ADD CONSTRAINT "VisualAgentBudgetReservation_amountCents_positive"
  CHECK ("amountCents" > 0);

ALTER TABLE "VisualAgentBudgetReservation"
  ADD CONSTRAINT "VisualAgentBudgetReservation_invocationId_fkey"
  FOREIGN KEY ("invocationId") REFERENCES "VisualAgentInvocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentBudgetReservation"
  ADD CONSTRAINT "VisualAgentBudgetReservation_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "VisualAgentBudgetPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
