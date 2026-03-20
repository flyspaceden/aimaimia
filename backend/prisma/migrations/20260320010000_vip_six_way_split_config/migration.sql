-- VIP 分润系统从两级分割改为六分结构
-- 删除旧的 5 个 VIP 分润配置
DELETE FROM "RuleConfig" WHERE key IN (
  'REBATE_RATIO',
  'REWARD_POOL_PERCENT',
  'PLATFORM_PERCENT',
  'FUND_PERCENT',
  'POINTS_PERCENT'
);

-- 插入新的 6 个 VIP 六分配置
INSERT INTO "RuleConfig" (key, value, "updatedAt") VALUES
  ('VIP_PLATFORM_PERCENT', '{"value": 0.50, "description": "VIP利润-平台分成比例"}'::jsonb, NOW()),
  ('VIP_REWARD_PERCENT', '{"value": 0.30, "description": "VIP利润-奖励池比例"}'::jsonb, NOW()),
  ('VIP_INDUSTRY_FUND_PERCENT', '{"value": 0.10, "description": "VIP利润-产业基金(卖家)比例"}'::jsonb, NOW()),
  ('VIP_CHARITY_PERCENT', '{"value": 0.02, "description": "VIP利润-慈善基金比例"}'::jsonb, NOW()),
  ('VIP_TECH_PERCENT', '{"value": 0.02, "description": "VIP利润-科技基金比例"}'::jsonb, NOW()),
  ('VIP_RESERVE_PERCENT', '{"value": 0.06, "description": "VIP利润-备用金比例"}'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;
