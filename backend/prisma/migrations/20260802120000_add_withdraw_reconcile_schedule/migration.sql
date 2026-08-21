ALTER TABLE "WithdrawRequest"
ADD COLUMN "nextReconcileAt" TIMESTAMP(3);

CREATE INDEX "WithdrawRequest_status_nextReconcileAt_createdAt_idx"
ON "WithdrawRequest"("status", "nextReconcileAt", "createdAt");
