-- =============================================================================
-- 数据迁移：把存量 InboxMessage 的无效路径修正为有效买家 App 路由
-- =============================================================================
-- 背景（详见 docs/issues/app-tpfix1.md Bug 8）
--   后端代码（commit f413e9a / b459d39 / 41d91c2）已修正新生消息的 deeplink，
--   但数据库里旧消息仍存着无效路径，老用户点击仍会进 expo-router unmatched route。
--
-- 涉及路径转换：
--   '/coupons'         → '/me/coupons'    （买家红包列表）
--   '/wallet'          → '/me/wallet'     （买家钱包）
--   '/seller/products' → 删除 target      （卖家路由不在买家 App，让消息变 info-only）
--   '/seller/orders'   → 删除 target      （同上）
--
-- 表：InboxMessage.target （Jsonb 字段，结构 { route: string, params?: object }）
--
-- 执行步骤：
--   1. STEP 1 dry-run COUNT 确认每类受影响行数
--   2. STEP 2 事务里执行 UPDATE + 残留校验，异常自动 ROLLBACK
--   3. App 真机点旧消息验证不再 unmatched
-- =============================================================================


-- =============================================================================
-- STEP 1: DRY-RUN — 确认受影响行数（不修改数据）
-- =============================================================================

SELECT '/coupons → /me/coupons'        AS migration, COUNT(*) AS affected FROM "InboxMessage" WHERE target->>'route' = '/coupons'
UNION ALL SELECT '/wallet → /me/wallet',           COUNT(*) FROM "InboxMessage" WHERE target->>'route' = '/wallet'
UNION ALL SELECT '/seller/products → NULL target', COUNT(*) FROM "InboxMessage" WHERE target->>'route' = '/seller/products'
UNION ALL SELECT '/seller/orders → NULL target',   COUNT(*) FROM "InboxMessage" WHERE target->>'route' = '/seller/orders';


-- =============================================================================
-- STEP 2: UPDATE 在事务里执行，含残留校验
-- =============================================================================

BEGIN;

-- 红包路径：/coupons → /me/coupons
UPDATE "InboxMessage"
SET target = jsonb_set(target, '{route}', '"/me/coupons"')
WHERE target->>'route' = '/coupons';

-- 钱包路径：/wallet → /me/wallet
UPDATE "InboxMessage"
SET target = jsonb_set(target, '{route}', '"/me/wallet"')
WHERE target->>'route' = '/wallet';

-- 卖家路径：删除整个 target 字段，让消息变 info-only（前端 target?.route 兜底）
-- 选 NULL 而非 jsonb_set 是因为前端逻辑 if (message.target?.route) 走 else 提示 toast
UPDATE "InboxMessage"
SET target = NULL
WHERE target->>'route' IN ('/seller/products', '/seller/orders');

-- 残留校验：所有无效路径必须为 0
SELECT
  (SELECT COUNT(*) FROM "InboxMessage" WHERE target->>'route' = '/coupons') +
  (SELECT COUNT(*) FROM "InboxMessage" WHERE target->>'route' = '/wallet') +
  (SELECT COUNT(*) FROM "InboxMessage" WHERE target->>'route' IN ('/seller/products', '/seller/orders'))
  AS remaining_invalid_routes;
-- 期望：remaining_invalid_routes = 0

-- 校验通过后再 COMMIT；如果不为 0 改成 ROLLBACK
COMMIT;
-- ROLLBACK;


-- =============================================================================
-- STEP 3: 防漏审计（可选，但推荐）
-- =============================================================================
-- 列出当前数据库里所有 InboxMessage 的 distinct route，确认无其他未知错路径
-- 期望结果：只看到有效买家路由（/me/*、/orders、/orders/[id]、/orders/track 等）
--          + NULL（info-only 消息）

SELECT target->>'route' AS route, COUNT(*) AS message_count
FROM "InboxMessage"
GROUP BY target->>'route'
ORDER BY message_count DESC;
-- 如果出现意料外的 route 值（比如新业务模块加了路径但没列在本脚本），
-- 立即排查代码：`grep -rn "target: { route:" backend/src/modules/`
