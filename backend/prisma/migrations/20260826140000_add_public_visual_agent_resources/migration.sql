-- Public, scoped AI Visual Agent resources. Not applied by local development.
-- An external system uploads only binary data plus a server-signed evidence
-- envelope; there is intentionally no arbitrary URL, prompt or Provider task.
CREATE TYPE "VisualAgentAssetStatus" AS ENUM ('AVAILABLE', 'RETIRED');
CREATE TYPE "VisualAgentCandidateStatus" AS ENUM ('PENDING_REVIEW', 'ADOPT_INTENT', 'REJECTED');

CREATE TABLE "VisualAgentAsset" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "adapterNamespace" TEXT NOT NULL,
  "externalObjectId" TEXT NOT NULL,
  "externalObjectVersion" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "billingOwnerType" TEXT NOT NULL,
  "billingOwnerId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "canonicalSha256" TEXT NOT NULL,
  "originalSha256" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "factPolicy" JSONB NOT NULL,
  "evidenceNonce" TEXT NOT NULL,
  "evidenceIssuedAt" TIMESTAMP(3) NOT NULL,
  "evidenceExpiresAt" TIMESTAMP(3) NOT NULL,
  "evidenceKeyId" TEXT NOT NULL,
  "status" "VisualAgentAssetStatus" NOT NULL DEFAULT 'AVAILABLE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualAgentAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisualAgentPlan" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "adapterNamespace" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "externalObjectId" TEXT NOT NULL,
  "externalObjectVersion" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "billingOwnerType" TEXT NOT NULL,
  "billingOwnerId" TEXT NOT NULL,
  "riskProfile" TEXT NOT NULL,
  "recommendedDirection" TEXT,
  "allowedDirections" TEXT[] NOT NULL,
  "allowedOperations" TEXT[] NOT NULL,
  "protectedRegionVersion" TEXT NOT NULL,
  "factPolicy" JSONB NOT NULL,
  "planHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualAgentPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisualAgentCandidate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "adapterNamespace" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "invocationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "sourceAssetId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "canonicalSha256" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "status" "VisualAgentCandidateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "adoptionAttestation" JSONB,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualAgentCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisualAgentAsset_objectKey_key" ON "VisualAgentAsset"("objectKey");
CREATE UNIQUE INDEX "VisualAgentAsset_tenantId_clientId_adapterNamespace_evidenceNonce_key" ON "VisualAgentAsset"("tenantId", "clientId", "adapterNamespace", "evidenceNonce");
CREATE INDEX "VisualAgentAsset_tenantId_clientId_adapterNamespace_externalObjectId_status_createdAt_idx" ON "VisualAgentAsset"("tenantId", "clientId", "adapterNamespace", "externalObjectId", "status", "createdAt");
CREATE INDEX "VisualAgentAsset_billingOwnerType_billingOwnerId_createdAt_idx" ON "VisualAgentAsset"("billingOwnerType", "billingOwnerId", "createdAt");
CREATE INDEX "VisualAgentAsset_evidenceExpiresAt_idx" ON "VisualAgentAsset"("evidenceExpiresAt");
CREATE INDEX "VisualAgentPlan_tenantId_clientId_adapterNamespace_externalObjectId_assetId_expiresAt_idx" ON "VisualAgentPlan"("tenantId", "clientId", "adapterNamespace", "externalObjectId", "assetId", "expiresAt");
CREATE INDEX "VisualAgentPlan_assetId_planHash_expiresAt_idx" ON "VisualAgentPlan"("assetId", "planHash", "expiresAt");
CREATE INDEX "VisualAgentPlan_expiresAt_idx" ON "VisualAgentPlan"("expiresAt");
CREATE UNIQUE INDEX "VisualAgentCandidate_quoteId_key" ON "VisualAgentCandidate"("quoteId");
CREATE UNIQUE INDEX "VisualAgentCandidate_invocationId_key" ON "VisualAgentCandidate"("invocationId");
CREATE UNIQUE INDEX "VisualAgentCandidate_objectKey_key" ON "VisualAgentCandidate"("objectKey");
CREATE INDEX "VisualAgentCandidate_tenantId_clientId_adapterNamespace_status_createdAt_idx" ON "VisualAgentCandidate"("tenantId", "clientId", "adapterNamespace", "status", "createdAt");
CREATE INDEX "VisualAgentCandidate_planId_createdAt_idx" ON "VisualAgentCandidate"("planId", "createdAt");

ALTER TABLE "VisualAgentAsset" ADD CONSTRAINT "VisualAgentAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "VisualAgentTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentAsset" ADD CONSTRAINT "VisualAgentAsset_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "VisualAgentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentPlan" ADD CONSTRAINT "VisualAgentPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "VisualAgentTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentPlan" ADD CONSTRAINT "VisualAgentPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "VisualAgentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentPlan" ADD CONSTRAINT "VisualAgentPlan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "VisualAgentAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentCandidate" ADD CONSTRAINT "VisualAgentCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "VisualAgentTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentCandidate" ADD CONSTRAINT "VisualAgentCandidate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "VisualAgentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentCandidate" ADD CONSTRAINT "VisualAgentCandidate_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "VisualCreditQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentCandidate" ADD CONSTRAINT "VisualAgentCandidate_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "VisualAgentInvocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentCandidate" ADD CONSTRAINT "VisualAgentCandidate_planId_fkey" FOREIGN KEY ("planId") REFERENCES "VisualAgentPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentCandidate" ADD CONSTRAINT "VisualAgentCandidate_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "VisualAgentAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
