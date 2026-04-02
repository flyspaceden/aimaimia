-- Coupon trigger event log（幂等）
CREATE TABLE IF NOT EXISTS "CouponTriggerEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "triggerType" "CouponTriggerType" NOT NULL,
  "eventKey" TEXT NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CouponTriggerEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CouponTriggerEvent_userId_triggerType_eventKey_key"
  ON "CouponTriggerEvent"("userId", "triggerType", "eventKey");

CREATE INDEX IF NOT EXISTS "CouponTriggerEvent_triggerType_createdAt_idx"
  ON "CouponTriggerEvent"("triggerType", "createdAt");

CREATE INDEX IF NOT EXISTS "CouponTriggerEvent_userId_triggerType_createdAt_idx"
  ON "CouponTriggerEvent"("userId", "triggerType", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CouponTriggerEvent_userId_fkey'
  ) THEN
    ALTER TABLE "CouponTriggerEvent"
      ADD CONSTRAINT "CouponTriggerEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
