-- Rename RewardAccountType enum values to match current schema
ALTER TYPE "RewardAccountType" RENAME VALUE 'RED_PACKET' TO 'VIP_REWARD';
ALTER TYPE "RewardAccountType" RENAME VALUE 'NORMAL_RED_PACKET' TO 'NORMAL_REWARD';
