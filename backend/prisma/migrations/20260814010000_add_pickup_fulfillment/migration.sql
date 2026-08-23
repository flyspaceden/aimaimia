-- CreateEnum
CREATE TYPE "FulfillmentMode" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "PickupFulfillmentStatus" AS ENUM ('PREPARING', 'READY', 'PICKED_UP', 'VOID', 'CANCELED');

-- Historical rows remain delivery orders. New clients may explicitly choose pickup.
ALTER TABLE "CheckoutSession"
  ADD COLUMN "fulfillmentMode" "FulfillmentMode" NOT NULL DEFAULT 'DELIVERY',
  ADD COLUMN "pickupRecipientSnapshot" JSONB,
  ADD COLUMN "pickupSelectionsSnapshot" JSONB,
  ALTER COLUMN "addressSnapshot" DROP NOT NULL;

ALTER TABLE "Order"
  ADD COLUMN "fulfillmentMode" "FulfillmentMode" NOT NULL DEFAULT 'DELIVERY';

CREATE TABLE "PickupPoint" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "contactName" VARCHAR(50) NOT NULL,
  "contactPhone" VARCHAR(255) NOT NULL,
  "regionCode" VARCHAR(32) NOT NULL,
  "regionText" VARCHAR(120) NOT NULL,
  "detail" VARCHAR(200) NOT NULL,
  "location" JSONB,
  "businessHours" JSONB NOT NULL,
  "pickupNotice" VARCHAR(500),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PickupPoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupFulfillment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "pickupPointId" TEXT NOT NULL,
  "status" "PickupFulfillmentStatus" NOT NULL DEFAULT 'PREPARING',
  "pickupPointSnapshot" JSONB NOT NULL,
  "recipientSnapshot" JSONB NOT NULL,
  "pickupCodeDigest" VARCHAR(64) NOT NULL,
  "pickupTokenDigest" VARCHAR(64) NOT NULL,
  "pickupCredentialEncrypted" JSONB NOT NULL,
  "readyAt" TIMESTAMP(3),
  "pickedUpAt" TIMESTAMP(3),
  "pickedUpByStaffId" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PickupFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupFulfillmentEvent" (
  "id" TEXT NOT NULL,
  "fulfillmentId" TEXT NOT NULL,
  "fromStatus" "PickupFulfillmentStatus",
  "toStatus" "PickupFulfillmentStatus" NOT NULL,
  "eventType" VARCHAR(64) NOT NULL,
  "actorType" VARCHAR(32),
  "actorId" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PickupFulfillmentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PickupPoint_companyId_isActive_idx" ON "PickupPoint"("companyId", "isActive");
CREATE UNIQUE INDEX "PickupFulfillment_orderId_key" ON "PickupFulfillment"("orderId");
CREATE INDEX "PickupFulfillment_pickupPointId_status_readyAt_idx" ON "PickupFulfillment"("pickupPointId", "status", "readyAt");
CREATE INDEX "PickupFulfillment_status_createdAt_idx" ON "PickupFulfillment"("status", "createdAt");
CREATE INDEX "PickupFulfillmentEvent_fulfillmentId_createdAt_idx" ON "PickupFulfillmentEvent"("fulfillmentId", "createdAt");
CREATE INDEX "PickupFulfillmentEvent_eventType_createdAt_idx" ON "PickupFulfillmentEvent"("eventType", "createdAt");
CREATE INDEX "CheckoutSession_fulfillmentMode_status_createdAt_idx" ON "CheckoutSession"("fulfillmentMode", "status", "createdAt");
CREATE INDEX "Order_fulfillmentMode_status_createdAt_idx" ON "Order"("fulfillmentMode", "status", "createdAt");

ALTER TABLE "PickupPoint"
  ADD CONSTRAINT "PickupPoint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickupFulfillment"
  ADD CONSTRAINT "PickupFulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickupFulfillment"
  ADD CONSTRAINT "PickupFulfillment_pickupPointId_fkey" FOREIGN KEY ("pickupPointId") REFERENCES "PickupPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PickupFulfillmentEvent"
  ADD CONSTRAINT "PickupFulfillmentEvent_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "PickupFulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
