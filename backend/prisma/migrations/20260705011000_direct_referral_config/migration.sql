WITH current_normal_state AS (
  SELECT
    COALESCE(BOOL_OR(key = 'NORMAL_DIRECT_REFERRAL_PERCENT'), false) AS has_direct,
    COALESCE(
      BOOL_OR(key IN (
        'NORMAL_PLATFORM_PERCENT',
        'NORMAL_REWARD_PERCENT',
        'NORMAL_INDUSTRY_FUND_PERCENT',
        'NORMAL_CHARITY_PERCENT',
        'NORMAL_TECH_PERCENT',
        'NORMAL_RESERVE_PERCENT'
      )),
      false
    ) AS has_normal_ratio
  FROM "RuleConfig"
  WHERE key IN (
    'NORMAL_PLATFORM_PERCENT',
    'NORMAL_REWARD_PERCENT',
    'NORMAL_DIRECT_REFERRAL_PERCENT',
    'NORMAL_INDUSTRY_FUND_PERCENT',
    'NORMAL_CHARITY_PERCENT',
    'NORMAL_TECH_PERCENT',
    'NORMAL_RESERVE_PERCENT'
  )
)
INSERT INTO "RuleConfig" (key, value, "updatedAt")
SELECT
  'NORMAL_DIRECT_REFERRAL_PERCENT',
  jsonb_build_object(
    'value',
    CASE WHEN has_normal_ratio THEN 0 ELSE 0.01 END,
    'description',
    '普通用户利润-直推持续佣金比例'
  ),
  NOW()
FROM current_normal_state
WHERE NOT has_direct
ON CONFLICT (key) DO NOTHING;

INSERT INTO "RuleConfig" (key, value, "updatedAt")
VALUES
  (
    'AUTO_VIP_BY_SPEND_ENABLED',
    '{"value": true, "description": "是否启用累计消费自动成为VIP"}'::jsonb,
    NOW()
  ),
  (
    'AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD',
    '{"value": 399, "description": "累计普通商品有效消费达到多少元自动成为VIP"}'::jsonb,
    NOW()
  )
ON CONFLICT (key) DO NOTHING;
