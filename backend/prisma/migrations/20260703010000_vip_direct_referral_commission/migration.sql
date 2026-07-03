ALTER TYPE "AllocationRuleType" ADD VALUE IF NOT EXISTS 'VIP_DIRECT_REFERRAL';

INSERT INTO "RuleConfig" (key, value, "updatedAt")
VALUES (
  'VIP_DIRECT_REFERRAL_PERCENT',
  '{"value": 0, "description": "VIP利润-直推持续佣金比例"}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
