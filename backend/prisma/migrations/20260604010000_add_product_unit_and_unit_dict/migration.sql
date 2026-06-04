-- 商品计量单位：Product 增加 unit 列 + 单位字典表 ProductUnit
-- Product.unit 默认"斤"：存量商品保持原显示（不回归），后续可逐个改
ALTER TABLE "Product" ADD COLUMN "unit" TEXT NOT NULL DEFAULT '斤';

-- CreateTable：单位字典（管理后台维护，卖家/管理端下拉选项来源）
CREATE TABLE "ProductUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnit_name_key" ON "ProductUnit"("name");

-- 预置常用单位（幂等：名称冲突则跳过，方便后续重跑/多环境一致）
INSERT INTO "ProductUnit" ("id", "name", "sortOrder", "isActive", "createdAt", "updatedAt") VALUES
    ('punit_jin',   '斤',   10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_kg',    '千克', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_zhi',   '只',   30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_ge',    '个',   40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_jian',  '件',   50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_he',    '盒',   60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_dai',   '袋',   70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_fen',   '份',   80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_xiang', '箱',   90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_ping',  '瓶',  100, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_ba',    '把',  110, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('punit_shu',   '束',  120, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
