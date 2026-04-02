-- F4: 平台公司标记字段
ALTER TABLE "Company" ADD COLUMN "isPlatform" BOOLEAN NOT NULL DEFAULT false;

-- 将已有的平台公司标记为 isPlatform = true
UPDATE "Company" SET "isPlatform" = true WHERE id = 'PLATFORM_COMPANY';
