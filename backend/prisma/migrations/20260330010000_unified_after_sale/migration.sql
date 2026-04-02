-- CreateEnum: AfterSaleType
CREATE TYPE "AfterSaleType" AS ENUM ('NO_REASON_RETURN', 'QUALITY_RETURN', 'QUALITY_EXCHANGE');

-- CreateEnum: AfterSaleStatus
CREATE TYPE "AfterSaleStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PENDING_ARBITRATION', 'RETURN_SHIPPING', 'RECEIVED_BY_SELLER', 'SELLER_REJECTED_RETURN', 'REFUNDING', 'REFUNDED', 'REPLACEMENT_SHIPPED', 'COMPLETED', 'CLOSED', 'CANCELED');

-- CreateEnum: ReturnPolicy
CREATE TYPE "ReturnPolicy" AS ENUM ('RETURNABLE', 'NON_RETURNABLE', 'INHERIT');

-- AlterEnum: RewardLedgerStatus - add RETURN_FROZEN
ALTER TYPE "RewardLedgerStatus" ADD VALUE 'RETURN_FROZEN';

-- AlterTable: User - add hasAgreedReturnPolicy
ALTER TABLE "User" ADD COLUMN "hasAgreedReturnPolicy" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Category - add returnPolicy
ALTER TABLE "Category" ADD COLUMN "returnPolicy" "ReturnPolicy" NOT NULL DEFAULT 'INHERIT';

-- AlterTable: Product - add returnPolicy
ALTER TABLE "Product" ADD COLUMN "returnPolicy" "ReturnPolicy" NOT NULL DEFAULT 'INHERIT';

-- AlterTable: Order - add deliveredAt, returnWindowExpiresAt
ALTER TABLE "Order" ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "returnWindowExpiresAt" TIMESTAMP(3);

-- Rename table: ReplacementRequest -> after_sale_request
ALTER TABLE "ReplacementRequest" RENAME TO "after_sale_request";

-- AlterTable: after_sale_request - add new columns
ALTER TABLE "after_sale_request" ADD COLUMN "afterSaleType" "AfterSaleType";
ALTER TABLE "after_sale_request" ADD COLUMN "isPostReplacement" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "after_sale_request" ADD COLUMN "arbitrationSource" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "requiresReturn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "after_sale_request" ADD COLUMN "returnCarrierName" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "returnWaybillNo" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "returnShippedAt" TIMESTAMP(3);
ALTER TABLE "after_sale_request" ADD COLUMN "sellerRejectReason" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "sellerRejectPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "after_sale_request" ADD COLUMN "sellerReturnWaybillNo" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "refundAmount" DOUBLE PRECISION;
ALTER TABLE "after_sale_request" ADD COLUMN "refundId" TEXT;
ALTER TABLE "after_sale_request" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "after_sale_request" ADD COLUMN "sellerReceivedAt" TIMESTAMP(3);

-- Migrate existing status values: ReplacementStatus -> AfterSaleStatus
-- AfterSaleStatus contains all values from ReplacementStatus except SHIPPED
-- Map SHIPPED -> REPLACEMENT_SHIPPED for existing exchange records
ALTER TABLE "after_sale_request" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "after_sale_request" ALTER COLUMN "status" TYPE TEXT;

-- Convert old status values
UPDATE "after_sale_request" SET "status" = 'REPLACEMENT_SHIPPED' WHERE "status" = 'SHIPPED';

-- Cast to new enum type
ALTER TABLE "after_sale_request" ALTER COLUMN "status" TYPE "AfterSaleStatus" USING "status"::"AfterSaleStatus";
ALTER TABLE "after_sale_request" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';

-- Backfill afterSaleType: all existing records were exchanges
UPDATE "after_sale_request" SET "afterSaleType" = 'QUALITY_EXCHANGE' WHERE "afterSaleType" IS NULL;

-- Now make afterSaleType NOT NULL
ALTER TABLE "after_sale_request" ALTER COLUMN "afterSaleType" SET NOT NULL;

-- CreateIndex: status + createdAt for after_sale_request
CREATE INDEX "after_sale_request_status_createdAt_idx" ON "after_sale_request"("status", "createdAt");
