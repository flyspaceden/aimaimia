CREATE TYPE "NotificationRecipientKind" AS ENUM ('BUYER_USER', 'SELLER_STAFF', 'ADMIN_USER');

CREATE TYPE "NotificationAudience" AS ENUM ('BUYER_APP', 'SELLER_CENTER', 'ADMIN_CENTER');

CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL');

CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "recipientKind" "NotificationRecipientKind" NOT NULL,
    "recipientKey" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "category" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" JSONB,
    "metadata" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationOutbox_idempotencyKey_key" ON "NotificationOutbox"("idempotencyKey");

CREATE INDEX "NotificationOutbox_status_runAt_idx" ON "NotificationOutbox"("status", "runAt");

CREATE INDEX "NotificationOutbox_aggregateType_aggregateId_idx" ON "NotificationOutbox"("aggregateType", "aggregateId");

CREATE UNIQUE INDEX "NotificationMessage_recipientKey_idempotencyKey_key" ON "NotificationMessage"("recipientKey", "idempotencyKey");

CREATE INDEX "NotificationMessage_recipientKey_readAt_createdAt_idx" ON "NotificationMessage"("recipientKey", "readAt", "createdAt");

CREATE INDEX "NotificationMessage_audience_category_createdAt_idx" ON "NotificationMessage"("audience", "category", "createdAt");

CREATE INDEX "NotificationMessage_entityType_entityId_idx" ON "NotificationMessage"("entityType", "entityId");
