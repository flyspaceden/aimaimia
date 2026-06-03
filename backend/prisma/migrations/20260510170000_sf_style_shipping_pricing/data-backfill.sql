-- 手工运维参考脚本：Prisma migrate deploy 只执行 migration.sql，不会自动执行本文件。
-- 若生产需要补跑历史数据，请先在 staging 验证并按实际数据裁剪后手工执行。

-- 旧固定费 → 公式首重价（保持当前买家体验）
UPDATE "ShippingRule"
SET "firstFee" = COALESCE("fee", 0),
    "additionalFee" = 0
WHERE "firstFee" IS NULL;

-- 保留并转换旧种子里的公式运费规则，使迁移后 DB 与 fresh seed 一样拥有 active 公式规则。
-- 全国默认旧版本带 maxAmount=99；这里先清空旧区间语义，再执行后续 broad deactivation。
UPDATE "ShippingRule"
SET "minAmount" = NULL,
    "maxAmount" = NULL,
    "minWeight" = NULL,
    "maxWeight" = NULL,
    "isActive" = true,
    "firstWeightKg" = 3,
    "firstFee" = COALESCE("firstFee", "fee", CASE
        WHEN "id" = 'sr-003' OR "name" = '偏远地区公式（新疆）' THEN 15
        WHEN "id" = 'sr-004' OR "name" = '偏远地区公式（西藏）' THEN 20
        ELSE 8
    END),
    "additionalWeightKg" = 1,
    "additionalFee" = CASE
        WHEN "additionalFee" IS NOT NULL AND "additionalFee" <> 0 THEN "additionalFee"
        WHEN "id" = 'sr-003' OR "name" = '偏远地区公式（新疆）' THEN 5.1
        WHEN "id" = 'sr-004' OR "name" = '偏远地区公式（西藏）' THEN 7.1
        WHEN "additionalFee" IS NULL OR "additionalFee" = 0 THEN 1.3
        ELSE "additionalFee"
    END,
    "minChargeWeightKg" = 1
WHERE "id" IN ('sr-002', 'sr-003', 'sr-004')
   OR "name" IN ('全国标准运费', '偏远地区公式（新疆）', '偏远地区公式（西藏）');

-- 新计价引擎只按地区 + priority 匹配，不再解释旧 min/max 区间。
-- 全国默认规则已在上方转换；其余历史金额/重量区间规则停用，避免旧 range 规则升级后变成无条件公式规则。
UPDATE "ShippingRule"
SET "isActive" = false
WHERE "minAmount" IS NOT NULL
   OR "maxAmount" IS NOT NULL
   OR "minWeight" IS NOT NULL
   OR "maxWeight" IS NOT NULL;

-- 其他 active 且无旧区间的规则不能保留 0 元续重；平台可后续在后台改成自定义价。
UPDATE "ShippingRule"
SET "additionalFee" = 1.3
WHERE "isActive" = true
  AND "minAmount" IS NULL
  AND "maxAmount" IS NULL
  AND "minWeight" IS NULL
  AND "maxWeight" IS NULL
  AND ("additionalFee" IS NULL OR "additionalFee" = 0);

-- 历史 SKU 无重量 → 默认 1000g
UPDATE "ProductSKU"
SET "weightGram" = 1000
WHERE "weightGram" IS NULL OR "weightGram" <= 0;
