-- 确保 active 顺丰风格运费规则不会保留 0 元续重。
-- 使用 follow-up migration，已执行 20260510170000 的环境也能通过 migrate deploy 修正。

-- 已知种子规则补齐明确续重价；若平台已手动配置非 0 续重价，则保留现值。
UPDATE "ShippingRule"
SET "minAmount" = NULL,
    "maxAmount" = NULL,
    "minWeight" = NULL,
    "maxWeight" = NULL,
    "additionalFee" = CASE
        WHEN "additionalFee" IS NOT NULL AND "additionalFee" <> 0 THEN "additionalFee"
        WHEN "id" = 'sr-003' OR "name" = '偏远地区公式（新疆）' THEN 5.1
        WHEN "id" = 'sr-004' OR "name" = '偏远地区公式（西藏）' THEN 7.1
        ELSE 1.3
    END
WHERE "isActive" = true
  AND (
    "id" IN ('sr-002', 'sr-003', 'sr-004')
    OR "name" IN ('全国标准运费', '偏远地区公式（新疆）', '偏远地区公式（西藏）')
  );

-- 其他 active 且无旧区间的规则先使用全国默认续重价，后台后续可再改为自定义价。
UPDATE "ShippingRule"
SET "additionalFee" = 1.3
WHERE "isActive" = true
  AND "minAmount" IS NULL
  AND "maxAmount" IS NULL
  AND "minWeight" IS NULL
  AND "maxWeight" IS NULL
  AND ("additionalFee" IS NULL OR "additionalFee" = 0);

-- SKU 重量参与买家计价和顺丰下单；历史脚本/旧数据中的 0 或负数统一回填默认 1000g，
-- 并用数据库约束防止绕过 DTO 的写入再次污染运费链路。
UPDATE "ProductSKU"
SET "weightGram" = 1000
WHERE "weightGram" IS NULL OR "weightGram" <= 0;

ALTER TABLE "ProductSKU"
  ADD CONSTRAINT "ProductSKU_weightGram_positive_check"
  CHECK ("weightGram" > 0)
  NOT VALID;

ALTER TABLE "ProductSKU"
  VALIDATE CONSTRAINT "ProductSKU_weightGram_positive_check";
