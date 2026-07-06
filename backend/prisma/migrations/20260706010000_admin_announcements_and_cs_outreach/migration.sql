-- AddEnumValue
ALTER TYPE "CsSessionSource" ADD VALUE IF NOT EXISTS 'ADMIN_OUTREACH';

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'system',
    "type" TEXT NOT NULL DEFAULT 'platform_announcement',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "target" JSONB,
    "audienceType" TEXT NOT NULL,
    "audienceFilter" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_status_sentAt_idx" ON "Announcement"("status", "sentAt");

-- CreateIndex
CREATE INDEX "Announcement_createdBy_sentAt_idx" ON "Announcement"("createdBy", "sentAt");
