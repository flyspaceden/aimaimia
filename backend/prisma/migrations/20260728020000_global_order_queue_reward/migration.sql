ALTER TYPE "RewardAccountType" ADD VALUE IF NOT EXISTS 'QUEUE_REWARD';
ALTER TYPE "AllocationRuleType" ADD VALUE IF NOT EXISTS 'GLOBAL_QUEUE';

CREATE TYPE "QueueRewardDistributionMode" AS ENUM ('AVERAGE', 'NORMAL_RANDOM');
CREATE TYPE "QueueRewardOrderStatus" AS ENUM ('ACTIVE', 'CAPPED', 'COMPLETED', 'VOIDED');
CREATE TYPE "QueueRewardPositionStatus" AS ENUM ('ACTIVE', 'CAPPED', 'COMPLETED', 'VOIDED');
CREATE TYPE "QueueRewardDistributionStatus" AS ENUM ('FROZEN', 'AVAILABLE', 'VOIDED');

INSERT INTO "RuleConfig" (key, value, "updatedAt") VALUES
  ('QUEUE_REWARD_ENABLED', '{"value": false, "description": "全平台订单队列奖励开关"}'::jsonb, NOW()),
  ('QUEUE_SIZE', '{"value": 21, "description": "队列人数（当前订单+前序位置）"}'::jsonb, NOW()),
  ('QUEUE_REWARD_PERCENT', '{"value": 0.01, "description": "每单利润中用于队列奖励的比例（实际从平台分成扣减）"}'::jsonb, NOW()),
  ('QUEUE_SPLIT_UNIT_AMOUNT', '{"value": 200, "description": "大单完整队列位置金额单元（元）"}'::jsonb, NOW()),
  ('QUEUE_MAX_POSITIONS_PER_ORDER', '{"value": 100, "description": "单个订单最多产生的队列位置数"}'::jsonb, NOW()),
  ('QUEUE_DISTRIBUTION_MODE', '{"value": "AVERAGE", "description": "队列红包分配模式"}'::jsonb, NOW()),
  ('QUEUE_RANDOM_STDDEV', '{"value": 0.25, "description": "正态随机权重标准差"}'::jsonb, NOW()),
  ('QUEUE_RANDOM_MIN_FACTOR', '{"value": 0.5, "description": "正态随机权重最小倍数"}'::jsonb, NOW()),
  ('QUEUE_RANDOM_MAX_FACTOR', '{"value": 1.5, "description": "正态随机权重最大倍数"}'::jsonb, NOW()),
  ('QUEUE_ACTIVATION_AT', '{"value": "", "description": "队列奖励生效时间，开启前必须设置"}'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

CREATE TABLE "QueueRewardOrderState" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eligiblePaidAmount" DOUBLE PRECISION NOT NULL,
    "sharedCapAmount" DOUBLE PRECISION NOT NULL,
    "frozenReceivedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availableReceivedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voidedReceivedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "QueueRewardOrderStatus" NOT NULL DEFAULT 'ACTIVE',
    "ruleVersion" TEXT NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueRewardOrderState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QueueRewardOrderState_amounts_check" CHECK (
      "eligiblePaidAmount" >= 0
      AND "sharedCapAmount" >= 0
      AND "frozenReceivedAmount" >= 0
      AND "availableReceivedAmount" >= 0
      AND "voidedReceivedAmount" >= 0
      AND "frozenReceivedAmount" + "availableReceivedAmount" <= "sharedCapAmount" + 0.00001
    )
);

CREATE TABLE "QueueRewardPosition" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "orderStateId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitIndex" INTEGER NOT NULL,
    "observedUnitCount" INTEGER NOT NULL DEFAULT 0,
    "targetObservedUnitCount" INTEGER NOT NULL,
    "status" "QueueRewardPositionStatus" NOT NULL DEFAULT 'ACTIVE',
    "exitReason" TEXT,
    "ruleVersion" TEXT NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueRewardPosition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QueueRewardPosition_counts_check" CHECK (
      "unitIndex" >= 0
      AND "observedUnitCount" >= 0
      AND "targetObservedUnitCount" >= 1
      AND "observedUnitCount" <= "targetObservedUnitCount"
    )
);

CREATE TABLE "QueueRewardAllocation" (
    "id" TEXT NOT NULL,
    "rewardAllocationId" TEXT NOT NULL,
    "sourceOrderId" TEXT NOT NULL,
    "sourcePositionId" TEXT NOT NULL,
    "sourceUnitIndex" INTEGER NOT NULL,
    "profitAmount" DOUBLE PRECISION NOT NULL,
    "rewardPoolAmount" DOUBLE PRECISION NOT NULL,
    "distributedAmount" DOUBLE PRECISION NOT NULL,
    "platformRetainedAmount" DOUBLE PRECISION NOT NULL,
    "distributionMode" "QueueRewardDistributionMode" NOT NULL,
    "randomSeed" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueRewardAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QueueRewardAllocation_amounts_check" CHECK (
      "sourceUnitIndex" >= 0
      AND "profitAmount" >= 0
      AND "rewardPoolAmount" >= 0
      AND "distributedAmount" >= 0
      AND "platformRetainedAmount" >= 0
      AND abs(("distributedAmount" + "platformRetainedAmount") - "rewardPoolAmount") < 0.00001
    )
);

CREATE TABLE "QueueRewardDistribution" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "sourceOrderId" TEXT NOT NULL,
    "sourcePositionId" TEXT NOT NULL,
    "beneficiaryPositionOrderId" TEXT NOT NULL,
    "beneficiaryPositionId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "QueueRewardDistributionStatus" NOT NULL DEFAULT 'FROZEN',
    "rewardLedgerId" TEXT,
    "weightSnapshot" JSONB,
    "releaseAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "recoveredAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "platformReturnedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "platformReturnRatio" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueRewardDistribution_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QueueRewardDistribution_amount_check" CHECK (
      "amount" > 0
      AND "recoveredAmount" >= 0
      AND "platformReturnedAmount" >= 0
      AND "recoveredAmount" <= "amount" + 0.00001
      AND "platformReturnedAmount" <= "recoveredAmount" + 0.00001
    )
);

CREATE UNIQUE INDEX "QueueRewardOrderState_orderId_key" ON "QueueRewardOrderState"("orderId");
CREATE UNIQUE INDEX "QueueRewardOrderState_orderId_userId_key" ON "QueueRewardOrderState"("orderId", "userId");
CREATE UNIQUE INDEX "QueueRewardOrderState_id_orderId_userId_key" ON "QueueRewardOrderState"("id", "orderId", "userId");
CREATE INDEX "QueueRewardOrderState_userId_status_createdAt_idx" ON "QueueRewardOrderState"("userId", "status", "createdAt");
CREATE INDEX "QueueRewardOrderState_status_updatedAt_idx" ON "QueueRewardOrderState"("status", "updatedAt");

CREATE UNIQUE INDEX "QueueRewardPosition_sequence_key" ON "QueueRewardPosition"("sequence");
CREATE UNIQUE INDEX "QueueRewardPosition_orderId_unitIndex_key" ON "QueueRewardPosition"("orderId", "unitIndex");
CREATE UNIQUE INDEX "QueueRewardPosition_id_orderId_key" ON "QueueRewardPosition"("id", "orderId");
CREATE UNIQUE INDEX "QueueRewardPosition_id_orderId_userId_key" ON "QueueRewardPosition"("id", "orderId", "userId");
CREATE INDEX "QueueRewardPosition_status_sequence_idx" ON "QueueRewardPosition"("status", "sequence");
CREATE INDEX "QueueRewardPosition_userId_joinedAt_idx" ON "QueueRewardPosition"("userId", "joinedAt");
CREATE INDEX "QueueRewardPosition_orderId_status_idx" ON "QueueRewardPosition"("orderId", "status");

CREATE UNIQUE INDEX "QueueRewardAllocation_idempotencyKey_key" ON "QueueRewardAllocation"("idempotencyKey");
CREATE UNIQUE INDEX "QueueRewardAllocation_sourceOrderId_sourceUnitIndex_key" ON "QueueRewardAllocation"("sourceOrderId", "sourceUnitIndex");
CREATE UNIQUE INDEX "QueueRewardAllocation_id_sourceOrderId_key" ON "QueueRewardAllocation"("id", "sourceOrderId");
CREATE INDEX "QueueRewardAllocation_sourceOrderId_createdAt_idx" ON "QueueRewardAllocation"("sourceOrderId", "createdAt");
CREATE INDEX "QueueRewardAllocation_rewardAllocationId_idx" ON "QueueRewardAllocation"("rewardAllocationId");

CREATE UNIQUE INDEX "QueueRewardDistribution_rewardLedgerId_key" ON "QueueRewardDistribution"("rewardLedgerId");
CREATE UNIQUE INDEX "QueueRewardDistribution_idempotencyKey_key" ON "QueueRewardDistribution"("idempotencyKey");
CREATE UNIQUE INDEX "QueueRewardDistribution_allocationId_beneficiaryPositionId_key" ON "QueueRewardDistribution"("allocationId", "beneficiaryPositionId");
CREATE UNIQUE INDEX "QueueRewardDistribution_id_recipientUserId_key" ON "QueueRewardDistribution"("id", "recipientUserId");
CREATE INDEX "QueueRewardDistribution_sourceOrderId_status_idx" ON "QueueRewardDistribution"("sourceOrderId", "status");
CREATE INDEX "QueueRewardDistribution_beneficiaryPositionOrderId_status_idx" ON "QueueRewardDistribution"("beneficiaryPositionOrderId", "status");
CREATE INDEX "QueueRewardDistribution_recipientUserId_status_createdAt_idx" ON "QueueRewardDistribution"("recipientUserId", "status", "createdAt");
CREATE INDEX "QueueRewardDistribution_releaseAt_status_idx" ON "QueueRewardDistribution"("releaseAt", "status");
CREATE INDEX "QueueRewardDistribution_status_updatedAt_releaseAt_id_idx" ON "QueueRewardDistribution"("status", "updatedAt", "releaseAt", "id");

CREATE UNIQUE INDEX "Order_id_userId_key" ON "Order"("id", "userId");

ALTER TABLE "QueueRewardOrderState"
  ADD CONSTRAINT "QueueRewardOrderState_orderId_fkey"
  FOREIGN KEY ("orderId", "userId") REFERENCES "Order"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QueueRewardPosition"
  ADD CONSTRAINT "QueueRewardPosition_orderStateId_fkey"
  FOREIGN KEY ("orderStateId", "orderId", "userId") REFERENCES "QueueRewardOrderState"("id", "orderId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QueueRewardAllocation"
  ADD CONSTRAINT "QueueRewardAllocation_rewardAllocationId_fkey"
  FOREIGN KEY ("rewardAllocationId") REFERENCES "RewardAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QueueRewardAllocation"
  ADD CONSTRAINT "QueueRewardAllocation_sourceOrderId_fkey"
  FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QueueRewardAllocation"
  ADD CONSTRAINT "QueueRewardAllocation_sourcePositionId_fkey"
  FOREIGN KEY ("sourcePositionId", "sourceOrderId") REFERENCES "QueueRewardPosition"("id", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QueueRewardDistribution"
  ADD CONSTRAINT "QueueRewardDistribution_allocationId_fkey"
  FOREIGN KEY ("allocationId", "sourceOrderId") REFERENCES "QueueRewardAllocation"("id", "sourceOrderId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QueueRewardDistribution"
  ADD CONSTRAINT "QueueRewardDistribution_sourcePositionId_fkey"
  FOREIGN KEY ("sourcePositionId", "sourceOrderId") REFERENCES "QueueRewardPosition"("id", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QueueRewardDistribution"
  ADD CONSTRAINT "QueueRewardDistribution_beneficiaryPositionId_fkey"
  FOREIGN KEY ("beneficiaryPositionId", "beneficiaryPositionOrderId", "recipientUserId") REFERENCES "QueueRewardPosition"("id", "orderId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QueueRewardDistribution"
  ADD CONSTRAINT "QueueRewardDistribution_rewardLedgerId_fkey"
  FOREIGN KEY ("rewardLedgerId") REFERENCES "RewardLedger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
