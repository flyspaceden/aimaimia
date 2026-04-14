-- C17: Seller employee password login (set by OWNER when creating staff)
-- C18: Admin phone + SMS login

-- AlterTable: add phone to AdminUser (nullable + unique)
ALTER TABLE "AdminUser" ADD COLUMN "phone" TEXT;
CREATE UNIQUE INDEX "AdminUser_phone_key" ON "AdminUser"("phone");

-- AlterTable: add passwordHash to CompanyStaff (nullable for legacy SMS-only staff)
ALTER TABLE "CompanyStaff" ADD COLUMN "passwordHash" TEXT;
