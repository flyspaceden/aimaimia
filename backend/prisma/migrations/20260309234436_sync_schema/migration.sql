/*
  Warnings:

  - Made the column `cost` on table `ProductSKU` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'GUEST';

-- DropForeignKey
ALTER TABLE "Cart" DROP CONSTRAINT "Cart_userId_fkey";

-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN     "vipDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "vipDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductSKU" ALTER COLUMN "cost" SET NOT NULL,
ALTER COLUMN "cost" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "WithdrawRequest" ALTER COLUMN "accountType" SET DEFAULT 'VIP_REWARD';

-- CreateIndex
CREATE INDEX "RewardAllocation_orderId_idx" ON "RewardAllocation"("orderId");

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
