-- Provider-reported usage is kept as Core-private audit metadata. It never
-- contains raw OCR text or a browser-visible Provider response.
ALTER TABLE "VisualAgentInvocation"
  ADD COLUMN "providerUsage" JSONB;
