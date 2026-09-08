BEGIN;
-- 银行凭证不进入公开 uploads/OSS；仅通过管理员权限控制的下载接口读取。
CREATE TABLE "FundPrivateProof" (
  id TEXT PRIMARY KEY,
  "adminId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL CHECK ("mimeType" IN ('application/pdf', 'image/png', 'image/jpeg')),
  content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "AdminPermission" (id, code, module, action, description)
VALUES
 ('fund-ledgers-read-v1', 'fund_ledgers:read', 'fund_ledgers', 'read', '查看平台基金逐笔账本'),
 ('industry-funds-read-v1', 'industry_funds:read', 'industry_funds', 'read', '查看公司产业基金账本'),
 ('industry-funds-pay-v1', 'industry_funds:pay', 'industry_funds', 'pay', '登记公司公对公付款及查看凭证'),
 ('industry-funds-reverse-v1', 'industry_funds:reverse', 'industry_funds', 'reverse', '产业基金登记冲正与回款')
ON CONFLICT (code) DO NOTHING;

CREATE TRIGGER fund_private_proof_immutable BEFORE UPDATE OR DELETE ON "FundPrivateProof"
FOR EACH ROW EXECUTE FUNCTION industry_fund_immutable();

COMMIT;
