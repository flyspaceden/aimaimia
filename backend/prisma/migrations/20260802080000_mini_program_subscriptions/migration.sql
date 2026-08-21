CREATE TYPE "MiniProgramSubscriptionConsentStatus" AS ENUM ('ACCEPTED', 'REJECTED', 'BANNED', 'FILTERED');
CREATE TYPE "MiniProgramSubscriptionOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "MiniProgramSubscriptionConsent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "authIdentityId" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "status" "MiniProgramSubscriptionConsentStatus" NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "reservedOutboxId" TEXT,
  "reservedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiniProgramSubscriptionConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MiniProgramSubscriptionOutbox" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "consentId" TEXT,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "templateId" TEXT,
  "page" TEXT,
  "data" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "MiniProgramSubscriptionOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MiniProgramSubscriptionOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MiniProgramSubscriptionConsent_reservedOutboxId_key" ON "MiniProgramSubscriptionConsent"("reservedOutboxId");
CREATE UNIQUE INDEX "MiniProgramSubscriptionConsent_userId_clientRequestId_templateKey_key" ON "MiniProgramSubscriptionConsent"("userId", "clientRequestId", "templateKey");
CREATE INDEX "MiniProgramSubscriptionConsent_userId_templateKey_status_consumedAt_createdAt_idx" ON "MiniProgramSubscriptionConsent"("userId", "templateKey", "status", "consumedAt", "createdAt");
CREATE INDEX "MiniProgramSubscriptionConsent_authIdentityId_appId_idx" ON "MiniProgramSubscriptionConsent"("authIdentityId", "appId");

CREATE UNIQUE INDEX "MiniProgramSubscriptionOutbox_consentId_key" ON "MiniProgramSubscriptionOutbox"("consentId");
CREATE UNIQUE INDEX "MiniProgramSubscriptionOutbox_idempotencyKey_key" ON "MiniProgramSubscriptionOutbox"("idempotencyKey");
CREATE INDEX "MiniProgramSubscriptionOutbox_status_runAt_idx" ON "MiniProgramSubscriptionOutbox"("status", "runAt");
CREATE INDEX "MiniProgramSubscriptionOutbox_userId_templateKey_createdAt_idx" ON "MiniProgramSubscriptionOutbox"("userId", "templateKey", "createdAt");
CREATE INDEX "MiniProgramSubscriptionOutbox_aggregateType_aggregateId_idx" ON "MiniProgramSubscriptionOutbox"("aggregateType", "aggregateId");

ALTER TABLE "MiniProgramSubscriptionConsent" ADD CONSTRAINT "MiniProgramSubscriptionConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MiniProgramSubscriptionOutbox" ADD CONSTRAINT "MiniProgramSubscriptionOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
