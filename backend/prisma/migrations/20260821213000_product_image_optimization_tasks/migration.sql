-- Truth-Locked product image Phase B: auditable tasks, private artifacts and explicit source lineage.
CREATE TYPE "ProductImageOptimizationKind" AS ENUM ('WHITE_BACKGROUND', 'BACKGROUND_GENERATION');
CREATE TYPE "ProductImageOptimizationStatus" AS ENUM ('REQUESTED', 'QUEUED', 'RUNNING', 'RECONCILING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'ADOPTED');
CREATE TYPE "ProductImageOptimizationCostTier" AS ENUM ('FREE', 'PAID');
CREATE TYPE "ProductImageArtifactKind" AS ENUM ('MASK', 'FOREGROUND_REFERENCE', 'CANDIDATE', 'INTEGRITY_PROOF');
CREATE TYPE "ProductImageAssetLineageRole" AS ENUM ('PRIMARY_SOURCE', 'ADDITIONAL_SOURCE', 'FOREGROUND_REFERENCE');
CREATE TYPE "ProductMediaVisualOrigin" AS ENUM ('ORIGINAL', 'DETERMINISTIC_COMPOSITE', 'AI_BACKGROUND');

ALTER TABLE "ProductMedia"
  ADD COLUMN "visualOrigin" "ProductMediaVisualOrigin" NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN "optimizationId" TEXT,
  ADD COLUMN "isEvidenceImage" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ProductImageOptimization" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT,
  "kind" "ProductImageOptimizationKind" NOT NULL,
  "status" "ProductImageOptimizationStatus" NOT NULL DEFAULT 'REQUESTED',
  "processingContract" JSONB NOT NULL,
  "contractHash" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "templateVersion" TEXT NOT NULL,
  "provider" TEXT,
  "modelVersion" TEXT,
  "costTier" "ProductImageOptimizationCostTier" NOT NULL DEFAULT 'FREE',
  "reservedCostCents" INTEGER NOT NULL DEFAULT 0,
  "actualCostCents" INTEGER,
  "requestedByStaffId" TEXT NOT NULL,
  "adoptedByStaffId" TEXT,
  "adoptedAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT,
  "failureDetail" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductImageOptimization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductImageArtifact" (
  "id" TEXT NOT NULL,
  "optimizationId" TEXT NOT NULL,
  "kind" "ProductImageArtifactKind" NOT NULL,
  "assetId" TEXT,
  "objectKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "isAigc" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductImageArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductImageAssetLineage" (
  "id" TEXT NOT NULL,
  "optimizationId" TEXT NOT NULL,
  "sourceAssetId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "role" "ProductImageAssetLineageRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductImageAssetLineage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductImageOptimization_companyId_idempotencyKey_key" ON "ProductImageOptimization"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "ProductImageOptimization_one_active_dedupe_key_idx"
  ON "ProductImageOptimization"("companyId", "dedupeKey")
  WHERE "status" IN ('REQUESTED', 'QUEUED', 'RUNNING', 'RECONCILING');
CREATE INDEX "ProductImageOptimization_companyId_status_createdAt_idx" ON "ProductImageOptimization"("companyId", "status", "createdAt");
CREATE INDEX "ProductImageOptimization_productId_createdAt_idx" ON "ProductImageOptimization"("productId", "createdAt");
CREATE INDEX "ProductImageOptimization_requestedByStaffId_createdAt_idx" ON "ProductImageOptimization"("requestedByStaffId", "createdAt");
CREATE INDEX "ProductImageOptimization_leaseExpiresAt_idx" ON "ProductImageOptimization"("leaseExpiresAt");
CREATE INDEX "ProductImageOptimization_expiresAt_idx" ON "ProductImageOptimization"("expiresAt");
CREATE INDEX "ProductImageArtifact_objectKey_idx" ON "ProductImageArtifact"("objectKey");
CREATE INDEX "ProductImageArtifact_optimizationId_kind_createdAt_idx" ON "ProductImageArtifact"("optimizationId", "kind", "createdAt");
CREATE INDEX "ProductImageArtifact_assetId_idx" ON "ProductImageArtifact"("assetId");
CREATE UNIQUE INDEX "PIAssetLineage_task_source_artifact_role_key" ON "ProductImageAssetLineage"("optimizationId", "sourceAssetId", "artifactId", "role");
CREATE INDEX "ProductImageAssetLineage_sourceAssetId_createdAt_idx" ON "ProductImageAssetLineage"("sourceAssetId", "createdAt");
CREATE INDEX "ProductImageAssetLineage_artifactId_idx" ON "ProductImageAssetLineage"("artifactId");
CREATE INDEX "ProductMedia_optimizationId_idx" ON "ProductMedia"("optimizationId");

ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_optimizationId_fkey" FOREIGN KEY ("optimizationId") REFERENCES "ProductImageOptimization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImageOptimization" ADD CONSTRAINT "ProductImageOptimization_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImageOptimization" ADD CONSTRAINT "ProductImageOptimization_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductImageOptimization" ADD CONSTRAINT "ProductImageOptimization_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "CompanyStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImageOptimization" ADD CONSTRAINT "ProductImageOptimization_adoptedByStaffId_fkey" FOREIGN KEY ("adoptedByStaffId") REFERENCES "CompanyStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImageArtifact" ADD CONSTRAINT "ProductImageArtifact_optimizationId_fkey" FOREIGN KEY ("optimizationId") REFERENCES "ProductImageOptimization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductImageArtifact" ADD CONSTRAINT "ProductImageArtifact_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "SellerMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImageAssetLineage" ADD CONSTRAINT "ProductImageAssetLineage_optimizationId_fkey" FOREIGN KEY ("optimizationId") REFERENCES "ProductImageOptimization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductImageAssetLineage" ADD CONSTRAINT "ProductImageAssetLineage_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "SellerMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductImageAssetLineage" ADD CONSTRAINT "ProductImageAssetLineage_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "ProductImageArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductImageOptimization" ADD CONSTRAINT "ProductImageOptimization_cost_nonnegative_check"
  CHECK ("reservedCostCents" >= 0 AND ("actualCostCents" IS NULL OR "actualCostCents" >= 0));
