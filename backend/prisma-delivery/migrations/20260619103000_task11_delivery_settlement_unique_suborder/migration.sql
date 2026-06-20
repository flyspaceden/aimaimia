DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "DeliverySettlement"
    WHERE "subOrderId" IS NOT NULL
    GROUP BY "subOrderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add DeliverySettlement.subOrderId unique index: duplicate non-null subOrderId rows exist. Please resolve duplicate DeliverySettlement rows manually before rerunning this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "DeliverySettlement_subOrderId_key" ON "DeliverySettlement"("subOrderId");
