CREATE TABLE "WechatTransferNotifyInbox" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "outBillNo" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "deadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WechatTransferNotifyInbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatTransferNotifyInbox_eventId_key"
  ON "WechatTransferNotifyInbox"("eventId");
CREATE INDEX "WechatTransferNotifyInbox_status_updatedAt_idx"
  ON "WechatTransferNotifyInbox"("status", "updatedAt");
CREATE INDEX "WechatTransferNotifyInbox_status_nextAttemptAt_createdAt_idx"
  ON "WechatTransferNotifyInbox"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "WechatTransferNotifyInbox_outBillNo_idx"
  ON "WechatTransferNotifyInbox"("outBillNo");

ALTER TABLE "WithdrawRequest"
  ADD COLUMN "providerStateUpdatedAt" TIMESTAMP(3);
