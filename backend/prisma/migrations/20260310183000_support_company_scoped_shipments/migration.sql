UPDATE "OrderItem" oi
SET "companyId" = p."companyId"
FROM "ProductSKU" ps
JOIN "Product" p ON p.id = ps."productId"
WHERE oi."companyId" IS NULL
  AND oi."skuId" = ps.id;

UPDATE "OrderItem" oi
SET "companyId" = p."companyId"
FROM "Product" p
WHERE oi."companyId" IS NULL
  AND (oi."productSnapshot"->>'productId') = p.id;

ALTER TABLE "Shipment"
ADD COLUMN "companyId" TEXT;

UPDATE "Shipment" s
SET "companyId" = mapped."companyId"
FROM (
  SELECT DISTINCT ON ("orderId")
    "orderId",
    "companyId"
  FROM "OrderItem"
  WHERE "companyId" IS NOT NULL
  ORDER BY "orderId", "companyId"
) AS mapped
WHERE mapped."orderId" = s."orderId";

ALTER TABLE "Shipment"
ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Shipment"
ADD CONSTRAINT "Shipment_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Shipment_orderId_key";

CREATE UNIQUE INDEX "Shipment_orderId_companyId_key"
ON "Shipment"("orderId", "companyId");

CREATE INDEX "Shipment_companyId_idx"
ON "Shipment"("companyId");
