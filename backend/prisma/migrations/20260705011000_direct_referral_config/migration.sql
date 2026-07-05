WITH parsed_configs AS (
  SELECT
    key,
    CASE
      WHEN jsonb_typeof(value) = 'object'
        AND (value->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN (value->>'value')::numeric
      WHEN jsonb_typeof(value) <> 'object'
        AND (value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN (value #>> '{}')::numeric
      ELSE NULL
    END AS numeric_value
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
),
current_ratios AS (
  SELECT
    COALESCE(BOOL_OR(key = 'NORMAL_PLATFORM_PERCENT'), false) AS has_platform,
    COALESCE(BOOL_OR(key = 'NORMAL_DIRECT_REFERRAL_PERCENT'), false) AS has_direct,
    COALESCE(MAX(numeric_value) FILTER (WHERE key = 'NORMAL_PLATFORM_PERCENT'), 0.50) AS platform_value,
    COALESCE(MAX(numeric_value) FILTER (WHERE key = 'NORMAL_REWARD_PERCENT'), 0.16) AS reward_value,
    COALESCE(MAX(numeric_value) FILTER (WHERE key = 'NORMAL_INDUSTRY_FUND_PERCENT'), 0.16) AS industry_value,
    COALESCE(MAX(numeric_value) FILTER (WHERE key = 'NORMAL_CHARITY_PERCENT'), 0.08) AS charity_value,
    COALESCE(MAX(numeric_value) FILTER (WHERE key = 'NORMAL_TECH_PERCENT'), 0.08) AS tech_value,
    COALESCE(MAX(numeric_value) FILTER (WHERE key = 'NORMAL_RESERVE_PERCENT'), 0.02) AS reserve_value
  FROM parsed_configs
),
direct_referral_decision AS (
  SELECT
    has_platform,
    has_direct,
    platform_value,
    CASE
      WHEN NOT has_direct
        AND ABS(
          platform_value
          + reward_value
          + industry_value
          + charity_value
          + tech_value
          + reserve_value
          - 1.0
        ) <= 0.001
        AND platform_value >= 0.01
        THEN 0.01
      ELSE 0
    END AS direct_referral_value
  FROM current_ratios
),
platform_update AS (
  UPDATE "RuleConfig" rc
  SET
    value = CASE
      WHEN jsonb_typeof(rc.value) = 'object'
        THEN jsonb_set(
          rc.value,
          '{value}',
          to_jsonb(direct_referral_decision.platform_value - 0.01),
          true
        )
      ELSE to_jsonb(direct_referral_decision.platform_value - 0.01)
    END,
    "updatedAt" = NOW()
  FROM direct_referral_decision
  WHERE rc.key = 'NORMAL_PLATFORM_PERCENT'
    AND direct_referral_decision.has_platform
    AND NOT direct_referral_decision.has_direct
    AND direct_referral_decision.direct_referral_value = 0.01
  RETURNING rc.key
)
INSERT INTO "RuleConfig" (key, value, "updatedAt")
SELECT
  'NORMAL_DIRECT_REFERRAL_PERCENT',
  jsonb_build_object(
    'value',
    direct_referral_value,
    'description',
    '普通用户利润-直推持续佣金比例'
  ),
  NOW()
FROM direct_referral_decision
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
