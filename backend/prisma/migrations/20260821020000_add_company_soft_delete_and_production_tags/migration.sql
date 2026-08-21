-- 企业安全删除：只增加软删除状态与恢复快照，不删除任何交易历史。
ALTER TYPE "CompanyStatus" ADD VALUE IF NOT EXISTS 'DELETED';

ALTER TABLE "Company"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedFromStatus" "CompanyStatus";

-- 生产环境最小企业标签目录。全部使用 code/name 冲突 upsert，可幂等部署。
INSERT INTO "TagCategory" ("id", "name", "code", "scope", "sortOrder", "updatedAt")
VALUES
  ('system_company_cert', '企业认证', 'company_cert', 'COMPANY', 1, NOW()),
  ('system_company_industry', '行业标签', 'industry', 'COMPANY', 3, NOW()),
  ('system_company_feature', '产品特色', 'product_feature', 'COMPANY', 4, NOW()),
  ('system_company_supply', '供应方式', 'supply_mode', 'COMPANY', 5, NOW()),
  ('system_company_service_area', '服务区域', 'service_area', 'COMPANY', 6, NOW()),
  ('system_product_tag', '商品标签', 'product_tag', 'PRODUCT', 7, NOW())
ON CONFLICT ("code") DO NOTHING;

WITH catalog("id", "name", "code", "sortOrder") AS (
  VALUES
    ('system_tag_cert_zhenpin', '圳品', 'company_cert', 0),
    ('system_tag_cert_export', '出口认证', 'company_cert', 1),
    ('system_tag_cert_green', '绿色食品', 'company_cert', 2),
    ('system_tag_cert_gi', '地理标志', 'company_cert', 3),
    ('system_tag_cert_gap', 'GAP认证', 'company_cert', 4),
    ('system_tag_cert_sc', 'SC认证', 'company_cert', 5),
    ('system_tag_cert_iso22000', 'ISO22000', 'company_cert', 6),
    ('system_tag_cert_haccp', 'HACCP', 'company_cert', 7),
    ('system_tag_cert_preferred', '优选基地', 'company_cert', 8),
    ('system_tag_cert_quality', '品质认证', 'company_cert', 9),
    ('system_tag_cert_origin', '产地直供', 'company_cert', 10),
    ('system_tag_cert_low_carbon', '低碳种植', 'company_cert', 11),
    ('system_tag_cert_cold_chain', '冷链保障', 'company_cert', 12),
    ('system_tag_cert_factory', '源头工厂', 'company_cert', 13),
    ('system_tag_industry_fruit', '水果', 'industry', 0),
    ('system_tag_industry_vegetable', '蔬菜', 'industry', 1),
    ('system_tag_industry_grain', '粮油', 'industry', 2),
    ('system_tag_industry_meat', '肉禽', 'industry', 3),
    ('system_tag_industry_seafood', '水产', 'industry', 4),
    ('system_tag_industry_tea', '茶叶', 'industry', 5),
    ('system_tag_industry_honey', '蜂蜜', 'industry', 6),
    ('system_tag_industry_dairy', '乳制品', 'industry', 7),
    ('system_tag_industry_dry_goods', '干货', 'industry', 8),
    ('system_tag_industry_condiment', '调味品', 'industry', 9),
    ('system_tag_feature_traceable', '可溯源', 'product_feature', 0),
    ('system_tag_feature_cold_chain', '冷链', 'product_feature', 1),
    ('system_tag_feature_additive_free', '无添加', 'product_feature', 2),
    ('system_tag_feature_non_gmo', '非转基因', 'product_feature', 3),
    ('system_tag_feature_handmade', '手工制作', 'product_feature', 4),
    ('system_tag_feature_seasonal', '当季采摘', 'product_feature', 5),
    ('system_tag_supply_wholesale', '批发', 'supply_mode', 0),
    ('system_tag_supply_retail', '零售', 'supply_mode', 1),
    ('system_tag_supply_direct', '直供', 'supply_mode', 2),
    ('system_tag_supply_local_delivery', '同城配送', 'supply_mode', 3),
    ('system_tag_supply_visit', '可预约考察', 'supply_mode', 4),
    ('system_tag_supply_dropship', '一件代发', 'supply_mode', 5),
    ('system_tag_area_local', '本地', 'service_area', 0),
    ('system_tag_area_province', '全省', 'service_area', 1),
    ('system_tag_area_nationwide', '全国', 'service_area', 2),
    ('system_tag_area_east', '华东', 'service_area', 3),
    ('system_tag_area_south', '华南', 'service_area', 4),
    ('system_tag_area_north', '华北', 'service_area', 5),
    ('system_tag_area_central', '华中', 'service_area', 6),
    ('system_tag_area_southwest', '西南', 'service_area', 7),
    ('system_tag_area_northwest', '西北', 'service_area', 8),
    ('system_tag_area_northeast', '东北', 'service_area', 9),
    ('system_tag_product_traceable', '可信溯源', 'product_tag', 0),
    ('system_tag_product_inspection', '检测报告', 'product_tag', 1),
    ('system_tag_product_zhenpin', '圳品认证', 'product_tag', 2),
    ('system_tag_product_gi', '地理标志', 'product_tag', 3),
    ('system_tag_product_seasonal', '当季鲜采', 'product_tag', 4),
    ('system_tag_product_cold_chain', '冷链直达', 'product_tag', 5),
    ('system_tag_product_non_gmo', '非转基因', 'product_tag', 6)
)
INSERT INTO "Tag" ("id", "name", "categoryId", "sortOrder", "isActive")
SELECT catalog."id", catalog."name", category."id", catalog."sortOrder", true
FROM catalog
JOIN "TagCategory" category ON category."code" = catalog."code"
ON CONFLICT ("name", "categoryId") DO NOTHING;

-- 只清理从旧 TagType 迁移而来、且从未使用的空占位类别。
DELETE FROM "TagCategory" category
WHERE category."code" IN ('COMPANY', 'PRODUCT', 'TRACE', 'AI')
  AND NOT EXISTS (
    SELECT 1 FROM "Tag" tag WHERE tag."categoryId" = category."id"
  );

-- 权限数据：企业删除仅授予超级管理员；标签管理授予超管和经理。
INSERT INTO "AdminPermission" ("id", "code", "module", "action", "description")
VALUES
  ('perm_companies_delete', 'companies:delete', 'companies', 'delete', '删除与恢复企业'),
  ('perm_tags_read', 'tags:read', 'tags', 'read', '查看标签管理'),
  ('perm_tags_manage', 'tags:manage', 'tags', 'manage', '管理标签类别与标签')
ON CONFLICT ("code") DO UPDATE SET
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "description" = EXCLUDED."description";

INSERT INTO "AdminRolePermission" ("id", "roleId", "permissionId")
SELECT
  'rp_super_' || permission."id",
  role."id",
  permission."id"
FROM "AdminRole" role
JOIN "AdminPermission" permission
  ON permission."code" IN ('companies:delete', 'tags:read', 'tags:manage')
WHERE role."name" = '超级管理员'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "AdminRolePermission" ("id", "roleId", "permissionId")
SELECT
  'rp_manager_' || permission."id",
  role."id",
  permission."id"
FROM "AdminRole" role
JOIN "AdminPermission" permission
  ON permission."code" IN ('tags:read', 'tags:manage')
WHERE role."name" = '经理'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
