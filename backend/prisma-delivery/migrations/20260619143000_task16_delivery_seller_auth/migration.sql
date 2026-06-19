-- Extend delivery OTP purposes for seller bind/reset flows
ALTER TYPE "DeliveryOtpPurpose" ADD VALUE IF NOT EXISTS 'BIND';
ALTER TYPE "DeliveryOtpPurpose" ADD VALUE IF NOT EXISTS 'RESET';

-- Allow one phone to map to multiple delivery seller staff across merchants
DROP INDEX IF EXISTS "DeliverySellerStaff_phone_key";
CREATE INDEX IF NOT EXISTS "DeliverySellerStaff_phone_status_idx"
  ON "DeliverySellerStaff"("phone", "status");

-- Revocable delivery seller refresh sessions
CREATE TABLE "DeliverySellerSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySellerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliverySellerSession_refreshTokenHash_key"
  ON "DeliverySellerSession"("refreshTokenHash");

CREATE INDEX "DeliverySellerSession_staffId_expiresAt_idx"
  ON "DeliverySellerSession"("staffId", "expiresAt");

CREATE INDEX "DeliverySellerSession_staffId_revokedAt_idx"
  ON "DeliverySellerSession"("staffId", "revokedAt");

CREATE INDEX "DeliverySellerSession_expiresAt_idx"
  ON "DeliverySellerSession"("expiresAt");

ALTER TABLE "DeliverySellerSession"
  ADD CONSTRAINT "DeliverySellerSession_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "DeliverySellerStaff"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
