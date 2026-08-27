-- Stores only the minimal candidate-verification conclusion. Raw OCR/QR/
-- barcode values remain ephemeral and are never persisted in this table.
ALTER TABLE "VisualAgentCandidate" ADD COLUMN "verificationSummary" JSONB;
