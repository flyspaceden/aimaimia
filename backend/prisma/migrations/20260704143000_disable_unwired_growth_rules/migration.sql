-- Disable buyer-visible ordinary growth rules that do not have production event
-- handlers yet. They can be re-enabled after each behavior is wired to
-- GrowthEventService and verified end to end.

UPDATE "GrowthBehaviorRule"
SET "enabled" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'COMPLETE_PROFILE',
  'BIND_PHONE_OR_WECHAT',
  'BROWSE_PRODUCTS',
  'FAVORITE_ITEM',
  'SHARE_CONTENT',
  'REVIEW_ORDER',
  'NORMAL_INVITE_REGISTER',
  'VIP_PURCHASE'
);
