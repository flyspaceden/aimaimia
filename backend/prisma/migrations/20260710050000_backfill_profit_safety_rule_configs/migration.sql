-- Profit safety validates complete configuration snapshots. Backfill keys that
-- older deployments created lazily so the first protected write can succeed.
INSERT INTO "RuleConfig" (key, value, "updatedAt") VALUES
  ('VIP_DISCOUNT_RATE', '{"value": 0.95, "description": "VIP用户商品折扣率（如0.95表示95折）"}'::jsonb, NOW()),
  ('VIP_REWARD_EXPIRY_DAYS', '{"value": 30, "description": "VIP已释放奖励有效期（天）"}'::jsonb, NOW()),
  ('NORMAL_REWARD_EXPIRY_DAYS', '{"value": 30, "description": "普通用户已释放奖励有效期（天）"}'::jsonb, NOW()),
  ('VIP_FREE_SHIPPING_THRESHOLD', '{"value": 49, "description": "VIP用户免运费门槛（元），0=无条件免运费"}'::jsonb, NOW()),
  ('NORMAL_FREE_SHIPPING_THRESHOLD', '{"value": 99, "description": "普通用户免运费门槛（元），0=无条件免运费"}'::jsonb, NOW()),
  ('LOW_STOCK_DISPLAY_THRESHOLD', '{"value": 10, "description": "App 低库存展示阈值（0 表示关闭）"}'::jsonb, NOW()),
  ('RETURN_SHIPPING_FEE_DEFAULT', '{"value": 10, "description": "默认退货运费（元）"}'::jsonb, NOW()),
  (
    'DIGITAL_ASSET_MODULE_SETTINGS',
    '{"value":{"modules":[{"key":"assetValue","title":"未来权益模块","enabled":false,"description":"规则待开放"},{"key":"level","title":"权益规则待开放","enabled":false,"description":"规则待开放"},{"key":"benefits","title":"未来权益模块","enabled":false,"description":"规则待开放"},{"key":"futureRights","title":"未来权益模块","enabled":false,"description":"规则待开放"}]},"description":"数字资产模块展示设置"}'::jsonb,
    NOW()
  ),
  ('GROUP_BUY_MAX_MONTHLY_LAUNCHES', '{"value": 4, "description": "每个用户每月最多可发起的团购次数"}'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;
