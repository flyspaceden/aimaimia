BEGIN;
ALTER TABLE industry_fund_ledgers ADD COLUMN sequence BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX industry_fund_ledgers_sequence_key ON industry_fund_ledgers(sequence);
-- 历史 Reward 表不变。新公司账户/计提/付款项在数据库层拒绝负数和非有限金额。
DO $$
DECLARE t TEXT; c TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['industry_fund_accounts','industry_fund_accruals','industry_fund_payment_items','industry_fund_recoveries','industry_fund_recovery_items'] LOOP
    FOR c IN SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = t AND data_type = 'double precision'
    LOOP
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I >= 0 AND %I < ''Infinity''::float8)', t, t || '_' || c || '_nonnegative', c, c);
    END LOOP;
  END LOOP;
END $$;
CREATE FUNCTION industry_fund_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '产业基金历史记录不可覆盖或删除，请追加冲正流水'; END $$;
CREATE TRIGGER industry_fund_ledger_immutable BEFORE UPDATE OR DELETE ON industry_fund_ledgers
FOR EACH ROW EXECUTE FUNCTION industry_fund_immutable();
CREATE TRIGGER industry_fund_recovery_immutable BEFORE UPDATE OR DELETE ON industry_fund_recoveries
FOR EACH ROW EXECUTE FUNCTION industry_fund_immutable();
CREATE TRIGGER industry_fund_recovery_item_immutable BEFORE UPDATE OR DELETE ON industry_fund_recovery_items
FOR EACH ROW EXECUTE FUNCTION industry_fund_immutable();

-- 待归属也是平台托管事实，售后冲回必须保留前后快照，不能只有可变余额。
CREATE TABLE "IndustryFundUnassignedEvent" (
 id BIGSERIAL PRIMARY KEY,
 "entryId" TEXT NOT NULL,
 "orderId" TEXT NOT NULL,
 "beforeState" JSONB,
 "afterState" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "IndustryFundUnassignedEvent_entryId_id_idx" ON "IndustryFundUnassignedEvent" ("entryId", id);
CREATE FUNCTION industry_fund_unassigned_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO "IndustryFundUnassignedEvent" ("entryId", "orderId", "beforeState", "afterState")
 VALUES (NEW.id, NEW."orderId", CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END, to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER industry_fund_unassigned_audit AFTER INSERT OR UPDATE ON industry_fund_unassigned_entries
FOR EACH ROW EXECUTE FUNCTION industry_fund_unassigned_audit();
CREATE TRIGGER industry_fund_unassigned_no_delete BEFORE DELETE ON industry_fund_unassigned_entries
FOR EACH ROW EXECUTE FUNCTION industry_fund_immutable();
CREATE TRIGGER industry_fund_unassigned_event_immutable BEFORE UPDATE OR DELETE ON "IndustryFundUnassignedEvent"
FOR EACH ROW EXECUTE FUNCTION industry_fund_immutable();
COMMIT;
