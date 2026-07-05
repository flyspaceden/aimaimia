CREATE TYPE "DirectReferralRelationStatus" AS ENUM (
  'ACTIVE',
  'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
  'SUPERSEDED_BY_VIP_TREE',
  'ADMIN_VOIDED'
);

ALTER TABLE "NormalShareBinding"
  ADD COLUMN "relationStatus" "DirectReferralRelationStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "relationInvalidAt" TIMESTAMP(3),
  ADD COLUMN "relationInvalidReason" TEXT,
  ADD COLUMN "effectiveInviterUserId" TEXT;

UPDATE "NormalShareBinding"
SET "effectiveInviterUserId" = "inviterUserId"
WHERE "effectiveInviterUserId" IS NULL;

CREATE INDEX "NormalShareBinding_relationStatus_createdAt_idx"
  ON "NormalShareBinding"("relationStatus", "createdAt");

CREATE INDEX "NormalShareBinding_effectiveInviterUserId_createdAt_idx"
  ON "NormalShareBinding"("effectiveInviterUserId", "createdAt");
