-- Product-media governance changes from pre-publication approval to immediate
-- seller application plus auditable, CAS-protected administrative rollback.
ALTER TYPE "ProductMediaRevisionStatus" ADD VALUE IF NOT EXISTS 'APPLIED_BY_SELLER';
ALTER TYPE "ProductMediaRevisionStatus" ADD VALUE IF NOT EXISTS 'ROLLED_BACK_BY_ADMIN';

ALTER TABLE "ProductMediaRevision"
  ADD COLUMN "appliedMediaVersion" INTEGER,
  ADD COLUMN "previousMedia" JSONB,
  ADD COLUMN "rolledBackAt" TIMESTAMP(3);

CREATE INDEX "ProductMediaRevision_status_appliedAt_idx"
  ON "ProductMediaRevision"("status", "appliedAt");
