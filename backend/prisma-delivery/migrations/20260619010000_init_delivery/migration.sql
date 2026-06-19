-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DeliveryAuthProvider" AS ENUM ('PHONE', 'WECHAT');

-- CreateEnum
CREATE TYPE "DeliveryUserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'FROZEN');

-- CreateEnum
CREATE TYPE "DeliveryAdminUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DeliverySellerStaffRole" AS ENUM ('OWNER', 'MANAGER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "DeliverySellerStaffStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DeliveryUnitStatus" AS ENUM ('ACTIVE', 'DISABLED', 'FROZEN');

-- CreateEnum
CREATE TYPE "DeliveryMerchantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DeliveryMerchantApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeliveryCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DeliveryProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DeliveryProductAuditStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DeliveryPriceRuleScope" AS ENUM ('PLATFORM', 'MERCHANT', 'PRODUCT', 'SKU');

-- CreateEnum
CREATE TYPE "DeliveryPriceRuleType" AS ENUM ('FIXED_PRICE', 'MARKUP_RATE');

-- CreateEnum
CREATE TYPE "DeliveryShippingRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DeliveryShippingCalcType" AS ENUM ('WEIGHT', 'COUNT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "DeliveryInventoryLedgerType" AS ENUM ('IN', 'OUT', 'ADJUST', 'RESERVE', 'RELEASE');

-- CreateEnum
CREATE TYPE "DeliveryCheckoutSessionStatus" AS ENUM ('ACTIVE', 'PAID', 'COMPLETED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryOrderStatus" AS ENUM ('PENDING_SHIPMENT', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DeliveryPaymentChannel" AS ENUM ('WECHAT_PAY', 'ALIPAY');

-- CreateEnum
CREATE TYPE "DeliveryPaymentScene" AS ENUM ('APP');

-- CreateEnum
CREATE TYPE "DeliveryPaymentStatus" AS ENUM ('INIT', 'PENDING', 'PAID', 'FAILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DeliveryShipmentStatus" AS ENUM ('INIT', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "DeliveryManifestTemplateType" AS ENUM ('USER_FULL', 'SELLER_FULFILLMENT', 'SELLER_SETTLEMENT');

-- CreateEnum
CREATE TYPE "DeliveryManifestFormat" AS ENUM ('PDF', 'EXCEL');

-- CreateEnum
CREATE TYPE "DeliveryManifestStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryManifestVersionStatus" AS ENUM ('PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DeliverySettlementStatus" AS ENUM ('PENDING', 'SETTLED');

-- CreateEnum
CREATE TYPE "DeliveryConversationStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "DeliveryConversationSource" AS ENUM ('APP', 'ADMIN', 'SELLER');

-- CreateEnum
CREATE TYPE "DeliveryUnitFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'SELECT');

-- CreateEnum
CREATE TYPE "DeliveryConfigScope" AS ENUM ('SYSTEM', 'CUSTOMER_SERVICE', 'MANIFEST', 'UNIT');

-- CreateEnum
CREATE TYPE "DeliveryAuditActorType" AS ENUM ('USER', 'ADMIN', 'SELLER', 'SYSTEM');

-- CreateTable
CREATE TABLE "DeliverySequence" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "currentValue" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryUser" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "status" "DeliveryUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "loginFailCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAuthIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "DeliveryAuthProvider" NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAdminUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "realName" TEXT,
    "roleCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "permissions" JSONB,
    "status" "DeliveryAdminUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySellerStaff" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "phone" TEXT,
    "username" TEXT,
    "passwordHash" TEXT,
    "realName" TEXT,
    "role" "DeliverySellerStaffRole" NOT NULL DEFAULT 'OPERATOR',
    "permissionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "DeliverySellerStaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySellerStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryUnit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "provinceName" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "districtCode" TEXT NOT NULL,
    "districtName" TEXT NOT NULL,
    "detailAddress" TEXT NOT NULL,
    "extraFields" JSONB,
    "status" "DeliveryUnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "remark" TEXT,
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "provinceCode" TEXT NOT NULL,
    "provinceName" TEXT NOT NULL,
    "cityCode" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "districtCode" TEXT NOT NULL,
    "districtName" TEXT NOT NULL,
    "detailAddress" TEXT NOT NULL,
    "regionText" TEXT,
    "label" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryMerchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "description" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "servicePhone" TEXT,
    "status" "DeliveryMerchantStatus" NOT NULL DEFAULT 'PENDING',
    "logoUrl" TEXT,
    "addressJson" JSONB,
    "defaultMarkupBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryMerchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryMerchantApplication" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "email" TEXT,
    "note" TEXT,
    "licenseFileUrl" TEXT,
    "status" "DeliveryMerchantApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByAdminId" TEXT,
    "merchantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryMerchantApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryCategory" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "DeliveryCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryProductUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryProductUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryProduct" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "categoryId" TEXT,
    "productUnitId" TEXT,
    "createdByStaffId" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "detailRich" JSONB,
    "media" JSONB,
    "attributes" JSONB,
    "searchKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unitName" TEXT NOT NULL,
    "status" "DeliveryProductStatus" NOT NULL DEFAULT 'DRAFT',
    "auditStatus" "DeliveryProductAuditStatus" NOT NULL DEFAULT 'PENDING',
    "auditNote" TEXT,
    "submissionCount" INTEGER NOT NULL DEFAULT 1,
    "minOrderQuantity" INTEGER NOT NULL DEFAULT 1,
    "orderStepQuantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryProductSku" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuCode" TEXT,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "supplyPriceCents" INTEGER NOT NULL,
    "basePriceCents" INTEGER NOT NULL,
    "fixedFinalPriceCents" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "minOrderQuantity" INTEGER NOT NULL DEFAULT 1,
    "orderStepQuantity" INTEGER NOT NULL DEFAULT 1,
    "weightGram" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryProductSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPriceRule" (
    "id" TEXT NOT NULL,
    "scope" "DeliveryPriceRuleScope" NOT NULL,
    "ruleType" "DeliveryPriceRuleType" NOT NULL,
    "merchantId" TEXT,
    "productId" TEXT,
    "skuId" TEXT,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "maxQuantity" INTEGER,
    "fixedPriceCents" INTEGER,
    "markupBps" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryShippingRule" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "status" "DeliveryShippingRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "calcType" "DeliveryShippingCalcType" NOT NULL DEFAULT 'WEIGHT',
    "firstWeightGram" INTEGER NOT NULL,
    "firstWeightPriceCents" INTEGER NOT NULL,
    "additionalWeightGram" INTEGER,
    "additionalWeightPriceCents" INTEGER,
    "freeShippingThresholdCents" INTEGER,
    "minShippingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryShippingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryShippingCost" (
    "id" TEXT NOT NULL,
    "checkoutSessionId" TEXT,
    "orderId" TEXT,
    "subOrderId" TEXT,
    "merchantId" TEXT,
    "skuId" TEXT,
    "estimatedUserShippingFeeCents" INTEGER NOT NULL,
    "actualCarrierCostCents" INTEGER,
    "carrierCode" TEXT,
    "carrierRecordNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryShippingCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryUnitFieldConfig" (
    "id" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "DeliveryUnitFieldType" NOT NULL DEFAULT 'TEXT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "placeholder" TEXT,
    "options" JSONB,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "showInApp" BOOLEAN NOT NULL DEFAULT true,
    "showInAdmin" BOOLEAN NOT NULL DEFAULT true,
    "includeInExport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryUnitFieldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryInventoryLedger" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "type" "DeliveryInventoryLedgerType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "beforeStock" INTEGER,
    "afterStock" INTEGER,
    "refType" TEXT,
    "refId" TEXT,
    "remark" TEXT,
    "createdByType" "DeliveryAuditActorType",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryInventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryCartItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "isSelected" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryCartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryCheckoutSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "addressId" TEXT,
    "status" "DeliveryCheckoutSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "itemsSnapshot" JSONB NOT NULL,
    "unitSnapshot" JSONB NOT NULL,
    "addressSnapshot" JSONB NOT NULL,
    "pricingSnapshot" JSONB,
    "note" TEXT,
    "goodsAmountCents" INTEGER NOT NULL,
    "shippingFeeCents" INTEGER NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "paymentChannel" "DeliveryPaymentChannel",
    "providerTxnId" TEXT,
    "merchantOrderNo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryCheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "checkoutSessionId" TEXT,
    "status" "DeliveryOrderStatus" NOT NULL DEFAULT 'PENDING_SHIPMENT',
    "unitSnapshot" JSONB NOT NULL,
    "addressSnapshot" JSONB NOT NULL,
    "itemsSnapshot" JSONB NOT NULL,
    "pricingSnapshot" JSONB,
    "note" TEXT,
    "goodsAmountCents" INTEGER NOT NULL,
    "shippingFeeCents" INTEGER NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "autoReceiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySubOrder" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" "DeliveryOrderStatus" NOT NULL DEFAULT 'PENDING_SHIPMENT',
    "supplyAmountCents" INTEGER NOT NULL,
    "shippingFeeShareCents" INTEGER NOT NULL DEFAULT 0,
    "totalAmountCents" INTEGER NOT NULL,
    "note" TEXT,
    "lastOperatorStaffId" TEXT,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySubOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "productSnapshot" JSONB NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "supplyUnitPriceCents" INTEGER NOT NULL,
    "baseUnitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineAmountCents" INTEGER NOT NULL,
    "supplyAmountCents" INTEGER NOT NULL,
    "shippingFeeShareCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" "DeliveryPaymentChannel" NOT NULL,
    "scene" "DeliveryPaymentScene" NOT NULL DEFAULT 'APP',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" "DeliveryPaymentStatus" NOT NULL DEFAULT 'INIT',
    "merchantOrderNo" TEXT NOT NULL,
    "providerTxnId" TEXT,
    "requestPayload" JSONB,
    "rawNotifyPayload" JSONB,
    "exceptionSummary" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryShipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "subOrderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" "DeliveryShipmentStatus" NOT NULL DEFAULT 'INIT',
    "carrierCode" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "trackingNo" TEXT,
    "waybillNo" TEXT,
    "waybillUrl" TEXT,
    "sfOrderId" TEXT,
    "senderInfoSnapshot" JSONB,
    "receiverInfoSnapshot" JSONB,
    "rawCarrierPayload" JSONB,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryManifestTemplate" (
    "id" TEXT NOT NULL,
    "type" "DeliveryManifestTemplateType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryManifestTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryManifest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "subOrderId" TEXT,
    "userId" TEXT,
    "unitId" TEXT,
    "merchantId" TEXT,
    "templateId" TEXT NOT NULL,
    "templateVersionId" TEXT,
    "type" "DeliveryManifestTemplateType" NOT NULL,
    "format" "DeliveryManifestFormat" NOT NULL DEFAULT 'PDF',
    "status" "DeliveryManifestStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "fileUrl" TEXT,
    "storageKey" TEXT,
    "payloadSnapshot" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryManifestVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "DeliveryManifestVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
    "config" JSONB NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryManifestVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySettlement" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "subOrderId" TEXT,
    "status" "DeliverySettlementStatus" NOT NULL DEFAULT 'PENDING',
    "settlementMonth" TEXT,
    "supplyAmountCents" INTEGER NOT NULL,
    "settledAmountCents" INTEGER NOT NULL DEFAULT 0,
    "exportFileUrl" TEXT,
    "note" TEXT,
    "markedSettledByAdminId" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryCustomerServiceConversation" (
    "id" TEXT NOT NULL,
    "source" "DeliveryConversationSource" NOT NULL DEFAULT 'APP',
    "status" "DeliveryConversationStatus" NOT NULL DEFAULT 'OPEN',
    "userId" TEXT,
    "unitId" TEXT,
    "orderId" TEXT,
    "subOrderId" TEXT,
    "merchantId" TEXT,
    "assignedAdminId" TEXT,
    "assignedStaffId" TEXT,
    "subject" TEXT,
    "lastMessagePreview" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryCustomerServiceConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryConfig" (
    "id" TEXT NOT NULL,
    "scope" "DeliveryConfigScope" NOT NULL DEFAULT 'SYSTEM',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "DeliveryAuditActorType" NOT NULL,
    "actorId" TEXT,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "diff" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySequence_prefix_key" ON "DeliverySequence"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryUser_phone_key" ON "DeliveryUser"("phone");

-- CreateIndex
CREATE INDEX "DeliveryAuthIdentity_userId_idx" ON "DeliveryAuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAuthIdentity_provider_providerSubject_key" ON "DeliveryAuthIdentity"("provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAdminUser_username_key" ON "DeliveryAdminUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAdminUser_phone_key" ON "DeliveryAdminUser"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySellerStaff_phone_key" ON "DeliverySellerStaff"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySellerStaff_username_key" ON "DeliverySellerStaff"("username");

-- CreateIndex
CREATE INDEX "DeliverySellerStaff_merchantId_role_status_idx" ON "DeliverySellerStaff"("merchantId", "role", "status");

-- CreateIndex
CREATE INDEX "DeliveryUnit_userId_status_createdAt_idx" ON "DeliveryUnit"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAddress_userId_unitId_isDefault_idx" ON "DeliveryAddress"("userId", "unitId", "isDefault");

-- CreateIndex
CREATE INDEX "DeliveryMerchant_status_createdAt_idx" ON "DeliveryMerchant"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryMerchantApplication_status_createdAt_idx" ON "DeliveryMerchantApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryMerchantApplication_contactPhone_idx" ON "DeliveryMerchantApplication"("contactPhone");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryCategory_path_key" ON "DeliveryCategory"("path");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryProductUnit_name_key" ON "DeliveryProductUnit"("name");

-- CreateIndex
CREATE INDEX "DeliveryProduct_merchantId_status_createdAt_idx" ON "DeliveryProduct"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryProduct_categoryId_auditStatus_idx" ON "DeliveryProduct"("categoryId", "auditStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryProductSku_skuCode_key" ON "DeliveryProductSku"("skuCode");

-- CreateIndex
CREATE INDEX "DeliveryPriceRule_scope_isActive_priority_idx" ON "DeliveryPriceRule"("scope", "isActive", "priority");

-- CreateIndex
CREATE INDEX "DeliveryPriceRule_merchantId_productId_skuId_idx" ON "DeliveryPriceRule"("merchantId", "productId", "skuId");

-- CreateIndex
CREATE INDEX "DeliveryShippingRule_merchantId_status_sortOrder_idx" ON "DeliveryShippingRule"("merchantId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "DeliveryShippingCost_checkoutSessionId_idx" ON "DeliveryShippingCost"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "DeliveryShippingCost_orderId_idx" ON "DeliveryShippingCost"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryShippingCost_subOrderId_idx" ON "DeliveryShippingCost"("subOrderId");

-- CreateIndex
CREATE INDEX "DeliveryShippingCost_merchantId_idx" ON "DeliveryShippingCost"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryUnitFieldConfig_fieldKey_key" ON "DeliveryUnitFieldConfig"("fieldKey");

-- CreateIndex
CREATE INDEX "DeliveryInventoryLedger_skuId_createdAt_idx" ON "DeliveryInventoryLedger"("skuId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryInventoryLedger_refType_refId_idx" ON "DeliveryInventoryLedger"("refType", "refId");

-- CreateIndex
CREATE INDEX "DeliveryCartItem_unitId_updatedAt_idx" ON "DeliveryCartItem"("unitId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryCartItem_userId_unitId_skuId_key" ON "DeliveryCartItem"("userId", "unitId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryCheckoutSession_providerTxnId_key" ON "DeliveryCheckoutSession"("providerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryCheckoutSession_merchantOrderNo_key" ON "DeliveryCheckoutSession"("merchantOrderNo");

-- CreateIndex
CREATE INDEX "DeliveryCheckoutSession_userId_unitId_status_idx" ON "DeliveryCheckoutSession"("userId", "unitId", "status");

-- CreateIndex
CREATE INDEX "DeliveryCheckoutSession_status_expiresAt_idx" ON "DeliveryCheckoutSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "DeliveryOrder_userId_unitId_status_createdAt_idx" ON "DeliveryOrder"("userId", "unitId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliverySubOrder_merchantId_status_createdAt_idx" ON "DeliverySubOrder"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliverySubOrder_orderId_idx" ON "DeliverySubOrder"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryOrderItem_orderId_idx" ON "DeliveryOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryOrderItem_subOrderId_idx" ON "DeliveryOrderItem"("subOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPayment_merchantOrderNo_key" ON "DeliveryPayment"("merchantOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPayment_providerTxnId_key" ON "DeliveryPayment"("providerTxnId");

-- CreateIndex
CREATE INDEX "DeliveryPayment_orderId_status_idx" ON "DeliveryPayment"("orderId", "status");

-- CreateIndex
CREATE INDEX "DeliveryShipment_merchantId_status_createdAt_idx" ON "DeliveryShipment"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryShipment_subOrderId_idx" ON "DeliveryShipment"("subOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryManifestTemplate_type_name_key" ON "DeliveryManifestTemplate"("type", "name");

-- CreateIndex
CREATE INDEX "DeliveryManifest_orderId_type_format_idx" ON "DeliveryManifest"("orderId", "type", "format");

-- CreateIndex
CREATE INDEX "DeliveryManifest_subOrderId_type_format_idx" ON "DeliveryManifest"("subOrderId", "type", "format");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryManifestVersion_templateId_versionNo_key" ON "DeliveryManifestVersion"("templateId", "versionNo");

-- CreateIndex
CREATE INDEX "DeliverySettlement_merchantId_status_createdAt_idx" ON "DeliverySettlement"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliverySettlement_subOrderId_idx" ON "DeliverySettlement"("subOrderId");

-- CreateIndex
CREATE INDEX "DeliveryCustomerServiceConversation_status_updatedAt_idx" ON "DeliveryCustomerServiceConversation"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "DeliveryCustomerServiceConversation_userId_unitId_idx" ON "DeliveryCustomerServiceConversation"("userId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryConfig_key_key" ON "DeliveryConfig"("key");

-- CreateIndex
CREATE INDEX "DeliveryAuditLog_module_createdAt_idx" ON "DeliveryAuditLog"("module", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryAuditLog_targetType_targetId_createdAt_idx" ON "DeliveryAuditLog"("targetType", "targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "DeliveryAuthIdentity" ADD CONSTRAINT "DeliveryAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySellerStaff" ADD CONSTRAINT "DeliverySellerStaff_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryUnit" ADD CONSTRAINT "DeliveryUnit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAddress" ADD CONSTRAINT "DeliveryAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAddress" ADD CONSTRAINT "DeliveryAddress_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "DeliveryUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryMerchantApplication" ADD CONSTRAINT "DeliveryMerchantApplication_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "DeliveryAdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryMerchantApplication" ADD CONSTRAINT "DeliveryMerchantApplication_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCategory" ADD CONSTRAINT "DeliveryCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DeliveryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProduct" ADD CONSTRAINT "DeliveryProduct_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProduct" ADD CONSTRAINT "DeliveryProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DeliveryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProduct" ADD CONSTRAINT "DeliveryProduct_productUnitId_fkey" FOREIGN KEY ("productUnitId") REFERENCES "DeliveryProductUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProduct" ADD CONSTRAINT "DeliveryProduct_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "DeliverySellerStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryProductSku" ADD CONSTRAINT "DeliveryProductSku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DeliveryProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPriceRule" ADD CONSTRAINT "DeliveryPriceRule_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPriceRule" ADD CONSTRAINT "DeliveryPriceRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DeliveryProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPriceRule" ADD CONSTRAINT "DeliveryPriceRule_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "DeliveryProductSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShippingRule" ADD CONSTRAINT "DeliveryShippingRule_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShippingCost" ADD CONSTRAINT "DeliveryShippingCost_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "DeliveryCheckoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShippingCost" ADD CONSTRAINT "DeliveryShippingCost_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShippingCost" ADD CONSTRAINT "DeliveryShippingCost_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "DeliverySubOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShippingCost" ADD CONSTRAINT "DeliveryShippingCost_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShippingCost" ADD CONSTRAINT "DeliveryShippingCost_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "DeliveryProductSku"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryInventoryLedger" ADD CONSTRAINT "DeliveryInventoryLedger_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "DeliveryProductSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCartItem" ADD CONSTRAINT "DeliveryCartItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCartItem" ADD CONSTRAINT "DeliveryCartItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "DeliveryUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCartItem" ADD CONSTRAINT "DeliveryCartItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "DeliveryProductSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCheckoutSession" ADD CONSTRAINT "DeliveryCheckoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCheckoutSession" ADD CONSTRAINT "DeliveryCheckoutSession_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "DeliveryUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCheckoutSession" ADD CONSTRAINT "DeliveryCheckoutSession_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "DeliveryAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "DeliveryUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrder" ADD CONSTRAINT "DeliveryOrder_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "DeliveryCheckoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySubOrder" ADD CONSTRAINT "DeliverySubOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySubOrder" ADD CONSTRAINT "DeliverySubOrder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySubOrder" ADD CONSTRAINT "DeliverySubOrder_lastOperatorStaffId_fkey" FOREIGN KEY ("lastOperatorStaffId") REFERENCES "DeliverySellerStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrderItem" ADD CONSTRAINT "DeliveryOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrderItem" ADD CONSTRAINT "DeliveryOrderItem_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "DeliverySubOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrderItem" ADD CONSTRAINT "DeliveryOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "DeliveryProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryOrderItem" ADD CONSTRAINT "DeliveryOrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "DeliveryProductSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPayment" ADD CONSTRAINT "DeliveryPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShipment" ADD CONSTRAINT "DeliveryShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShipment" ADD CONSTRAINT "DeliveryShipment_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "DeliverySubOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryShipment" ADD CONSTRAINT "DeliveryShipment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifest" ADD CONSTRAINT "DeliveryManifest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifest" ADD CONSTRAINT "DeliveryManifest_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "DeliverySubOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifest" ADD CONSTRAINT "DeliveryManifest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifest" ADD CONSTRAINT "DeliveryManifest_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "DeliveryUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifest" ADD CONSTRAINT "DeliveryManifest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifest" ADD CONSTRAINT "DeliveryManifest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DeliveryManifestTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifest" ADD CONSTRAINT "DeliveryManifest_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "DeliveryManifestVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifestVersion" ADD CONSTRAINT "DeliveryManifestVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DeliveryManifestTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryManifestVersion" ADD CONSTRAINT "DeliveryManifestVersion_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "DeliveryAdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySettlement" ADD CONSTRAINT "DeliverySettlement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySettlement" ADD CONSTRAINT "DeliverySettlement_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "DeliverySubOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySettlement" ADD CONSTRAINT "DeliverySettlement_markedSettledByAdminId_fkey" FOREIGN KEY ("markedSettledByAdminId") REFERENCES "DeliveryAdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCustomerServiceConversation" ADD CONSTRAINT "DeliveryCustomerServiceConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCustomerServiceConversation" ADD CONSTRAINT "DeliveryCustomerServiceConversation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "DeliveryUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCustomerServiceConversation" ADD CONSTRAINT "DeliveryCustomerServiceConversation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DeliveryOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCustomerServiceConversation" ADD CONSTRAINT "DeliveryCustomerServiceConversation_subOrderId_fkey" FOREIGN KEY ("subOrderId") REFERENCES "DeliverySubOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCustomerServiceConversation" ADD CONSTRAINT "DeliveryCustomerServiceConversation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "DeliveryMerchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCustomerServiceConversation" ADD CONSTRAINT "DeliveryCustomerServiceConversation_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "DeliveryAdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryCustomerServiceConversation" ADD CONSTRAINT "DeliveryCustomerServiceConversation_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "DeliverySellerStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
