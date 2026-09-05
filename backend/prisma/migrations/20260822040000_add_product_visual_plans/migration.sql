-- Free, immutable visual recommendations. Creating a plan never invokes a
-- provider or reserves budget; execution will validate it again.
CREATE TYPE "ProductVisualMode" AS ENUM (
  'PRESERVE_REAL_SCENE',
  'CATALOG_STUDIO',
  'PRODUCT_RETOUCH',
  'MARKETING_SCENE'
);

CREATE TYPE "ProductVisualRiskProfile" AS ENUM (
  'STRICT_FACTS',
  'CONSERVATIVE_FACTS',
  'STANDARD_FACTS',
  'ORGANIC_FACTS',
  'MARKETING_ONLY',
  'RETAKE_REQUIRED'
);

CREATE TABLE "ProductVisualPlan" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT,
  "sourceAssetId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "requestedByStaffId" TEXT NOT NULL,
  "riskProfile" "ProductVisualRiskProfile" NOT NULL,
  "recommendedMode" "ProductVisualMode",
  "allowedModes" "ProductVisualMode"[] NOT NULL,
  "allowedOperations" TEXT[] NOT NULL,
  "sceneAnalysis" JSONB NOT NULL,
  "processingPlan" JSONB NOT NULL,
  "planHash" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "modelPolicyVersion" TEXT NOT NULL,
  "protectedRegionVersion" TEXT NOT NULL DEFAULT 'NOT_CREATED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductVisualPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductVisualPlan_scope_hash_exp_idx"
  ON "ProductVisualPlan"("companyId", "productId", "sourceAssetId", "planHash", "expiresAt");
CREATE INDEX "ProductVisualPlan_companyId_productId_createdAt_idx"
  ON "ProductVisualPlan"("companyId", "productId", "createdAt");
CREATE INDEX "ProductVisualPlan_sourceAssetId_expiresAt_idx"
  ON "ProductVisualPlan"("sourceAssetId", "expiresAt");
CREATE INDEX "ProductVisualPlan_requestedByStaffId_createdAt_idx"
  ON "ProductVisualPlan"("requestedByStaffId", "createdAt");

ALTER TABLE "ProductVisualPlan"
  ADD CONSTRAINT "ProductVisualPlan_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductVisualPlan"
  ADD CONSTRAINT "ProductVisualPlan_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductVisualPlan"
  ADD CONSTRAINT "ProductVisualPlan_sourceAssetId_fkey"
  FOREIGN KEY ("sourceAssetId") REFERENCES "SellerMediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductVisualPlan"
  ADD CONSTRAINT "ProductVisualPlan_requestedByStaffId_fkey"
  FOREIGN KEY ("requestedByStaffId") REFERENCES "CompanyStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
