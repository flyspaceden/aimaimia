UPDATE "RuleConfig"
SET
  value = CASE
    WHEN jsonb_typeof(value) = 'object'
      THEN jsonb_set(value, '{value}', '0.49'::jsonb, true)
    ELSE '0.49'::jsonb
  END,
  "updatedAt" = NOW()
WHERE key = 'NORMAL_PLATFORM_PERCENT'
  AND (
    value = '0.50'::jsonb
    OR (
      jsonb_typeof(value) = 'object'
      AND value->'value' = '0.50'::jsonb
    )
  );

INSERT INTO "RuleConfig" (key, value, "updatedAt")
VALUES
  (
    'NORMAL_DIRECT_REFERRAL_PERCENT',
    '{"value": 0.01, "description": "普通用户利润-直推持续佣金比例"}'::jsonb,
    NOW()
  ),
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
