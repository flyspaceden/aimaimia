CREATE INDEX IF NOT EXISTS "CartItem_cartId_isPrize_isSelected_idx"
ON "CartItem" ("cartId", "isPrize", "isSelected");

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLedger_after_sale_release_once_idx"
ON "InventoryLedger" ("refType", "refId")
WHERE "type" = 'RELEASE'
  AND "refType" = 'AFTER_SALE'
  AND "refId" IS NOT NULL;
