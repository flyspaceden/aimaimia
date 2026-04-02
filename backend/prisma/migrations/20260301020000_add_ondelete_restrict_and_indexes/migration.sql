-- AlterForeignKey: Cart.userId CASCADE -> RESTRICT
ALTER TABLE "Cart" DROP CONSTRAINT "Cart_userId_fkey";
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterForeignKey: RewardAllocation.orderId SET NULL -> RESTRICT
ALTER TABLE "RewardAllocation" DROP CONSTRAINT "RewardAllocation_orderId_fkey";
ALTER TABLE "RewardAllocation" ADD CONSTRAINT "RewardAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex: FK indexes for query performance (M5)
CREATE INDEX "ProductMedia_productId_idx" ON "ProductMedia"("productId");
CREATE INDEX "InventoryLedger_skuId_idx" ON "InventoryLedger"("skuId");
CREATE INDEX "ShipmentTrackingEvent_shipmentId_idx" ON "ShipmentTrackingEvent"("shipmentId");
CREATE INDEX "RewardLedger_allocationId_idx" ON "RewardLedger"("allocationId");
