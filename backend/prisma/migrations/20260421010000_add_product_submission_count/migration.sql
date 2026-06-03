-- 商品审核提交次数（REJECTED/APPROVED 后卖家编辑重新提交时 +1）
ALTER TABLE "Product" ADD COLUMN "submissionCount" INTEGER NOT NULL DEFAULT 1;
