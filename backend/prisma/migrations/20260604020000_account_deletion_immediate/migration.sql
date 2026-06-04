-- Account deletion immediate flow: deletion SMS purpose and metadata.
ALTER TYPE "SmsPurpose" ADD VALUE IF NOT EXISTS 'DELETION';

ALTER TABLE "User"
  ADD COLUMN "deletionExecutedAt" TIMESTAMP(3),
  ADD COLUMN "deletionConfirmMethod" TEXT,
  ADD COLUMN "deletionMeta" JSONB;

ALTER TABLE "Address" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "User_deletionExecutedAt_idx" ON "User"("deletionExecutedAt");
CREATE INDEX "Address_userId_deletedAt_idx" ON "Address"("userId", "deletedAt");
