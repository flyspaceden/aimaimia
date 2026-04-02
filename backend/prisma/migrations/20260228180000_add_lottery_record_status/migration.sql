-- LotteryRecord 生命周期状态枚举
-- 状态转换：WON → IN_CART → CONSUMED / WON → EXPIRED / IN_CART → EXPIRED
CREATE TYPE "LotteryRecordStatus" AS ENUM ('WON', 'IN_CART', 'EXPIRED', 'CONSUMED');

-- 为 LotteryRecord 添加 status 字段，默认值 WON（已中奖）
ALTER TABLE "LotteryRecord" ADD COLUMN "status" "LotteryRecordStatus" NOT NULL DEFAULT 'WON';

-- 按状态查询索引（如查未消费的中奖记录）
CREATE INDEX "LotteryRecord_status_idx" ON "LotteryRecord"("status");
