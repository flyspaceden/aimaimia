-- 防止同一奖品记录被多个订单重复使用
-- prizeRecordId 非空时必须唯一（数据库级强制）
CREATE UNIQUE INDEX "OrderItem_prizeRecordId_unique"
  ON "OrderItem"("prizeRecordId")
  WHERE "prizeRecordId" IS NOT NULL;
