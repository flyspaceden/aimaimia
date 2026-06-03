-- =============================================================================
-- 数据迁移：把所有存量 OSS http URL 改成 https
-- =============================================================================
-- 背景（详见 docs/issues/app-tpfix1.md Bug 2）
--   commit 7630142 已让 ali-oss 客户端 secure:true → 新上传走 https
--   但数据库里旧数据仍是 http://huahai-aimaimai.oss-cn-hangzhou.aliyuncs.com/...
--   Android RN/Expo APK 默认 usesCleartextTraffic=false → http 图片加载失败
--   → 必须把存量数据 http 改 https，老图才能在 App 显示
--
-- 涉及表（已 awk 验证 model 归属，schema.prisma 行号）：
--   UserProfile.avatarUrl              (629)
--   CompanyDocument.fileUrl            (954)
--   MerchantApplication.licenseFileUrl (978)
--   ProductMedia.url                   (1181)
--   Shipment.waybillUrl                (1570)
--   Invoice.pdfUrl                     (1640)
--   AiUtterance.audioUrl               (1668)
--   AfterSaleRequest.replacementWaybillUrl (2180)
--   VipGiftOption.coverUrl             (2341)
--   Order.giftSnapshot                 (1738, JSON 字段需 jsonb 操作)
--
-- 执行步骤：
--   1. 先在 staging 跑 STEP 1（dry-run COUNT）确认每张表受影响行数
--   2. 跑 STEP 2（事务里 UPDATE + COUNT 验证），异常自动 ROLLBACK
--   3. 跑 STEP 3（giftSnapshot JSON 字段 jsonb 迁移）
--   4. App 真机验证图片可加载
--   5. 生产环境同样三步
-- =============================================================================


-- =============================================================================
-- STEP 1: DRY-RUN — 确认受影响行数（不修改数据）
-- =============================================================================
-- 在 staging / 生产分别先跑这段，看每张表有多少行需要迁移
-- 如果某张表 COUNT=0，对应的 UPDATE 可以跳过

SELECT 'UserProfile.avatarUrl'              AS field, COUNT(*) AS http_rows FROM "UserProfile"         WHERE "avatarUrl"             LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'CompanyDocument.fileUrl',          COUNT(*) FROM "CompanyDocument"     WHERE "fileUrl"               LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'MerchantApplication.licenseFileUrl', COUNT(*) FROM "MerchantApplication" WHERE "licenseFileUrl"        LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'ProductMedia.url',                  COUNT(*) FROM "ProductMedia"        WHERE url                     LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'Shipment.waybillUrl',               COUNT(*) FROM "Shipment"            WHERE "waybillUrl"            LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'Invoice.pdfUrl',                    COUNT(*) FROM "Invoice"             WHERE "pdfUrl"                LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'AiUtterance.audioUrl',              COUNT(*) FROM "AiUtterance"         WHERE "audioUrl"              LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'AfterSaleRequest.replacementWaybillUrl', COUNT(*) FROM "AfterSaleRequest" WHERE "replacementWaybillUrl" LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'VipGiftOption.coverUrl',            COUNT(*) FROM "VipGiftOption"       WHERE "coverUrl"              LIKE 'http://huahai-aimaimai%'
UNION ALL SELECT 'Order.giftSnapshot (JSON)',         COUNT(*) FROM "Order"               WHERE "giftSnapshot"::text    LIKE '%http://huahai-aimaimai%';


-- =============================================================================
-- STEP 2: UPDATE 9 张普通表（事务保护，异常自动 ROLLBACK）
-- =============================================================================
-- 在事务里执行所有 UPDATE，最后用 SELECT 0 校验残留为 0 才 COMMIT
-- 如果中间任何一条失败，整个事务 ROLLBACK，数据保持干净

BEGIN;

UPDATE "ProductMedia"        SET url                       = REPLACE(url,                       'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE url                       LIKE 'http://huahai-aimaimai%';
UPDATE "UserProfile"         SET "avatarUrl"               = REPLACE("avatarUrl",               'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "avatarUrl"               LIKE 'http://huahai-aimaimai%';
UPDATE "CompanyDocument"     SET "fileUrl"                 = REPLACE("fileUrl",                 'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "fileUrl"                 LIKE 'http://huahai-aimaimai%';
UPDATE "MerchantApplication" SET "licenseFileUrl"          = REPLACE("licenseFileUrl",          'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "licenseFileUrl"          LIKE 'http://huahai-aimaimai%';
UPDATE "Shipment"            SET "waybillUrl"              = REPLACE("waybillUrl",              'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "waybillUrl"              LIKE 'http://huahai-aimaimai%';
UPDATE "Invoice"             SET "pdfUrl"                  = REPLACE("pdfUrl",                  'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "pdfUrl"                  LIKE 'http://huahai-aimaimai%';
UPDATE "AiUtterance"         SET "audioUrl"                = REPLACE("audioUrl",                'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "audioUrl"                LIKE 'http://huahai-aimaimai%';
UPDATE "AfterSaleRequest"    SET "replacementWaybillUrl"   = REPLACE("replacementWaybillUrl",   'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "replacementWaybillUrl"   LIKE 'http://huahai-aimaimai%';
UPDATE "VipGiftOption"       SET "coverUrl"                = REPLACE("coverUrl",                'http://huahai-aimaimai', 'https://huahai-aimaimai') WHERE "coverUrl"                LIKE 'http://huahai-aimaimai%';

-- 残留校验：所有表加起来必须为 0，否则有遗漏字段
-- 如果出现非 0，立即 ROLLBACK 排查（可能 schema 新增了字段没列在脚本里）
SELECT
  (SELECT COUNT(*) FROM "ProductMedia"        WHERE url                     LIKE 'http://huahai-aimaimai%') +
  (SELECT COUNT(*) FROM "UserProfile"         WHERE "avatarUrl"             LIKE 'http://huahai-aimaimai%') +
  (SELECT COUNT(*) FROM "CompanyDocument"     WHERE "fileUrl"               LIKE 'http://huahai-aimaimai%') +
  (SELECT COUNT(*) FROM "MerchantApplication" WHERE "licenseFileUrl"        LIKE 'http://huahai-aimaimai%') +
  (SELECT COUNT(*) FROM "Shipment"            WHERE "waybillUrl"            LIKE 'http://huahai-aimaimai%') +
  (SELECT COUNT(*) FROM "Invoice"             WHERE "pdfUrl"                LIKE 'http://huahai-aimaimai%') +
  (SELECT COUNT(*) FROM "AiUtterance"         WHERE "audioUrl"              LIKE 'http://huahai-aimaimai%') +
  (SELECT COUNT(*) FROM "AfterSaleRequest"    WHERE "replacementWaybillUrl" LIKE 'http://huahai-aimaimai%') +
  (SELECT COUNT(*) FROM "VipGiftOption"       WHERE "coverUrl"              LIKE 'http://huahai-aimaimai%')
  AS remaining_http_rows;
-- 期望：remaining_http_rows = 0

-- 校验通过后再 COMMIT；如果不为 0 改成 ROLLBACK
COMMIT;
-- ROLLBACK;


-- =============================================================================
-- STEP 3: Order.giftSnapshot JSON 字段单独迁移
-- =============================================================================
-- giftSnapshot 是 jsonb，里面嵌套有 coverUrl / productImage 等字段
-- 不能用 REPLACE，要用 jsonb 文本替换技巧：
-- 把整个 JSON 转 text → REPLACE → 再转回 jsonb

BEGIN;

UPDATE "Order"
SET "giftSnapshot" = REPLACE("giftSnapshot"::text, 'http://huahai-aimaimai', 'https://huahai-aimaimai')::jsonb
WHERE "giftSnapshot"::text LIKE '%http://huahai-aimaimai%';

-- 残留校验
SELECT COUNT(*) AS remaining_giftsnapshot_rows
FROM "Order"
WHERE "giftSnapshot"::text LIKE '%http://huahai-aimaimai%';
-- 期望：0

COMMIT;
-- ROLLBACK;


-- =============================================================================
-- STEP 4: 防漏审计（可选，但推荐）
-- =============================================================================
-- 如果 schema 新增了字段没列在脚本里，下面这段帮你找出哪些列还有 http URL
-- 注意：这是 information_schema 元查询，跑一次大概几秒

DO $$
DECLARE
    rec RECORD;
    cnt BIGINT;
    sql TEXT;
BEGIN
    FOR rec IN
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('text', 'character varying')
          AND (column_name ILIKE '%url%' OR column_name = 'url')
    LOOP
        sql := format('SELECT COUNT(*) FROM %I WHERE %I LIKE ''http://huahai-aimaimai%%''',
                      rec.table_name, rec.column_name);
        EXECUTE sql INTO cnt;
        IF cnt > 0 THEN
            RAISE NOTICE '⚠️ 残留 http URL: %.%  rows=%', rec.table_name, rec.column_name, cnt;
        END IF;
    END LOOP;
END $$;
