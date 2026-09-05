-- One merchant credit quote may fund at most one Core Provider invocation.
ALTER TABLE "VisualCreditQuote"
  ADD COLUMN "visualAgentInvocationId" TEXT;
CREATE UNIQUE INDEX "VisualCreditQuote_visualAgentInvocationId_key"
  ON "VisualCreditQuote"("visualAgentInvocationId");
ALTER TABLE "VisualCreditQuote"
  ADD CONSTRAINT "VisualCreditQuote_visualAgentInvocationId_fkey"
  FOREIGN KEY ("visualAgentInvocationId") REFERENCES "VisualAgentInvocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
