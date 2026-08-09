-- Persist the exact Mini Program payer identity selected during JSAPI preorder.
ALTER TABLE "CheckoutSession"
ADD COLUMN "miniProgramPayerOpenId" TEXT;

CREATE TYPE "WechatShippingOutboxStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "WechatShippingOutbox" (
  "id" TEXT NOT NULL,
  "checkoutSessionId" TEXT NOT NULL,
  "status" "WechatShippingOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "generation" INTEGER NOT NULL DEFAULT 1,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastError" TEXT,
  "succeededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WechatShippingOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatShippingOutbox_checkoutSessionId_key"
ON "WechatShippingOutbox"("checkoutSessionId");

CREATE INDEX "WechatShippingOutbox_status_nextAttemptAt_createdAt_idx"
ON "WechatShippingOutbox"("status", "nextAttemptAt", "createdAt");

CREATE INDEX "WechatShippingOutbox_status_leaseExpiresAt_idx"
ON "WechatShippingOutbox"("status", "leaseExpiresAt");

ALTER TABLE "WechatShippingOutbox"
ADD CONSTRAINT "WechatShippingOutbox_checkoutSessionId_fkey"
FOREIGN KEY ("checkoutSessionId") REFERENCES "CheckoutSession"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
