-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "provider" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "providerRequestId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "providerRaw" JSONB;
ALTER TABLE "Invoice" ADD COLUMN "invoiceContentSnapshot" JSONB;
ALTER TABLE "Invoice" ADD COLUMN "requestCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Invoice" ADD COLUMN "requestedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "failedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "canceledAt" TIMESTAMP(3);

-- Backfill existing invoices so historical application time remains stable.
UPDATE "Invoice" SET "requestedAt" = "createdAt" WHERE "requestedAt" IS NULL;

ALTER TABLE "Invoice" ALTER COLUMN "requestedAt" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "requestedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "InvoiceStatusHistory" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fromStatus" "InvoiceStatus",
    "toStatus" "InvoiceStatus" NOT NULL,
    "reason" TEXT,
    "operatorId" TEXT,
    "operatorType" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_providerRequestId_idx" ON "Invoice"("providerRequestId");

-- CreateIndex
CREATE INDEX "InvoiceStatusHistory_invoiceId_createdAt_idx" ON "InvoiceStatusHistory"("invoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceStatusHistory" ADD CONSTRAINT "InvoiceStatusHistory_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
