-- 顺丰风格平台统一运费计价
--
-- 迁移顺序说明：
-- 1. 新增公式字段时 firstFee/additionalFee 先允许 NULL；
-- 2. 使用旧固定运费 fee 回填首重价，续重价置 0，保持当前买家体验；
-- 3. 回填历史 SKU 重量后再把 ProductSKU.weightGram 改为必填；
-- 4. 最后再收紧 firstFee/additionalFee 为 NOT NULL，且不设置数据库默认值。

-- AlterTable: ShippingRule formula fields
ALTER TABLE "ShippingRule"
  ADD COLUMN "firstWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 3,
  ADD COLUMN "firstFee" DOUBLE PRECISION,
  ADD COLUMN "additionalWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "additionalFee" DOUBLE PRECISION,
  ADD COLUMN "minChargeWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- 旧固定费 → 公式首重价（保持当前买家体验）
UPDATE "ShippingRule"
SET "firstFee" = COALESCE("fee", 0),
    "additionalFee" = 0
WHERE "firstFee" IS NULL;

-- 新计价引擎只按地区 + priority 匹配，不再解释旧 min/max 区间。
-- 将历史金额/重量区间规则停用，避免“满额包邮”“重量超额”等旧规则升级后变成无条件公式规则。
UPDATE "ShippingRule"
SET "isActive" = false
WHERE "minAmount" IS NOT NULL
   OR "maxAmount" IS NOT NULL
   OR "minWeight" IS NOT NULL
   OR "maxWeight" IS NOT NULL;

-- 历史 SKU 无重量 → 默认 1000g
UPDATE "ProductSKU" SET "weightGram" = 1000 WHERE "weightGram" IS NULL;

-- AlterTable: enforce required runtime fields after backfill
ALTER TABLE "ShippingRule"
  ALTER COLUMN "firstFee" SET NOT NULL,
  ALTER COLUMN "additionalFee" SET NOT NULL,
  ALTER COLUMN "fee" SET DEFAULT 0;

ALTER TABLE "ProductSKU"
  ALTER COLUMN "weightGram" SET NOT NULL;

-- CreateTable
CREATE TABLE "order_shipping_costs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "packageIndex" INTEGER NOT NULL,
    "companyId" TEXT,
    "sfOrderId" TEXT NOT NULL,
    "weightGramSent" INTEGER NOT NULL,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_shipping_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_shipping_costs_sfOrderId_key" ON "order_shipping_costs"("sfOrderId");

-- CreateIndex
CREATE INDEX "order_shipping_costs_orderId_idx" ON "order_shipping_costs"("orderId");

-- CreateIndex
CREATE INDEX "order_shipping_costs_companyId_createdAt_idx" ON "order_shipping_costs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "order_shipping_costs_reconciledAt_idx" ON "order_shipping_costs"("reconciledAt");

-- CreateIndex
CREATE INDEX "ShippingRule_isActive_priority_idx" ON "ShippingRule"("isActive", "priority");

-- AddForeignKey
ALTER TABLE "order_shipping_costs" ADD CONSTRAINT "order_shipping_costs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
