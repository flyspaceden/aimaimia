BEGIN;
-- Request-level idempotency for admin industry-fund payment writes.
-- Only the request fingerprint and a safe result identifier are stored;
-- payment payloads (including bank account data and proof keys) are excluded.
CREATE TABLE "industry_fund_payment_requests" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "operation" VARCHAR(40) NOT NULL,
    "targetId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "resultType" VARCHAR(32) NOT NULL,
    "resultId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_fund_payment_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "industry_fund_payment_requests_requestKey_key"
    ON "industry_fund_payment_requests"("requestKey");

CREATE INDEX "industry_fund_payment_requests_target_idx"
    ON "industry_fund_payment_requests"("operation", "targetId", "createdAt");

CREATE TRIGGER industry_fund_payment_request_immutable BEFORE UPDATE OR DELETE ON industry_fund_payment_requests
FOR EACH ROW EXECUTE FUNCTION industry_fund_immutable();

COMMIT;
