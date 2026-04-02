-- CreateEnum
CREATE TYPE "CheckoutBizType" AS ENUM ('NORMAL_GOODS', 'VIP_PACKAGE');

-- CreateEnum
CREATE TYPE "OrderBizType" AS ENUM ('NORMAL_GOODS', 'VIP_PACKAGE');

-- CreateEnum
CREATE TYPE "VipGiftOptionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VipActivationStatus" AS ENUM ('PENDING', 'ACTIVATING', 'SUCCESS', 'FAILED', 'RETRYING');

-- AlterTable: CheckoutSession 新增业务类型和元数据
ALTER TABLE "CheckoutSession" ADD COLUMN "bizType" "CheckoutBizType" NOT NULL DEFAULT 'NORMAL_GOODS',
ADD COLUMN "bizMeta" JSONB;

-- AlterTable: Order 新增业务类型和元数据
ALTER TABLE "Order" ADD COLUMN "bizType" "OrderBizType" NOT NULL DEFAULT 'NORMAL_GOODS',
ADD COLUMN "bizMeta" JSONB;

-- AlterTable: VipPurchase 新增赠品快照和激活状态字段
ALTER TABLE "VipPurchase" ADD COLUMN "giftOptionId" TEXT,
ADD COLUMN "giftSkuId" TEXT,
ADD COLUMN "giftSnapshot" JSONB,
ADD COLUMN "source" TEXT,
ADD COLUMN "activationStatus" "VipActivationStatus" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN "activationError" TEXT;

-- CreateIndex: VipPurchase userId 唯一约束（每个用户仅允许一条购买记录）
CREATE UNIQUE INDEX "VipPurchase_userId_key" ON "VipPurchase"("userId");

-- CreateTable: VIP 赠品方案
CREATE TABLE "VipGiftOption" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "coverUrl" TEXT,
    "skuId" TEXT NOT NULL,
    "marketPrice" DOUBLE PRECISION,
    "badge" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "VipGiftOptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VipGiftOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: VipGiftOption 状态+排序索引
CREATE INDEX "VipGiftOption_status_sortOrder_idx" ON "VipGiftOption"("status", "sortOrder");

-- AddForeignKey: VipGiftOption → ProductSKU
ALTER TABLE "VipGiftOption" ADD CONSTRAINT "VipGiftOption_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
