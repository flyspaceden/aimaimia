-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SIMPLE', 'BUNDLE');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "type" "ProductType" NOT NULL DEFAULT 'SIMPLE';

-- CreateTable
CREATE TABLE "ProductBundleItem" (
    "id" TEXT NOT NULL,
    "bundleProductId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBundleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductBundleItem_bundleProductId_skuId_key" ON "ProductBundleItem"("bundleProductId", "skuId");

-- CreateIndex
CREATE INDEX "ProductBundleItem_bundleProductId_idx" ON "ProductBundleItem"("bundleProductId");

-- CreateIndex
CREATE INDEX "ProductBundleItem_skuId_idx" ON "ProductBundleItem"("skuId");

-- ReplaceIndex
DROP INDEX IF EXISTS "InventoryLedger_after_sale_release_once_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLedger_after_sale_release_once_idx"
ON "InventoryLedger" ("refType", "refId", "skuId")
WHERE "type" = 'RELEASE'
  AND "refType" = 'AFTER_SALE'
  AND "refId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "ProductBundleItem" ADD CONSTRAINT "ProductBundleItem_bundleProductId_fkey" FOREIGN KEY ("bundleProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBundleItem" ADD CONSTRAINT "ProductBundleItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
