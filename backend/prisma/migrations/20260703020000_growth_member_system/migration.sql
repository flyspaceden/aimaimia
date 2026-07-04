-- CreateEnum
CREATE TYPE "GrowthLedgerType" AS ENUM ('POINTS_EARN', 'POINTS_SPEND', 'POINTS_EXPIRE', 'POINTS_REVERSE', 'GROWTH_EARN', 'GROWTH_REVERSE', 'ADMIN_ADJUST');

-- CreateEnum
CREATE TYPE "GrowthLedgerStatus" AS ENUM ('POSTED', 'REVERSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "GrowthGrantTiming" AS ENUM ('IMMEDIATE', 'CONFIRMED_RECEIPT', 'AFTER_SALE_WINDOW', 'MANUAL');

-- CreateEnum
CREATE TYPE "GrowthApplicableUserType" AS ENUM ('ALL', 'NORMAL', 'VIP');

-- CreateEnum
CREATE TYPE "GrowthExchangeType" AS ENUM ('COUPON', 'SHIPPING_COUPON', 'LOTTERY_CHANCE', 'VIP_DISCOUNT_COUPON', 'DECORATION');

-- CreateEnum
CREATE TYPE "GrowthExchangeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "GrowthExchangeRecordStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "NormalShareCodeStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "NormalShareBindingSource" AS ENUM ('LANDING', 'APP', 'DEFERRED', 'ADMIN');

-- CreateEnum
CREATE TYPE "NormalShareRewardStatus" AS ENUM ('PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING', 'ISSUED', 'REVERSED', 'VOIDED');

-- CreateTable
CREATE TABLE "GrowthBehaviorCategory" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT,
  "color" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthBehaviorCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthLevel" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "threshold" INTEGER NOT NULL,
  "benefits" JSONB,
  "avatarFrameType" TEXT,
  "titleLabel" TEXT,
  "monthlyExchangeLimit" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pointsBalance" INTEGER NOT NULL DEFAULT 0,
  "pointsTotalEarned" INTEGER NOT NULL DEFAULT 0,
  "pointsTotalSpent" INTEGER NOT NULL DEFAULT 0,
  "growthValue" INTEGER NOT NULL DEFAULT 0,
  "currentLevelCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthBehaviorRule" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "categoryCode" TEXT NOT NULL,
  "pointsReward" INTEGER NOT NULL DEFAULT 0,
  "growthReward" INTEGER NOT NULL DEFAULT 0,
  "grantTiming" "GrowthGrantTiming" NOT NULL DEFAULT 'IMMEDIATE',
  "dailyLimit" INTEGER,
  "weeklyLimit" INTEGER,
  "monthlyLimit" INTEGER,
  "lifetimeLimit" INTEGER,
  "applicableUserType" "GrowthApplicableUserType" NOT NULL DEFAULT 'ALL',
  "vipPointsMultiplier" DOUBLE PRECISION,
  "vipGrowthMultiplier" DOUBLE PRECISION,
  "riskPolicy" JSONB,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthBehaviorRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthExchangeItem" (
  "id" TEXT NOT NULL,
  "type" "GrowthExchangeType" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "pointsCost" INTEGER NOT NULL,
  "couponCampaignId" TEXT,
  "stockTotal" INTEGER,
  "stockDaily" INTEGER,
  "issuedTotal" INTEGER NOT NULL DEFAULT 0,
  "issuedToday" INTEGER NOT NULL DEFAULT 0,
  "issuedTodayDate" TEXT,
  "perUserDailyLimit" INTEGER,
  "perUserMonthlyLimit" INTEGER,
  "requiredLevelCode" TEXT,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "status" "GrowthExchangeStatus" NOT NULL DEFAULT 'ACTIVE',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthExchangeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthLedger" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "type" "GrowthLedgerType" NOT NULL,
  "behaviorCode" TEXT,
  "pointsDelta" INTEGER NOT NULL DEFAULT 0,
  "growthDelta" INTEGER NOT NULL DEFAULT 0,
  "status" "GrowthLedgerStatus" NOT NULL DEFAULT 'POSTED',
  "idempotencyKey" TEXT NOT NULL,
  "refType" TEXT,
  "refId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GrowthLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthExchangeRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "pointsCost" INTEGER NOT NULL,
  "status" "GrowthExchangeRecordStatus" NOT NULL DEFAULT 'PENDING',
  "couponInstanceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "failureReason" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GrowthExchangeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalShareProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "status" "NormalShareCodeStatus" NOT NULL DEFAULT 'ACTIVE',
  "disabledReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NormalShareProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalShareBinding" (
  "id" TEXT NOT NULL,
  "inviterUserId" TEXT NOT NULL,
  "inviteeUserId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "source" "NormalShareBindingSource" NOT NULL,
  "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstOrderId" TEXT,
  "rewardStatus" "NormalShareRewardStatus" NOT NULL DEFAULT 'PENDING',
  "rewardIssuedAt" TIMESTAMP(3),
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NormalShareBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrowthBehaviorCategory_code_key" ON "GrowthBehaviorCategory"("code");
CREATE INDEX "GrowthBehaviorCategory_enabled_sortOrder_idx" ON "GrowthBehaviorCategory"("enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthLevel_code_key" ON "GrowthLevel"("code");
CREATE UNIQUE INDEX "GrowthLevel_threshold_key" ON "GrowthLevel"("threshold");
CREATE INDEX "GrowthLevel_enabled_threshold_idx" ON "GrowthLevel"("enabled", "threshold");
CREATE INDEX "GrowthLevel_sortOrder_idx" ON "GrowthLevel"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthAccount_userId_key" ON "GrowthAccount"("userId");
CREATE INDEX "GrowthAccount_currentLevelCode_idx" ON "GrowthAccount"("currentLevelCode");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthBehaviorRule_code_key" ON "GrowthBehaviorRule"("code");
CREATE INDEX "GrowthBehaviorRule_categoryCode_enabled_sortOrder_idx" ON "GrowthBehaviorRule"("categoryCode", "enabled", "sortOrder");
CREATE INDEX "GrowthBehaviorRule_enabled_startAt_endAt_idx" ON "GrowthBehaviorRule"("enabled", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "GrowthExchangeItem_status_sortOrder_idx" ON "GrowthExchangeItem"("status", "sortOrder");
CREATE INDEX "GrowthExchangeItem_type_status_idx" ON "GrowthExchangeItem"("type", "status");
CREATE INDEX "GrowthExchangeItem_couponCampaignId_idx" ON "GrowthExchangeItem"("couponCampaignId");
CREATE INDEX "GrowthExchangeItem_requiredLevelCode_idx" ON "GrowthExchangeItem"("requiredLevelCode");
CREATE INDEX "GrowthExchangeItem_startAt_endAt_idx" ON "GrowthExchangeItem"("startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthLedger_idempotencyKey_key" ON "GrowthLedger"("idempotencyKey");
CREATE INDEX "GrowthLedger_userId_createdAt_idx" ON "GrowthLedger"("userId", "createdAt");
CREATE INDEX "GrowthLedger_accountId_createdAt_idx" ON "GrowthLedger"("accountId", "createdAt");
CREATE INDEX "GrowthLedger_behaviorCode_createdAt_idx" ON "GrowthLedger"("behaviorCode", "createdAt");
CREATE INDEX "GrowthLedger_refType_refId_idx" ON "GrowthLedger"("refType", "refId");
CREATE INDEX "GrowthLedger_expiresAt_idx" ON "GrowthLedger"("expiresAt");
CREATE INDEX "GrowthLedger_status_createdAt_idx" ON "GrowthLedger"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthExchangeRecord_idempotencyKey_key" ON "GrowthExchangeRecord"("idempotencyKey");
CREATE INDEX "GrowthExchangeRecord_userId_createdAt_idx" ON "GrowthExchangeRecord"("userId", "createdAt");
CREATE INDEX "GrowthExchangeRecord_itemId_createdAt_idx" ON "GrowthExchangeRecord"("itemId", "createdAt");
CREATE INDEX "GrowthExchangeRecord_status_createdAt_idx" ON "GrowthExchangeRecord"("status", "createdAt");
CREATE INDEX "GrowthExchangeRecord_couponInstanceId_idx" ON "GrowthExchangeRecord"("couponInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "NormalShareProfile_userId_key" ON "NormalShareProfile"("userId");
CREATE UNIQUE INDEX "NormalShareProfile_code_key" ON "NormalShareProfile"("code");
CREATE INDEX "NormalShareProfile_status_createdAt_idx" ON "NormalShareProfile"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NormalShareBinding_inviteeUserId_key" ON "NormalShareBinding"("inviteeUserId");
CREATE INDEX "NormalShareBinding_inviterUserId_createdAt_idx" ON "NormalShareBinding"("inviterUserId", "createdAt");
CREATE INDEX "NormalShareBinding_code_createdAt_idx" ON "NormalShareBinding"("code", "createdAt");
CREATE INDEX "NormalShareBinding_rewardStatus_createdAt_idx" ON "NormalShareBinding"("rewardStatus", "createdAt");
CREATE INDEX "NormalShareBinding_firstOrderId_idx" ON "NormalShareBinding"("firstOrderId");

-- AddForeignKey
ALTER TABLE "GrowthAccount" ADD CONSTRAINT "GrowthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthAccount" ADD CONSTRAINT "GrowthAccount_currentLevelCode_fkey" FOREIGN KEY ("currentLevelCode") REFERENCES "GrowthLevel"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GrowthBehaviorRule" ADD CONSTRAINT "GrowthBehaviorRule_categoryCode_fkey" FOREIGN KEY ("categoryCode") REFERENCES "GrowthBehaviorCategory"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthExchangeItem" ADD CONSTRAINT "GrowthExchangeItem_couponCampaignId_fkey" FOREIGN KEY ("couponCampaignId") REFERENCES "CouponCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthExchangeItem" ADD CONSTRAINT "GrowthExchangeItem_requiredLevelCode_fkey" FOREIGN KEY ("requiredLevelCode") REFERENCES "GrowthLevel"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GrowthLedger" ADD CONSTRAINT "GrowthLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthLedger" ADD CONSTRAINT "GrowthLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthExchangeRecord" ADD CONSTRAINT "GrowthExchangeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthExchangeRecord" ADD CONSTRAINT "GrowthExchangeRecord_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GrowthAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthExchangeRecord" ADD CONSTRAINT "GrowthExchangeRecord_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "GrowthExchangeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthExchangeRecord" ADD CONSTRAINT "GrowthExchangeRecord_couponInstanceId_fkey" FOREIGN KEY ("couponInstanceId") REFERENCES "CouponInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NormalShareProfile" ADD CONSTRAINT "NormalShareProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NormalShareBinding" ADD CONSTRAINT "NormalShareBinding_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NormalShareBinding" ADD CONSTRAINT "NormalShareBinding_inviteeUserId_fkey" FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NormalShareBinding" ADD CONSTRAINT "NormalShareBinding_firstOrderId_fkey" FOREIGN KEY ("firstOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
