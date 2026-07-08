-- CreateEnum
CREATE TYPE "CaptainApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "CaptainApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "programCode" TEXT NOT NULL DEFAULT 'SEAFOOD_PREPACKAGED',
    "status" "CaptainApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "realName" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "communityScale" TEXT NOT NULL,
    "expectedMonthlyGmv" TEXT NOT NULL,
    "resourceTypes" JSONB NOT NULL,
    "promotionPlan" TEXT NOT NULL,
    "seafoodExperience" TEXT NOT NULL,
    "complianceAccepted" BOOLEAN NOT NULL DEFAULT false,
    "systemSnapshot" JSONB NOT NULL,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "captainProfileUserId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptainApplication_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CaptainApplication" ADD CONSTRAINT "CaptainApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "CaptainApplication_status_createdAt_idx" ON "CaptainApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainApplication_userId_status_createdAt_idx" ON "CaptainApplication"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptainApplication_programCode_status_createdAt_idx" ON "CaptainApplication"("programCode", "status", "createdAt");
