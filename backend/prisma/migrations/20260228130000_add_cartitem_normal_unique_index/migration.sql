-- 普通商品（isPrize=false）保留唯一约束，防止并发加购产生重复行
-- 奖品项（isPrize=true）不受约束，同一SKU可以有多个奖品行
CREATE UNIQUE INDEX "CartItem_cartId_skuId_normal_key"
  ON "CartItem"("cartId", "skuId")
  WHERE "isPrize" = false;
