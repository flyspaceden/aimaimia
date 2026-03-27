-- CreateTable: VIP 购买档位
CREATE TABLE "VipPackage" (
    "id" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "referralBonusRate" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "VipGiftOptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VipPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: VipPackage 状态+排序索引
CREATE INDEX "VipPackage_status_sortOrder_idx" ON "VipPackage"("status", "sortOrder");

-- AlterTable: VipGiftOption — 关联档位
ALTER TABLE "VipGiftOption" ADD COLUMN "packageId" TEXT;

-- DropIndex: 删除旧的 VipGiftOption 状态+排序索引
DROP INDEX IF EXISTS "VipGiftOption_status_sortOrder_idx";

-- CreateIndex: VipGiftOption 档位+状态+排序复合索引
CREATE INDEX "VipGiftOption_packageId_status_sortOrder_idx" ON "VipGiftOption"("packageId", "status", "sortOrder");

-- AddForeignKey: VipGiftOption → VipPackage
ALTER TABLE "VipGiftOption" ADD CONSTRAINT "VipGiftOption_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "VipPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: VipPurchase — 档位快照字段
ALTER TABLE "VipPurchase" ADD COLUMN "packageId" TEXT,
ADD COLUMN "referralBonusRate" DOUBLE PRECISION;
