-- Buyer-side customer service conversation unread cursor.
ALTER TABLE "CsSession" ADD COLUMN "buyerLastReadAt" TIMESTAMP(3);

CREATE INDEX "CsSession_userId_buyerLastReadAt_idx" ON "CsSession"("userId", "buyerLastReadAt");
