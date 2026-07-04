CREATE TABLE "NormalShareDeferredLink" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "ipAddress" TEXT NOT NULL,
  "userAgent" TEXT NOT NULL,
  "screenInfo" TEXT NOT NULL,
  "language" TEXT,
  "cookieId" TEXT NOT NULL,
  "matched" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NormalShareDeferredLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NormalShareDeferredLink_cookieId_key" ON "NormalShareDeferredLink"("cookieId");
CREATE INDEX "NormalShareDeferredLink_code_createdAt_idx" ON "NormalShareDeferredLink"("code", "createdAt");
CREATE INDEX "NormalShareDeferredLink_fingerprint_matched_expiresAt_idx" ON "NormalShareDeferredLink"("fingerprint", "matched", "expiresAt");
CREATE INDEX "NormalShareDeferredLink_expiresAt_idx" ON "NormalShareDeferredLink"("expiresAt");
