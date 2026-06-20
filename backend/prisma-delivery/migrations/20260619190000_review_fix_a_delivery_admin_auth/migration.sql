-- Revocable delivery admin refresh sessions, isolated in the delivery database.
CREATE TABLE "DeliveryAdminSession" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAdminSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryAdminSession_refreshTokenHash_key"
  ON "DeliveryAdminSession"("refreshTokenHash");

CREATE INDEX "DeliveryAdminSession_adminUserId_expiresAt_idx"
  ON "DeliveryAdminSession"("adminUserId", "expiresAt");

CREATE INDEX "DeliveryAdminSession_adminUserId_revokedAt_idx"
  ON "DeliveryAdminSession"("adminUserId", "revokedAt");

CREATE INDEX "DeliveryAdminSession_expiresAt_idx"
  ON "DeliveryAdminSession"("expiresAt");

ALTER TABLE "DeliveryAdminSession"
  ADD CONSTRAINT "DeliveryAdminSession_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "DeliveryAdminUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
