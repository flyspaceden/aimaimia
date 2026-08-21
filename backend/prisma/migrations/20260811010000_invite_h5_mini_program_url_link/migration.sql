ALTER TABLE "InviteH5LandingEvent"
  ADD COLUMN "miniProgramUrlLink" TEXT,
  ADD COLUMN "miniProgramUrlLinkExpiresAt" TIMESTAMP(3),
  ADD COLUMN "miniProgramUrlLinkClaimUntil" TIMESTAMP(3);
