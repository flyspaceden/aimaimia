WITH ranked_settlements AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "subOrderId"
      ORDER BY
        CASE WHEN status = 'SETTLED' THEN 0 ELSE 1 END,
        COALESCE("settledAt", "updatedAt", "createdAt") DESC,
        "createdAt" DESC,
        id DESC
    ) AS row_num
  FROM "DeliverySettlement"
  WHERE "subOrderId" IS NOT NULL
)
DELETE FROM "DeliverySettlement"
WHERE id IN (
  SELECT id
  FROM ranked_settlements
  WHERE row_num > 1
);

CREATE UNIQUE INDEX "DeliverySettlement_subOrderId_key" ON "DeliverySettlement"("subOrderId");
