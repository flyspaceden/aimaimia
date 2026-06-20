DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "DeliveryOrder"
    WHERE "checkoutSessionId" IS NOT NULL
    GROUP BY "checkoutSessionId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add DeliveryOrder.checkoutSessionId unique index: duplicate non-null checkoutSessionId rows exist. Please resolve duplicate DeliveryOrder rows manually before rerunning this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "DeliveryOrder_checkoutSessionId_key" ON "DeliveryOrder"("checkoutSessionId");
