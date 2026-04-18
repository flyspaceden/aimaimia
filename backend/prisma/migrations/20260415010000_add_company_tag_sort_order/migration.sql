-- AlterTable: CompanyTag 补 sortOrder 字段（schema 已有，migration 之前未同步）
ALTER TABLE "CompanyTag" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
