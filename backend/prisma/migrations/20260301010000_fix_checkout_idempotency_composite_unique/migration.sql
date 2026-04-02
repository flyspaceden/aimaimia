-- Fix CheckoutSession idempotency scope: from global idempotencyKey unique
-- to per-user composite unique (userId, idempotencyKey).

-- Drop old global unique index if present.
DROP INDEX IF EXISTS "CheckoutSession_idempotencyKey_key";

-- Create new composite unique index (NULL idempotencyKey remains multi-row allowed).
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutSession_userId_idempotencyKey_key"
ON "CheckoutSession"("userId", "idempotencyKey");
