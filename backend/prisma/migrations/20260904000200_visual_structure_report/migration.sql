-- Nullable and additive: old invocations remain readable without backfill.
ALTER TABLE "VisualAgentInvocation" ADD COLUMN "verificationReport" JSONB;
