BEGIN;
CREATE TABLE "FundProofBinding" (
 "proofId" TEXT PRIMARY KEY REFERENCES "FundPrivateProof"(id) ON DELETE RESTRICT,
 "bindingKey" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER fund_proof_binding_immutable BEFORE UPDATE OR DELETE ON "FundProofBinding"
FOR EACH ROW EXECUTE FUNCTION industry_fund_immutable();
CREATE INDEX "FundPrivateProof_adminId_createdAt_idx" ON "FundPrivateProof" ("adminId", "createdAt");
COMMIT;
