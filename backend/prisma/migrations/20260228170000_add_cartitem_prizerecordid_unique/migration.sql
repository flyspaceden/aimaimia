-- CartItem.prizeRecordId 唯一约束
-- 防止同一奖品记录被重复加入购物车
-- PostgreSQL 中 NULL 值不受 UNIQUE 约束限制，多个 NULL 可共存
CREATE UNIQUE INDEX "CartItem_prizeRecordId_key" ON "CartItem"("prizeRecordId");
