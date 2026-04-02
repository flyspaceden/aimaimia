-- F2: 赠品锁定字段
ALTER TABLE "CartItem" ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CartItem" ADD COLUMN "threshold" DOUBLE PRECISION;
ALTER TABLE "CartItem" ADD COLUMN "isSelected" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CartItem" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CartItem" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- F3: 奖品过期时间索引
CREATE INDEX "CartItem_expiresAt_idx" ON "CartItem"("expiresAt");

-- F3: 奖品过期配置
ALTER TABLE "LotteryPrize" ADD COLUMN "expirationHours" INTEGER;
