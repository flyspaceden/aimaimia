-- CreateEnum
CREATE TYPE "CompanyCreditEventType" AS ENUM ('PRIVACY_VIOLATION', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReplacementReasonType" AS ENUM ('QUALITY_ISSUE', 'WRONG_ITEM', 'DAMAGED', 'NOT_AS_DESCRIBED', 'SIZE_ISSUE', 'EXPIRED', 'OTHER');

-- AlterEnum
ALTER TYPE "CompanyStatus" ADD VALUE 'BANNED';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "creditScore" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "suspendedUntil" TIMESTAMP(3),
ADD COLUMN     "virtualCallRestrictedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReplacementRequest" ADD COLUMN     "reasonType" "ReplacementReasonType",
ADD COLUMN     "replacementCarrierCode" TEXT,
ADD COLUMN     "replacementCarrierName" TEXT,
ADD COLUMN     "replacementWaybillNo" TEXT,
ADD COLUMN     "replacementWaybillUrl" TEXT;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "waybillNo" TEXT,
ADD COLUMN     "waybillUrl" TEXT;

-- CreateTable
CREATE TABLE "CompanyCreditEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CompanyCreditEventType" NOT NULL,
    "scoreDelta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceRefId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyCreditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualCallBinding" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "replacementId" TEXT,
    "companyId" TEXT NOT NULL,
    "sellerPhone" TEXT NOT NULL,
    "buyerPhone" TEXT NOT NULL,
    "virtualNo" TEXT NOT NULL,
    "expireAt" TIMESTAMP(3) NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualCallBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerAuditLog" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyCreditEvent_companyId_createdAt_idx" ON "CompanyCreditEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyCreditEvent_companyId_type_createdAt_idx" ON "CompanyCreditEvent"("companyId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyCreditEvent_companyId_sourceType_sourceRefId_idx" ON "CompanyCreditEvent"("companyId", "sourceType", "sourceRefId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerAlias_alias_key" ON "BuyerAlias"("alias");

-- CreateIndex
CREATE INDEX "BuyerAlias_companyId_idx" ON "BuyerAlias"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerAlias_userId_companyId_key" ON "BuyerAlias"("userId", "companyId");

-- CreateIndex
CREATE INDEX "VirtualCallBinding_orderId_idx" ON "VirtualCallBinding"("orderId");

-- CreateIndex
CREATE INDEX "VirtualCallBinding_replacementId_idx" ON "VirtualCallBinding"("replacementId");

-- CreateIndex
CREATE INDEX "VirtualCallBinding_expireAt_idx" ON "VirtualCallBinding"("expireAt");

-- CreateIndex
CREATE INDEX "VirtualCallBinding_companyId_idx" ON "VirtualCallBinding"("companyId");

-- CreateIndex
CREATE INDEX "SellerAuditLog_companyId_createdAt_idx" ON "SellerAuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "SellerAuditLog_staffId_createdAt_idx" ON "SellerAuditLog"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "SellerAuditLog_action_idx" ON "SellerAuditLog"("action");

-- AddForeignKey
ALTER TABLE "CompanyCreditEvent" ADD CONSTRAINT "CompanyCreditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAlias" ADD CONSTRAINT "BuyerAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAlias" ADD CONSTRAINT "BuyerAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCallBinding" ADD CONSTRAINT "VirtualCallBinding_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCallBinding" ADD CONSTRAINT "VirtualCallBinding_replacementId_fkey" FOREIGN KEY ("replacementId") REFERENCES "ReplacementRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCallBinding" ADD CONSTRAINT "VirtualCallBinding_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
