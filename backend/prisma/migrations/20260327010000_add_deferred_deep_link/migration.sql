-- CreateTable
CREATE TABLE "DeferredDeepLink" (
    "id" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "screenInfo" TEXT,
    "language" TEXT,
    "cookieId" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeferredDeepLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeferredDeepLink_cookieId_key" ON "DeferredDeepLink"("cookieId");

-- CreateIndex
CREATE INDEX "DeferredDeepLink_fingerprint_matched_expiresAt_idx" ON "DeferredDeepLink"("fingerprint", "matched", "expiresAt");

-- CreateIndex
CREATE INDEX "DeferredDeepLink_ipAddress_matched_expiresAt_idx" ON "DeferredDeepLink"("ipAddress", "matched", "expiresAt");

-- CreateIndex
CREATE INDEX "DeferredDeepLink_expiresAt_idx" ON "DeferredDeepLink"("expiresAt");
