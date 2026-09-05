-- Domain-neutral Visual Agent Client Key boundary. No tenant/client/key is
-- seeded by this migration; issuing a raw key is an explicit admin action.
CREATE TYPE "VisualAgentTenantStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "VisualAgentClientStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "VisualAgentClientKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "VisualAgentTenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "VisualAgentTenantStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualAgentTenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisualAgentClient" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "adapterNamespace" TEXT NOT NULL,
  "allowedAdapterTypes" TEXT[] NOT NULL,
  "status" "VisualAgentClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualAgentClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisualAgentClientKey" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "status" "VisualAgentClientKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "issuedByOperatorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisualAgentClientKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisualAgentClient_tenantId_adapterNamespace_key"
  ON "VisualAgentClient"("tenantId", "adapterNamespace");
CREATE INDEX "VisualAgentTenant_status_createdAt_idx"
  ON "VisualAgentTenant"("status", "createdAt");
CREATE INDEX "VisualAgentClient_tenantId_status_createdAt_idx"
  ON "VisualAgentClient"("tenantId", "status", "createdAt");
CREATE UNIQUE INDEX "VisualAgentClientKey_keyPrefix_key" ON "VisualAgentClientKey"("keyPrefix");
CREATE UNIQUE INDEX "VisualAgentClientKey_keyHash_key" ON "VisualAgentClientKey"("keyHash");
CREATE INDEX "VisualAgentClientKey_clientId_status_createdAt_idx"
  ON "VisualAgentClientKey"("clientId", "status", "createdAt");
CREATE INDEX "VisualAgentClientKey_expiresAt_idx" ON "VisualAgentClientKey"("expiresAt");

ALTER TABLE "VisualAgentClient"
  ADD CONSTRAINT "VisualAgentClient_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "VisualAgentTenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualAgentClientKey"
  ADD CONSTRAINT "VisualAgentClientKey_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "VisualAgentClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
