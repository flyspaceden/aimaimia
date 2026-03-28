-- CreateEnum
CREATE TYPE "TagScope" AS ENUM ('COMPANY', 'PRODUCT');

-- CreateTable
CREATE TABLE "TagCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "scope" "TagScope" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagCategory_code_key" ON "TagCategory"("code");

-- Insert default TagCategories for existing TagType values
INSERT INTO "TagCategory" ("id", "name", "code", "scope", "sortOrder", "updatedAt")
VALUES
  ('migrate_product', '商品标签', 'PRODUCT', 'PRODUCT', 0, NOW()),
  ('migrate_company', '企业标签', 'COMPANY', 'COMPANY', 0, NOW()),
  ('migrate_trace', '溯源标签', 'TRACE', 'PRODUCT', 1, NOW()),
  ('migrate_ai', 'AI标签', 'AI', 'PRODUCT', 2, NOW());

-- DropIndex (remove old unique on name)
DROP INDEX "Tag_name_key";

-- AlterTable: add categoryId as nullable first
ALTER TABLE "Tag"
ADD COLUMN "categoryId" TEXT,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill categoryId based on existing type
UPDATE "Tag" SET "categoryId" = 'migrate_product' WHERE "type" = 'PRODUCT';
UPDATE "Tag" SET "categoryId" = 'migrate_company' WHERE "type" = 'COMPANY';
UPDATE "Tag" SET "categoryId" = 'migrate_trace' WHERE "type" = 'TRACE';
UPDATE "Tag" SET "categoryId" = 'migrate_ai' WHERE "type" = 'AI';

-- Fallback: set any remaining NULLs to product category
UPDATE "Tag" SET "categoryId" = 'migrate_product' WHERE "categoryId" IS NULL;

-- Now make categoryId NOT NULL
ALTER TABLE "Tag" ALTER COLUMN "categoryId" SET NOT NULL;

-- Drop old type column
ALTER TABLE "Tag" DROP COLUMN "type";

-- DropEnum
DROP TYPE "TagType";

-- CreateTable
CREATE TABLE "CompanyTag" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "CompanyTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyTag_companyId_idx" ON "CompanyTag"("companyId");

-- CreateIndex
CREATE INDEX "CompanyTag_tagId_idx" ON "CompanyTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyTag_companyId_tagId_key" ON "CompanyTag"("companyId", "tagId");

-- CreateIndex
CREATE INDEX "Tag_categoryId_idx" ON "Tag"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_categoryId_key" ON "Tag"("name", "categoryId");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TagCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTag" ADD CONSTRAINT "CompanyTag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyTag" ADD CONSTRAINT "CompanyTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
