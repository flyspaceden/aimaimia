-- CreateEnum
CREATE TYPE "DeliveryOtpPurpose" AS ENUM ('LOGIN');

-- AlterTable
ALTER TABLE "DeliveryUser" ADD COLUMN "currentUnitId" TEXT;

-- AlterTable
ALTER TABLE "DeliveryUnitFieldConfig"
ADD COLUMN "includeInExcel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "includeInPdf" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DeliveryPhoneOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "phone" TEXT NOT NULL,
    "purpose" "DeliveryOtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPhoneOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPhoneOtpAttempt" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" "DeliveryOtpPurpose" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryPhoneOtpAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryUserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loginMethod" "DeliveryAuthProvider" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryUserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryPhoneOtp_phone_purpose_expiresAt_idx" ON "DeliveryPhoneOtp"("phone", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "DeliveryPhoneOtp_userId_purpose_createdAt_idx" ON "DeliveryPhoneOtp"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryPhoneOtpAttempt_phone_purpose_createdAt_idx" ON "DeliveryPhoneOtpAttempt"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryPhoneOtpAttempt_phone_purpose_ip_createdAt_idx" ON "DeliveryPhoneOtpAttempt"("phone", "purpose", "ip", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryUserSession_userId_expiresAt_idx" ON "DeliveryUserSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "DeliveryUserSession_expiresAt_idx" ON "DeliveryUserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "DeliveryUserSession_userId_revokedAt_idx" ON "DeliveryUserSession"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "DeliveryUser" ADD CONSTRAINT "DeliveryUser_currentUnitId_fkey" FOREIGN KEY ("currentUnitId") REFERENCES "DeliveryUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPhoneOtp" ADD CONSTRAINT "DeliveryPhoneOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryUserSession" ADD CONSTRAINT "DeliveryUserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "DeliveryUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
