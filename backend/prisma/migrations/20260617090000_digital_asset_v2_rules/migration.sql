DO $$
BEGIN
  ALTER TYPE "DigitalAssetLedgerType" ADD VALUE 'CONSUMPTION_CONFIRMED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "DigitalAssetLedgerType" ADD VALUE 'SELF_VIP_PURCHASE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "DigitalAssetLedgerType" ADD VALUE 'REFERRAL_VIP_PURCHASE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "DigitalAssetLedgerType" ADD VALUE 'HISTORICAL_CONSUMPTION_GRANT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TYPE "DigitalAssetLedgerSubjectType" AS ENUM ('CUMULATIVE_SPEND', 'SEED_ASSET', 'CREDIT_ASSET');

ALTER TABLE "DigitalAssetAccount"
  ADD COLUMN "seedAssetBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "creditAssetBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "historicalCreditGrantedAt" TIMESTAMP(3),
  ADD COLUMN "historicalCreditGrantLedgerId" TEXT;

ALTER TABLE "DigitalAssetLedger"
  ADD COLUMN "subjectType" "DigitalAssetLedgerSubjectType" NOT NULL DEFAULT 'CUMULATIVE_SPEND',
  ADD COLUMN "assetAmount" INTEGER,
  ADD COLUMN "cumulativeSpendAfter" DOUBLE PRECISION,
  ADD COLUMN "seedAssetBalanceAfter" INTEGER,
  ADD COLUMN "creditAssetBalanceAfter" INTEGER,
  ADD COLUMN "ruleSnapshot" JSONB,
  ADD COLUMN "vipPurchaseId" TEXT;

ALTER TABLE "VipPackage"
  ADD COLUMN "selfSeedAssetAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "referralSeedAssetAmount" INTEGER NOT NULL DEFAULT 0;

UPDATE "VipPackage" SET "selfSeedAssetAmount" = 1000, "referralSeedAssetAmount" = 2000 WHERE "price" = 399;
UPDATE "VipPackage" SET "selfSeedAssetAmount" = 2000, "referralSeedAssetAmount" = 4000 WHERE "price" = 699;
UPDATE "VipPackage" SET "selfSeedAssetAmount" = 3000, "referralSeedAssetAmount" = 8000 WHERE "price" = 999;

CREATE INDEX "DigitalAssetAccount_seedAssetBalance_idx" ON "DigitalAssetAccount"("seedAssetBalance");
CREATE INDEX "DigitalAssetAccount_creditAssetBalance_idx" ON "DigitalAssetAccount"("creditAssetBalance");
CREATE INDEX "DigitalAssetLedger_subjectType_createdAt_idx" ON "DigitalAssetLedger"("subjectType", "createdAt");
CREATE INDEX "DigitalAssetLedger_vipPurchaseId_idx" ON "DigitalAssetLedger"("vipPurchaseId");

ALTER TABLE "DigitalAssetLedger"
  ADD CONSTRAINT "DigitalAssetLedger_vipPurchaseId_fkey"
  FOREIGN KEY ("vipPurchaseId") REFERENCES "VipPurchase"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
