-- Preserve historical second-level data for audit while removing it from the active model.
ALTER TYPE "CaptainLedgerType" RENAME VALUE 'INDIRECT_ORDER' TO 'LEGACY_INDIRECT_ORDER';
ALTER TYPE "CaptainLedgerType" ADD VALUE IF NOT EXISTS 'PERFORMANCE_BONUS';

ALTER TABLE "CaptainRelation"
  RENAME COLUMN "indirectCaptainUserId" TO "legacyIndirectCaptainUserId";
ALTER TABLE "CaptainOrderAttribution"
  RENAME COLUMN "indirectCaptainUserId" TO "legacyIndirectCaptainUserId";
ALTER TABLE "CaptainOrderAttribution"
  RENAME COLUMN "indirectRate" TO "legacyIndirectRate";

ALTER INDEX "CaptainRelation_indirectCaptainUserId_status_createdAt_idx"
  RENAME TO "CaptainRelation_legacyIndirectCaptainUserId_status_createdAt_idx";
ALTER INDEX "CaptainOrderAttribution_indirectCaptainUserId_status_createdAt_idx"
  RENAME TO "CaptainOrderAttribution_legacyIndirectCaptainUserId_status_createdAt_idx";

ALTER TABLE "CaptainRelation"
  RENAME CONSTRAINT "CaptainRelation_indirectCaptainUserId_fkey"
  TO "CaptainRelation_legacyIndirectCaptainUserId_fkey";
ALTER TABLE "CaptainOrderAttribution"
  RENAME CONSTRAINT "CaptainOrderAttribution_indirectCaptainUserId_fkey"
  TO "CaptainOrderAttribution_legacyIndirectCaptainUserId_fkey";
