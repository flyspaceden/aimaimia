-- Seed ordinary growth defaults for production databases.
-- These rows used to live only in seed.ts, so deployed databases had an empty
-- admin "行为规则" table and no editable default rules.

INSERT INTO "GrowthBehaviorCategory" (
  "id", "code", "name", "icon", "color", "sortOrder", "enabled", "createdAt", "updatedAt"
) VALUES
  ('growth-category-newbie', 'NEWBIE', '新手任务', 'sprout', '#16A34A', 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-category-daily', 'DAILY', '日常活跃', 'calendar-check', '#0EA5E9', 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-category-shopping', 'SHOPPING', '购物成长', 'shopping-bag', '#F59E0B', 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-category-share', 'SHARE', '分享任务', 'share-2', '#8B5CF6', 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-category-invite', 'INVITE', '邀请好友', 'users', '#EC4899', 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-category-vip', 'VIP', 'VIP 转化', 'crown', '#D97706', 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-category-task', 'TASK', '任务活动', 'list-checks', '#0891B2', 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-category-admin', 'ADMIN', '后台管理', 'settings', '#64748B', 80, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "GrowthLevel" (
  "id", "code", "name", "threshold", "benefits", "avatarFrameType", "titleLabel",
  "monthlyExchangeLimit", "sortOrder", "enabled", "createdAt", "updatedAt"
) VALUES
  ('growth-level-sprout', 'SPROUT', '新芽会员', 0, '{"copy":"基础签到、基础兑换"}'::jsonb, NULL, '新芽会员', 1, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-level-seedling', 'SEEDLING', '青苗会员', 300, '{"copy":"完成新手路径后解锁更多兑换"}'::jsonb, NULL, '青苗会员', 2, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-level-ear', 'EAR', '青穗会员', 1000, '{"copy":"首单与复购用户兑换额度提升"}'::jsonb, NULL, '青穗会员', 3, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-level-harvest', 'HARVEST', '丰收会员', 3000, '{"copy":"稳定购买用户可解锁头像框和称号"}'::jsonb, NULL, '丰收会员', 4, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-level-golden-ear', 'GOLDEN_EAR', '金穗会员', 8000, '{"copy":"高活跃用户解锁高阶红包兑换"}'::jsonb, NULL, '金穗会员', 5, 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-level-star-farmer', 'STAR_FARMER', '星农会员', 20000, '{"copy":"高价值普通用户重点 VIP 转化权益"}'::jsonb, NULL, '星农会员', 6, 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "GrowthBehaviorRule" (
  "id", "code", "name", "categoryCode", "pointsReward", "growthReward", "grantTiming",
  "dailyLimit", "weeklyLimit", "monthlyLimit", "lifetimeLimit", "applicableUserType",
  "vipPointsMultiplier", "vipGrowthMultiplier", "riskPolicy", "startAt", "endAt",
  "enabled", "sortOrder", "createdAt", "updatedAt"
) VALUES
  ('growth-rule-register', 'REGISTER', '注册成功', 'NEWBIE', 30, 50, 'IMMEDIATE', NULL, NULL, NULL, 1, 'ALL', NULL, NULL, NULL, NULL, NULL, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-complete-profile', 'COMPLETE_PROFILE', '完善资料', 'NEWBIE', 20, 30, 'IMMEDIATE', NULL, NULL, NULL, 1, 'ALL', NULL, NULL, NULL, NULL, NULL, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-bind-phone-or-wechat', 'BIND_PHONE_OR_WECHAT', '绑定微信/手机号', 'NEWBIE', 30, 50, 'IMMEDIATE', NULL, NULL, NULL, 1, 'ALL', NULL, NULL, NULL, NULL, NULL, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-check-in', 'CHECK_IN', '每日签到', 'DAILY', 5, 0, 'IMMEDIATE', 1, NULL, NULL, NULL, 'ALL', 1.2, NULL, NULL, NULL, NULL, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-browse-products', 'BROWSE_PRODUCTS', '浏览 3 个商品', 'DAILY', 5, 5, 'IMMEDIATE', 1, NULL, NULL, NULL, 'ALL', NULL, NULL, NULL, NULL, NULL, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-favorite-item', 'FAVORITE_ITEM', '收藏商品/店铺', 'DAILY', 5, 5, 'IMMEDIATE', 2, NULL, NULL, NULL, 'ALL', NULL, NULL, NULL, NULL, NULL, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-share-content', 'SHARE_CONTENT', '分享商品/活动', 'SHARE', 5, 5, 'IMMEDIATE', 3, NULL, NULL, NULL, 'ALL', NULL, NULL, NULL, NULL, NULL, true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-first-order-received', 'FIRST_ORDER_RECEIVED', '首单确认收货', 'SHOPPING', 100, 200, 'CONFIRMED_RECEIPT', NULL, NULL, NULL, 1, 'ALL', NULL, 1.5, NULL, NULL, NULL, true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-review-order', 'REVIEW_ORDER', '评价商品', 'SHOPPING', 20, 20, 'IMMEDIATE', NULL, NULL, NULL, NULL, 'ALL', NULL, NULL, '{"perOrderLimit":1}'::jsonb, NULL, NULL, true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-repurchase-received', 'REPURCHASE_RECEIVED', '复购确认收货', 'SHOPPING', 50, 100, 'CONFIRMED_RECEIPT', NULL, NULL, 5, NULL, 'ALL', NULL, 1.5, NULL, NULL, NULL, true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-normal-invite-register', 'NORMAL_INVITE_REGISTER', '邀请好友注册', 'INVITE', 20, 20, 'IMMEDIATE', 5, NULL, NULL, NULL, 'NORMAL', NULL, NULL, NULL, NULL, NULL, true, 110, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-normal-invite-first-order', 'NORMAL_INVITE_FIRST_ORDER', '好友首单确认收货', 'INVITE', 200, 300, 'CONFIRMED_RECEIPT', NULL, NULL, 20, NULL, 'NORMAL', NULL, NULL, NULL, NULL, NULL, true, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-vip-purchase', 'VIP_PURCHASE', '购买 VIP', 'VIP', 0, 500, 'IMMEDIATE', NULL, NULL, NULL, 1, 'VIP', NULL, NULL, NULL, NULL, NULL, true, 130, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-task-complete', 'TASK_COMPLETE', '任务完成', 'TASK', 0, 0, 'IMMEDIATE', NULL, NULL, NULL, NULL, 'ALL', NULL, NULL, NULL, NULL, NULL, true, 140, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('growth-rule-admin-adjust', 'ADMIN_ADJUST', '后台调整', 'ADMIN', 0, 0, 'MANUAL', NULL, NULL, NULL, NULL, 'ALL', NULL, NULL, NULL, NULL, NULL, true, 150, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

WITH resolved_levels AS (
  SELECT account."id", level."code"
  FROM "GrowthAccount" AS account
  JOIN LATERAL (
    SELECT "code"
    FROM "GrowthLevel"
    WHERE "enabled" = true
      AND "threshold" <= account."growthValue"
    ORDER BY "threshold" DESC, "sortOrder" DESC
    LIMIT 1
  ) AS level ON true
  WHERE account."currentLevelCode" IS NULL
)
UPDATE "GrowthAccount" AS account
SET "currentLevelCode" = resolved_levels."code",
    "updatedAt" = CURRENT_TIMESTAMP
FROM resolved_levels
WHERE account."id" = resolved_levels."id";
