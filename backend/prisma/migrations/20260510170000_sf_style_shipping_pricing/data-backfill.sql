-- 旧固定费 → 公式首重价（保持当前买家体验）
UPDATE "ShippingRule"
SET "firstFee" = COALESCE("fee", 0),
    "additionalFee" = 0
WHERE "firstFee" IS NULL;

-- 保留并转换旧种子里的全国默认运费规则，使迁移后 DB 与 fresh seed 一样拥有 active 全国公式规则。
-- 该规则旧版本带 maxAmount=99；这里先清空旧区间语义，再执行后续 broad deactivation。
UPDATE "ShippingRule"
SET "minAmount" = NULL,
    "maxAmount" = NULL,
    "minWeight" = NULL,
    "maxWeight" = NULL,
    "isActive" = true,
    "firstWeightKg" = 3,
    "firstFee" = COALESCE("firstFee", "fee", 8),
    "additionalWeightKg" = 1,
    "additionalFee" = COALESCE("additionalFee", 0),
    "minChargeWeightKg" = 1
WHERE "id" = 'sr-002'
   OR "name" = '全国标准运费';

-- 新计价引擎只按地区 + priority 匹配，不再解释旧 min/max 区间。
-- 全国默认规则已在上方转换；其余历史金额/重量区间规则停用，避免旧 range 规则升级后变成无条件公式规则。
UPDATE "ShippingRule"
SET "isActive" = false
WHERE "minAmount" IS NOT NULL
   OR "maxAmount" IS NOT NULL
   OR "minWeight" IS NOT NULL
   OR "maxWeight" IS NOT NULL;

-- 历史 SKU 无重量 → 默认 1000g
UPDATE "ProductSKU" SET "weightGram" = 1000 WHERE "weightGram" IS NULL;
