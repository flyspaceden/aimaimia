-- 历史数据可能同时存在“多个默认”和“一个默认也没有”。
-- 每个用户优先保留最近更新的旧默认项；若无旧默认，
-- 则选最近更新的活跃地址，然后建立 at-most-one 数据库防线。
WITH ranked_active AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY "isDefault" DESC, "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "Address"
  WHERE "deletedAt" IS NULL
)
UPDATE "Address" AS address
SET "isDefault" = (ranked_active.rn = 1)
FROM ranked_active
WHERE address."id" = ranked_active."id";

CREATE UNIQUE INDEX "Address_one_active_default_per_user"
ON "Address" ("userId")
WHERE "isDefault" = true AND "deletedAt" IS NULL;
