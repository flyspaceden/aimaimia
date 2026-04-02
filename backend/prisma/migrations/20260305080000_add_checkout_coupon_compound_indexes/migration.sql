-- Checkout / Coupon compensation query indexes（幂等）
CREATE INDEX IF NOT EXISTS "CheckoutSession_status_createdAt_idx"
  ON "CheckoutSession"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "CouponInstance_status_expiresAt_idx"
  ON "CouponInstance"("status", "expiresAt");
