-- Candidate assets cannot be attached through ordinary media writes; only explicit adoption may publish them.
CREATE TYPE "SellerMediaAssetStatus" AS ENUM ('AVAILABLE', 'CANDIDATE', 'ADOPTED', 'RETIRED');

ALTER TABLE "SellerMediaAsset" ADD COLUMN "status" "SellerMediaAssetStatus" NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "ProductMediaRevision" ADD COLUMN "optimizationId" TEXT;

CREATE INDEX "SellerMediaAsset_companyId_status_createdAt_idx" ON "SellerMediaAsset"("companyId", "status", "createdAt");
CREATE INDEX "ProductMediaRevision_optimizationId_idx" ON "ProductMediaRevision"("optimizationId");

ALTER TABLE "ProductMediaRevision" ADD CONSTRAINT "ProductMediaRevision_optimizationId_fkey" FOREIGN KEY ("optimizationId") REFERENCES "ProductImageOptimization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
