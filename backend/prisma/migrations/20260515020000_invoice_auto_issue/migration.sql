-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "lastAutoIssueAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Invoice_status_failedAttempts_lastAutoIssueAttemptAt_idx" ON "Invoice"("status", "failedAttempts", "lastAutoIssueAttemptAt");
