-- AlterTable
ALTER TABLE "DeliveryPayment"
  ALTER COLUMN "orderId" DROP NOT NULL,
  ADD COLUMN "checkoutSessionId" TEXT;

-- CreateIndex
CREATE INDEX "DeliveryPayment_checkoutSessionId_status_idx"
ON "DeliveryPayment"("checkoutSessionId", "status");

-- AddForeignKey
ALTER TABLE "DeliveryPayment"
ADD CONSTRAINT "DeliveryPayment_checkoutSessionId_fkey"
FOREIGN KEY ("checkoutSessionId") REFERENCES "DeliveryCheckoutSession"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- UpdateForeignKey
ALTER TABLE "DeliveryPayment" DROP CONSTRAINT "DeliveryPayment_orderId_fkey";

ALTER TABLE "DeliveryPayment"
ADD CONSTRAINT "DeliveryPayment_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
