-- Private, append-only-ish OCR fact evidence for managed product images.
CREATE TYPE "ProductImageFactScanStatus" AS ENUM (
  'SCANNING',
  'FACTS_DETECTED',
  'VERIFIED_EMPTY',
  'INCONCLUSIVE',
  'RECONCILING',
  'FAILED',
  'EXPIRED'
);

CREATE TABLE "ProductImageFactScan" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT,
  "sourceAssetId" TEXT NOT NULL,
  "sourceCanonicalHash" TEXT NOT NULL,
  "normalizedSourceHash" TEXT NOT NULL,
  "invocationId" TEXT NOT NULL,
  "status" "ProductImageFactScanStatus" NOT NULL DEFAULT 'SCANNING',
  "model" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "requestedByStaffId" TEXT NOT NULL,
  "ocrTextHash" TEXT,
  "ocrTextHashKeyVersion" TEXT,
  "ocrTextLength" INTEGER,
  "textDetected" BOOLEAN NOT NULL DEFAULT false,
  "qrCodesDetected" INTEGER NOT NULL DEFAULT 0,
  "barcodeStatus" TEXT NOT NULL DEFAULT 'NOT_IMPLEMENTED',
  "emptyTextQrVerified" BOOLEAN NOT NULL DEFAULT false,
  "resultSummary" JSONB,
  "failureCode" TEXT,
  "failureDetail" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductImageFactScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductImageFactScan_invocationId_key" ON "ProductImageFactScan"("invocationId");
CREATE UNIQUE INDEX "ProductImageFactScan_companyId_idempotencyKey_key" ON "ProductImageFactScan"("companyId", "idempotencyKey");
CREATE INDEX "PIFactScan_scope_status_created_idx"
  ON "ProductImageFactScan"("companyId", "productId", "sourceAssetId", "status", "createdAt");
CREATE INDEX "PIFactScan_source_hash_created_idx"
  ON "ProductImageFactScan"("sourceAssetId", "normalizedSourceHash", "createdAt");
CREATE INDEX "ProductImageFactScan_requestedByStaffId_createdAt_idx"
  ON "ProductImageFactScan"("requestedByStaffId", "createdAt");
CREATE INDEX "ProductImageFactScan_expiresAt_idx" ON "ProductImageFactScan"("expiresAt");
CREATE UNIQUE INDEX "ProductImageFactScan_active_source_key"
  ON "ProductImageFactScan"("companyId", "productId", "sourceAssetId", "sourceCanonicalHash")
  WHERE "status" IN ('SCANNING', 'FACTS_DETECTED', 'VERIFIED_EMPTY', 'INCONCLUSIVE', 'RECONCILING');
ALTER TABLE "ProductImageFactScan"
  ADD CONSTRAINT "ProductImageFactScan_qrCodesDetected_nonnegative" CHECK ("qrCodesDetected" >= 0),
  ADD CONSTRAINT "ProductImageFactScan_ocrTextLength_nonnegative" CHECK ("ocrTextLength" IS NULL OR "ocrTextLength" >= 0);
ALTER TABLE "ProductImageFactScan"
  ADD CONSTRAINT "ProductImageFactScan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductImageFactScan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductImageFactScan_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "SellerMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductImageFactScan_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "CompanyStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductImageFactScan_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "VisualAgentInvocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
