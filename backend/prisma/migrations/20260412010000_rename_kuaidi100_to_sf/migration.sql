-- RenameColumn
ALTER TABLE "Shipment" RENAME COLUMN "kuaidi100TaskId" TO "sfOrderId";

-- RenameColumn
ALTER TABLE "AfterSaleRequest" RENAME COLUMN "replacementKuaidi100TaskId" TO "replacementSfOrderId";
