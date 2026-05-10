-- 旧固定费 → 公式首重价（保持当前买家体验）
UPDATE "ShippingRule"
SET "firstFee" = COALESCE("fee", 0),
    "additionalFee" = 0
WHERE "firstFee" IS NULL;

-- 新计价引擎只按地区 + priority 匹配，不再解释旧 min/max 区间。
-- 将历史金额/重量区间规则停用，避免旧 range 规则升级后变成无条件公式规则。
UPDATE "ShippingRule"
SET "isActive" = false
WHERE "minAmount" IS NOT NULL
   OR "maxAmount" IS NOT NULL
   OR "minWeight" IS NOT NULL
   OR "maxWeight" IS NOT NULL;

-- 历史 SKU 无重量 → 默认 1000g
UPDATE "ProductSKU" SET "weightGram" = 1000 WHERE "weightGram" IS NULL;
