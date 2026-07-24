ALTER TABLE "InviteH5LandingEvent"
  ADD COLUMN "downloadPassHash" TEXT,
  ADD COLUMN "downloadPassExpiresAt" TIMESTAMP(3),
  ADD COLUMN "downloadPassUsedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "InviteH5LandingEvent_downloadPassHash_key"
  ON "InviteH5LandingEvent"("downloadPassHash");
