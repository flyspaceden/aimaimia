-- Truth-Locked product image Phase A: managed assets and pending media revisions.
CREATE TYPE "SellerMediaAssetPurpose" AS ENUM ('PRODUCT_IMAGE');
CREATE TYPE "ProductMediaRevisionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

ALTER TABLE "Product" ADD COLUMN "mediaVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProductMedia" ADD COLUMN "assetId" TEXT;

CREATE TABLE "SellerMediaAsset" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "uploadedByStaffId" TEXT NOT NULL,
  "purpose" "SellerMediaAssetPurpose" NOT NULL,
  "objectKey" TEXT NOT NULL,
  "canonicalSha256" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "scanSummary" JSONB,
  "diagnosis" JSONB,
  "diagnosisVersion" TEXT,
  "diagnosedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SellerMediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductMediaRevision" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "expectedMediaVersion" INTEGER NOT NULL,
  "proposedMedia" JSONB NOT NULL,
  "status" "ProductMediaRevisionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "requestedByStaffId" TEXT NOT NULL,
  "attestation" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reviewedByAdminId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "appliedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductMediaRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerMediaAsset_objectKey_key" ON "SellerMediaAsset"("objectKey");
CREATE INDEX "SellerMediaAsset_companyId_createdAt_idx" ON "SellerMediaAsset"("companyId", "createdAt");
CREATE INDEX "SellerMediaAsset_companyId_canonicalSha256_idx" ON "SellerMediaAsset"("companyId", "canonicalSha256");
CREATE INDEX "SellerMediaAsset_uploadedByStaffId_createdAt_idx" ON "SellerMediaAsset"("uploadedByStaffId", "createdAt");
CREATE INDEX "ProductMedia_assetId_idx" ON "ProductMedia"("assetId");
CREATE UNIQUE INDEX "ProductMediaRevision_companyId_idempotencyKey_key" ON "ProductMediaRevision"("companyId", "idempotencyKey");
CREATE INDEX "ProductMediaRevision_productId_status_createdAt_idx" ON "ProductMediaRevision"("productId", "status", "createdAt");
CREATE INDEX "ProductMediaRevision_companyId_createdAt_idx" ON "ProductMediaRevision"("companyId", "createdAt");
CREATE INDEX "ProductMediaRevision_requestedByStaffId_createdAt_idx" ON "ProductMediaRevision"("requestedByStaffId", "createdAt");
CREATE INDEX "ProductMediaRevision_expiresAt_idx" ON "ProductMediaRevision"("expiresAt");
CREATE UNIQUE INDEX "ProductMediaRevision_one_pending_per_product_idx" ON "ProductMediaRevision"("productId") WHERE "status" = 'PENDING_REVIEW';

ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "SellerMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerMediaAsset" ADD CONSTRAINT "SellerMediaAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerMediaAsset" ADD CONSTRAINT "SellerMediaAsset_uploadedByStaffId_fkey" FOREIGN KEY ("uploadedByStaffId") REFERENCES "CompanyStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductMediaRevision" ADD CONSTRAINT "ProductMediaRevision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMediaRevision" ADD CONSTRAINT "ProductMediaRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductMediaRevision" ADD CONSTRAINT "ProductMediaRevision_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "CompanyStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
