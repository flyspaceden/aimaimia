-- Rate-card guardrails bind the merchant-facing tariff to a server-verified
-- visual-plan direction/risk snapshot. Empty arrays deliberately fail closed.
ALTER TABLE "VisualRateCard"
  ADD COLUMN "allowedDirections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "allowedRiskProfiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "candidateRole" TEXT NOT NULL DEFAULT 'FACT_MAIN_IMAGE',
  ADD COLUMN "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "VisualCreditQuote"
  ADD COLUMN "visualPlanSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "VisualRateCard"
  ADD CONSTRAINT "VisualRateCard_candidate_role_nonempty" CHECK (length("candidateRole") > 0);
