-- NORMAL_INVITE_REGISTER now has a production handler in NormalShareService.
-- Re-enable the rule so ordinary share-code registration rewards can be
-- configured from the growth behavior rules table.

UPDATE "GrowthBehaviorRule"
SET "enabled" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'NORMAL_INVITE_REGISTER';
