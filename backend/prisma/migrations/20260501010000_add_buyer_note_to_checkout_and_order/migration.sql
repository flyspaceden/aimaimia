-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN "buyerNote" VARCHAR(200);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "buyerNote" VARCHAR(200);
