-- Backfill zero-value growth accounts for existing active ordinary buyers.
-- Existing balances are never overwritten.
INSERT INTO "GrowthAccount" (
  "id",
  "userId",
  "pointsBalance",
  "pointsTotalEarned",
  "pointsTotalSpent",
  "growthValue",
  "currentLevelCode",
  "createdAt",
  "updatedAt"
)
SELECT
  'growth_' || md5(u."id"),
  u."id",
  0,
  0,
  0,
  0,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
LEFT JOIN "MemberProfile" mp ON mp."userId" = u."id"
LEFT JOIN "GrowthAccount" ga ON ga."userId" = u."id"
WHERE ga."id" IS NULL
  AND u."buyerNo" IS NOT NULL
  AND u."status" = 'ACTIVE'
  AND u."deletionExecutedAt" IS NULL
  AND (mp."id" IS NULL OR mp."tier" <> 'VIP');

-- Backfill active normal-share profiles for the same existing ordinary buyers.
-- Code generation is deterministic from buyerNo first, with an md5 fallback if that code already exists.
-- Existing share profiles are never overwritten.
WITH candidates AS (
  SELECT
    u."id" AS "userId",
    u."buyerNo",
    'S' || right(u."buyerNo", 7) AS "preferredCode",
    'S' || upper(substr(md5(u."id"), 1, 7)) AS "fallbackCode"
  FROM "User" u
  LEFT JOIN "MemberProfile" mp ON mp."userId" = u."id"
  LEFT JOIN "NormalShareProfile" nsp ON nsp."userId" = u."id"
  WHERE nsp."id" IS NULL
    AND u."buyerNo" IS NOT NULL
    AND u."status" = 'ACTIVE'
    AND u."deletionExecutedAt" IS NULL
    AND (mp."id" IS NULL OR mp."tier" <> 'VIP')
),
resolved_codes AS (
  SELECT
    candidates."userId",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "NormalShareProfile" existing
        WHERE existing."code" = candidates."preferredCode"
      ) THEN candidates."fallbackCode"
      ELSE candidates."preferredCode"
    END AS "code"
  FROM candidates
)
INSERT INTO "NormalShareProfile" (
  "id",
  "userId",
  "code",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  'normal_share_' || md5(resolved_codes."userId"),
  resolved_codes."userId",
  resolved_codes."code",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM resolved_codes
ON CONFLICT DO NOTHING;
