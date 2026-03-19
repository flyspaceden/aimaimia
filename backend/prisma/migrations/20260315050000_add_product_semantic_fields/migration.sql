-- AlterTable
ALTER TABLE "Product" ADD COLUMN "flavorTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "seasonalMonths" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "usageScenarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "dietaryTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "originRegion" TEXT;
