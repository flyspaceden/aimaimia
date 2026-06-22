DO $$
BEGIN
  ALTER TYPE "DigitalAssetLedgerType" ADD VALUE 'CONSUMPTION_PAID_FROZEN';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "DigitalAssetLedgerType" ADD VALUE 'CONSUMPTION_FROZEN_RELEASED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "DigitalAssetLedgerType" ADD VALUE 'CONSUMPTION_FROZEN_VOIDED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "DigitalAssetAccount"
  ADD COLUMN "frozenCreditAssetBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "frozenCumulativeSpendAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "DigitalAssetLedger"
  ADD COLUMN "frozenCreditAssetBalanceAfter" INTEGER,
  ADD COLUMN "frozenCumulativeSpendAfter" DOUBLE PRECISION;

CREATE INDEX "DigitalAssetAccount_frozenCreditAssetBalance_idx"
  ON "DigitalAssetAccount"("frozenCreditAssetBalance");
