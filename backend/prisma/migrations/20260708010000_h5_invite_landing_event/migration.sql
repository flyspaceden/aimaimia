CREATE TABLE "InviteH5LandingEvent" (
  "id" TEXT NOT NULL,
  "inviteCode" TEXT NOT NULL,
  "inviteType" TEXT,
  "inviterUserId" TEXT,
  "landingSessionId" TEXT NOT NULL,
  "ipAddress" TEXT NOT NULL,
  "userAgent" TEXT NOT NULL,
  "screenInfo" TEXT,
  "language" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "authedUserId" TEXT,
  "authedAt" TIMESTAMP(3),
  "bindingStatus" TEXT,
  "bindingType" TEXT,
  "boundAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InviteH5LandingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InviteH5LandingEvent_landingSessionId_key" ON "InviteH5LandingEvent"("landingSessionId");
CREATE INDEX "InviteH5LandingEvent_inviteCode_openedAt_idx" ON "InviteH5LandingEvent"("inviteCode", "openedAt");
CREATE INDEX "InviteH5LandingEvent_inviterUserId_openedAt_idx" ON "InviteH5LandingEvent"("inviterUserId", "openedAt");
CREATE INDEX "InviteH5LandingEvent_authedUserId_idx" ON "InviteH5LandingEvent"("authedUserId");
