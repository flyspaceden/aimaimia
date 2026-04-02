-- AlterTable: CartItem 添加奖品字段
ALTER TABLE "CartItem" ADD COLUMN "isPrize" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CartItem" ADD COLUMN "prizeRecordId" TEXT;

-- DropIndex: 移除原有的唯一约束（奖品项可能与普通项 SKU 相同）
DROP INDEX IF EXISTS "CartItem_cartId_skuId_key";

-- CreateIndex: 替换为普通索引
CREATE INDEX "CartItem_cartId_skuId_idx" ON "CartItem"("cartId", "skuId");

-- LotteryRecord: 移除 @@unique 改为 @@index（支持每日多次抽奖）
DROP INDEX IF EXISTS "LotteryRecord_userId_drawDate_key";
CREATE INDEX "LotteryRecord_userId_drawDate_idx" ON "LotteryRecord"("userId", "drawDate");

-- NormalTreeNode: 修复旧种子数据 rootId 不一致（ROOT → NORMAL_ROOT）
UPDATE "NormalTreeNode" SET "rootId" = 'NORMAL_ROOT' WHERE "rootId" = 'ROOT';
