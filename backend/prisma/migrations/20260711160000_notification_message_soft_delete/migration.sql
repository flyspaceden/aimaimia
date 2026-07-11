-- Buyer-visible notification soft deletion. The message remains available for
-- platform audit/history while each recipient can remove it from their inbox.
ALTER TABLE "NotificationMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);

DROP INDEX "NotificationMessage_recipientKey_readAt_createdAt_idx";
CREATE INDEX "NotificationMessage_recipientKey_deletedAt_readAt_createdAt_idx"
  ON "NotificationMessage"("recipientKey", "deletedAt", "readAt", "createdAt");
