CREATE TABLE "GroupBuyActivityItem" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "skuId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupBuyActivityItem_pkey" PRIMARY KEY ("id")
);

INSERT INTO "GroupBuyActivityItem" ("id", "activityId", "productId", "skuId", "quantity", "sortOrder", "createdAt", "updatedAt")
SELECT concat('gbai_', "id"), "id", "productId", "skuId", 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "GroupBuyActivity"
WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "GroupBuyActivityItem_activityId_skuId_key" ON "GroupBuyActivityItem"("activityId", "skuId");
CREATE INDEX "GroupBuyActivityItem_activityId_idx" ON "GroupBuyActivityItem"("activityId");
CREATE INDEX "GroupBuyActivityItem_productId_idx" ON "GroupBuyActivityItem"("productId");
CREATE INDEX "GroupBuyActivityItem_skuId_idx" ON "GroupBuyActivityItem"("skuId");

ALTER TABLE "GroupBuyActivityItem" ADD CONSTRAINT "GroupBuyActivityItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "GroupBuyActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupBuyActivityItem" ADD CONSTRAINT "GroupBuyActivityItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuyActivityItem" ADD CONSTRAINT "GroupBuyActivityItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "ProductSKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
