-- RenameColumn
ALTER TABLE "Shipment" RENAME COLUMN "kuaidi100TaskId" TO "sfOrderId";

-- RenameColumn
ALTER TABLE "after_sale_request" RENAME COLUMN "replacementKuaidi100TaskId" TO "replacementSfOrderId";
