DROP INDEX IF EXISTS "GroupBuyReferral_instanceId_candidateSequence_key";

CREATE UNIQUE INDEX "GroupBuyReferral_instanceId_active_candidateSequence_key"
  ON "GroupBuyReferral"("instanceId", "candidateSequence")
  WHERE "candidateSequence" IS NOT NULL
    AND "status" IN ('CANDIDATE', 'VALID');
