-- CreateEnum
CREATE TYPE "CoverMode" AS ENUM ('AUTO_GRID', 'AUTO_DIAGONAL', 'AUTO_STACKED', 'CUSTOM');

-- CreateTable: VIP 赠品组合商品明细
CREATE TABLE "VipGiftItem" (
    "id" TEXT NOT NULL,
    "giftOptionId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VipGiftItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VipGiftItem_giftOptionId_skuId_key" ON "VipGiftItem"("giftOptionId", "skuId");

-- CreateIndex
CREATE INDEX "VipGiftItem_giftOptionId_idx" ON "VipGiftItem"("giftOptionId");

-- Migrate existing single-SKU data to VipGiftItem rows
INSERT INTO "VipGiftItem" ("id", "giftOptionId", "skuId", "quantity", "sortOrder", "createdAt")
SELECT
  gen_random_uuid()::text,
  "id",
  "skuId",
  1,
  0,
  NOW()
FROM "VipGiftOption"
WHERE "skuId" IS NOT NULL;

-- AlterTable: VipGiftOption — add coverMode column
ALTER TABLE "VipGiftOption" ADD COLUMN "coverMode" "CoverMode" NOT NULL DEFAULT 'AUTO_GRID';

-- AlterTable: VipGiftOption — drop old single-SKU columns and FK
ALTER TABLE "VipGiftOption" DROP CONSTRAINT "VipGiftOption_skuId_fkey";
ALTER TABLE "VipGiftOption" DROP COLUMN "skuId";
ALTER TABLE "VipGiftOption" DROP COLUMN "marketPrice";

-- AddForeignKey: VipGiftItem → VipGiftOption (cascade delete)
ALTER TABLE "VipGiftItem" ADD CONSTRAINT "VipGiftItem_giftOptionId_fkey" FOREIGN KEY ("giftOptionId") REFERENCES "VipGiftOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: VipGiftItem → ProductSKU (restrict delete)
ALTER TABLE "VipGiftItem" ADD CONSTRAINT "VipGiftItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
