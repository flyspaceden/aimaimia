-- Add independent group-buy rebate deduction fields to checkout sessions.
ALTER TABLE "CheckoutSession"
  ADD COLUMN "groupBuyRebateDeductionGroupId" TEXT,
  ADD COLUMN "groupBuyRebateDeductionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
