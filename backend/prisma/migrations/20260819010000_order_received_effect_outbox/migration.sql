CREATE TYPE "OrderReceivedEffectKind" AS ENUM (
  'BONUS_ALLOCATION',
  'DIGITAL_ASSET_CREDIT',
  'GROUP_BUY_EVALUATION',
  'GROWTH_REWARD',
  'CAPTAIN_COMMISSION_RELEASE',
  'COUPON_TRIGGERS'
);

CREATE TYPE "OrderReceivedEffectStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "OrderReceivedEffectOutbox" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "OrderReceivedEffectKind" NOT NULL,
  "source" VARCHAR(32) NOT NULL,
  "isFirstReceived" BOOLEAN NOT NULL DEFAULT false,
  "status" "OrderReceivedEffectStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingAt" TIMESTAMP(3),
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderReceivedEffectOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderReceivedEffectOutbox_orderId_kind_key"
  ON "OrderReceivedEffectOutbox"("orderId", "kind");
CREATE INDEX "OrderReceivedEffectOutbox_status_runAt_createdAt_idx"
  ON "OrderReceivedEffectOutbox"("status", "runAt", "createdAt");
CREATE INDEX "OrderReceivedEffectOutbox_status_leaseExpiresAt_idx"
  ON "OrderReceivedEffectOutbox"("status", "leaseExpiresAt");

ALTER TABLE "OrderReceivedEffectOutbox"
  ADD CONSTRAINT "OrderReceivedEffectOutbox_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CouponInstance" ADD COLUMN "triggerIdempotencyKey" TEXT;
CREATE UNIQUE INDEX "CouponInstance_triggerIdempotencyKey_key"
  ON "CouponInstance"("triggerIdempotencyKey");
