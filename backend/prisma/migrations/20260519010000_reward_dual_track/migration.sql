-- Reward dual-track foundation: ADD ENUM VALUES only.
-- PostgreSQL 不允许在同一 transaction 内 ADD VALUE 并立刻使用该 enum 值（55P04）。
-- 故 enum 改动单独成文件，下一个 migration（_columns）再用新值做 default。

-- AlterEnum
ALTER TYPE "WithdrawStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "RewardEntryType" ADD VALUE IF NOT EXISTS 'DEDUCT';
