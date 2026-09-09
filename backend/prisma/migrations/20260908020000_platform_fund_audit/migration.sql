-- Universal audit trail for platform-owned RewardAccount / RewardLedger rows.
--
-- This migration deliberately does not rewrite RewardAccount or RewardLedger.
-- Existing balances are captured as immutable opening snapshots; existing
-- ledgers remain read-only historical evidence, with post-cutover trigger
-- events retained separately by the query service.

BEGIN;
SET LOCAL TIME ZONE 'UTC';

-- An explicit transaction surrounds this migration. These locks make the cutover
-- snapshot and trigger installation an atomic boundary even if this file is
-- executed directly through `prisma db execute`.
LOCK TABLE "RewardAccount" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "RewardLedger" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "PlatformFundOpening" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fundType" VARCHAR(32) NOT NULL,
  "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "openingFrozen" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "openingSequence" BIGINT NOT NULL DEFAULT 0,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" VARCHAR(64) NOT NULL DEFAULT 'PLATFORM_FUND_AUDIT_CUTOVER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformFundOpening_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformFundOpening_fundType_check"
    CHECK ("fundType" IN (
      'PLATFORM_PROFIT', 'CHARITY_FUND', 'TECH_FUND', 'RESERVE_FUND',
      'FUND_POOL', 'POINTS', 'INDUSTRY_FUND'
    )),
  CONSTRAINT "PlatformFundOpening_openingBalance_finite_check"
    CHECK ("openingBalance" = "openingBalance"
      AND "openingBalance" < 'Infinity'::double precision
      AND "openingBalance" > '-Infinity'::double precision),
  CONSTRAINT "PlatformFundOpening_openingFrozen_finite_check"
    CHECK ("openingFrozen" = "openingFrozen"
      AND "openingFrozen" < 'Infinity'::double precision
      AND "openingFrozen" > '-Infinity'::double precision)
);

CREATE UNIQUE INDEX "PlatformFundOpening_accountId_key"
  ON "PlatformFundOpening" ("accountId");
CREATE INDEX "PlatformFundOpening_fundType_capturedAt_idx"
  ON "PlatformFundOpening" ("fundType", "capturedAt");

CREATE TABLE "PlatformFundEvent" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fundType" VARCHAR(32) NOT NULL,
  "eventType" VARCHAR(32) NOT NULL,
  "changeKind" VARCHAR(16) NOT NULL,
  "eventSequence" BIGINT NOT NULL,
  "transactionId" BIGINT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sourceTable" VARCHAR(32) NOT NULL,
  "sourceOperation" VARCHAR(16) NOT NULL,
  "rewardLedgerId" TEXT,
  "allocationId" TEXT,
  "refType" VARCHAR(64),
  "refId" TEXT,
  "sourceLedgerId" TEXT,
  "ledgerEntryTypeBefore" VARCHAR(32),
  "ledgerEntryTypeAfter" VARCHAR(32),
  "ledgerStatusBefore" VARCHAR(32),
  "ledgerStatusAfter" VARCHAR(32),
  "ledgerAmountBefore" DOUBLE PRECISION,
  "ledgerAmountAfter" DOUBLE PRECISION,
  "ledgerAmountDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "moneyDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "balanceDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "frozenDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "balanceAfter" DOUBLE PRECISION,
  "frozenAfter" DOUBLE PRECISION,
  "metaSnapshot" JSONB,
  "oldState" JSONB,
  "newState" JSONB,
  CONSTRAINT "PlatformFundEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformFundEvent_fundType_check"
    CHECK ("fundType" IN (
      'PLATFORM_PROFIT', 'CHARITY_FUND', 'TECH_FUND', 'RESERVE_FUND',
      'FUND_POOL', 'POINTS', 'INDUSTRY_FUND'
    )),
  CONSTRAINT "PlatformFundEvent_eventType_check"
    CHECK ("eventType" IN (
      'ACCOUNT_CREATED', 'ACCOUNT_UPDATED', 'ACCOUNT_REMOVED',
      'LEDGER_CREATED', 'LEDGER_UPDATED', 'LEDGER_REMOVED'
    )),
  CONSTRAINT "PlatformFundEvent_changeKind_check"
    CHECK ("changeKind" IN ('MONEY', 'STATE')),
  CONSTRAINT "PlatformFundEvent_ledgerAmount_finite_check"
    CHECK (
      ("ledgerAmountBefore" IS NULL OR ("ledgerAmountBefore" = "ledgerAmountBefore"
        AND "ledgerAmountBefore" < 'Infinity'::double precision
        AND "ledgerAmountBefore" > '-Infinity'::double precision))
      AND ("ledgerAmountAfter" IS NULL OR "ledgerAmountAfter" = "ledgerAmountAfter"
        AND "ledgerAmountAfter" < 'Infinity'::double precision
        AND "ledgerAmountAfter" > '-Infinity'::double precision)
      AND "ledgerAmountDelta" = "ledgerAmountDelta"
      AND "ledgerAmountDelta" < 'Infinity'::double precision
      AND "ledgerAmountDelta" > '-Infinity'::double precision
      AND "moneyDelta" = "moneyDelta"
      AND "moneyDelta" < 'Infinity'::double precision
      AND "moneyDelta" > '-Infinity'::double precision
    ),
  CONSTRAINT "PlatformFundEvent_accountDelta_finite_check"
    CHECK (
      "balanceDelta" = "balanceDelta"
      AND "balanceDelta" < 'Infinity'::double precision
      AND "balanceDelta" > '-Infinity'::double precision
      AND "frozenDelta" = "frozenDelta"
      AND "frozenDelta" < 'Infinity'::double precision
      AND "frozenDelta" > '-Infinity'::double precision
      AND ("balanceAfter" IS NULL OR ("balanceAfter" = "balanceAfter"
        AND "balanceAfter" < 'Infinity'::double precision
        AND "balanceAfter" > '-Infinity'::double precision))
      AND ("frozenAfter" IS NULL OR ("frozenAfter" = "frozenAfter"
        AND "frozenAfter" < 'Infinity'::double precision
        AND "frozenAfter" > '-Infinity'::double precision))
  )
);

CREATE UNIQUE INDEX "PlatformFundEvent_accountId_eventSequence_key"
  ON "PlatformFundEvent" ("accountId", "eventSequence");
CREATE UNIQUE INDEX "PlatformFundEvent_idempotencyKey_key"
  ON "PlatformFundEvent" ("idempotencyKey");
CREATE INDEX "PlatformFundEvent_fundType_occurredAt_id_idx"
  ON "PlatformFundEvent" ("fundType", "occurredAt" DESC, "id" DESC);
CREATE INDEX "PlatformFundEvent_accountId_eventSequence_idx"
  ON "PlatformFundEvent" ("accountId", "eventSequence");
CREATE INDEX "PlatformFundEvent_accountId_transactionId_idx"
  ON "PlatformFundEvent" ("accountId", "transactionId", "eventSequence");
CREATE INDEX "PlatformFundEvent_rewardLedgerId_idx"
  ON "PlatformFundEvent" ("rewardLedgerId");
CREATE INDEX "PlatformFundEvent_refId_idx"
  ON "PlatformFundEvent" ("refId");

COMMENT ON TABLE "PlatformFundOpening" IS
  'Immutable cutover balance for a platform RewardAccount; not a second wallet.';
COMMENT ON TABLE "PlatformFundEvent" IS
  'Transactional audit events for platform-owned RewardAccount/RewardLedger rows.';
COMMENT ON COLUMN "PlatformFundEvent"."moneyDelta" IS
  'Signed net RewardAccount balance+frozen movement. Ledger rows retain source amounts separately and are not counted here.';
COMMENT ON COLUMN "PlatformFundEvent"."balanceDelta" IS
  'RewardAccount.balance delta; combine with frozenDelta for the net monetary movement.';

-- Capture the pre-trigger opening snapshot without touching the source tables.
-- The unique account key keeps this safe if a deployment is retried.
INSERT INTO "PlatformFundOpening" (
  "id", "accountId", "fundType", "openingBalance", "openingFrozen",
  "openingSequence", "capturedAt", "source", "createdAt"
)
SELECT
  'pfo_' || md5(ra."id" || ':20260908020000'),
  ra."id",
  ra."type"::text,
  ra."balance",
  ra."frozen",
  0,
  CURRENT_TIMESTAMP,
  'PLATFORM_FUND_AUDIT_CUTOVER',
  CURRENT_TIMESTAMP
FROM "RewardAccount" ra
WHERE ra."userId" = 'PLATFORM'
  AND ra."type"::text IN (
    'PLATFORM_PROFIT', 'CHARITY_FUND', 'TECH_FUND', 'RESERVE_FUND',
    'FUND_POOL', 'POINTS', 'INDUSTRY_FUND'
  )
ON CONFLICT ("accountId") DO NOTHING;

CREATE OR REPLACE FUNCTION "platform_fund_is_type"(p_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_type IN (
    'PLATFORM_PROFIT', 'CHARITY_FUND', 'TECH_FUND', 'RESERVE_FUND',
    'FUND_POOL', 'POINTS', 'INDUSTRY_FUND'
  )
$$;

CREATE OR REPLACE FUNCTION "platform_fund_account_type"(p_account_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN ra."userId" = 'PLATFORM' AND "platform_fund_is_type"(ra."type"::text)
      THEN ra."type"::text
    ELSE NULL
  END
  FROM "RewardAccount" ra
  WHERE ra."id" = p_account_id
$$;

CREATE OR REPLACE FUNCTION "platform_fund_ensure_opening"(
  p_account_id TEXT,
  p_fund_type TEXT,
  p_balance DOUBLE PRECISION,
  p_frozen DOUBLE PRECISION
)
RETURNS VOID
LANGUAGE plpgsql
SET timezone = 'UTC'
AS $$
BEGIN
  INSERT INTO "PlatformFundOpening" (
    "id", "accountId", "fundType", "openingBalance", "openingFrozen",
    "openingSequence", "capturedAt", "source", "createdAt"
  ) VALUES (
    'pfo_' || md5(p_account_id || ':first-seen'),
    p_account_id,
    p_fund_type,
    COALESCE(p_balance, 0),
    COALESCE(p_frozen, 0),
    0,
    CURRENT_TIMESTAMP,
    'PLATFORM_FUND_AUDIT_FIRST_SEEN',
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("accountId") DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION "platform_fund_effective_ledger_amount"(
  p_entry_type TEXT,
  p_amount DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_entry_type IN ('WITHDRAW', 'DEDUCT') THEN -ABS(COALESCE(p_amount, 0))
    WHEN p_entry_type = 'VOID' AND COALESCE(p_amount, 0) > 0 THEN -ABS(COALESCE(p_amount, 0))
    ELSE COALESCE(p_amount, 0)
  END
$$;

CREATE OR REPLACE FUNCTION "platform_fund_write_event"(
  p_account_id TEXT,
  p_fund_type TEXT,
  p_event_type TEXT,
  p_change_kind TEXT,
  p_idempotency_key TEXT,
  p_occurred_at TIMESTAMP(3),
  p_source_table TEXT,
  p_source_operation TEXT,
  p_reward_ledger_id TEXT,
  p_allocation_id TEXT,
  p_ref_type TEXT,
  p_ref_id TEXT,
  p_source_ledger_id TEXT,
  p_ledger_entry_type_before TEXT,
  p_ledger_entry_type_after TEXT,
  p_ledger_status_before TEXT,
  p_ledger_status_after TEXT,
  p_ledger_amount_before DOUBLE PRECISION,
  p_ledger_amount_after DOUBLE PRECISION,
  p_ledger_amount_delta DOUBLE PRECISION,
  p_money_delta DOUBLE PRECISION,
  p_balance_delta DOUBLE PRECISION,
  p_frozen_delta DOUBLE PRECISION,
  p_balance_after DOUBLE PRECISION,
  p_frozen_after DOUBLE PRECISION,
  p_meta_snapshot JSONB,
  p_old_state JSONB,
  p_new_state JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SET timezone = 'UTC'
AS $$
DECLARE
  v_sequence BIGINT;
  v_event_id TEXT;
BEGIN
  IF p_account_id IS NULL OR p_fund_type IS NULL OR NOT "platform_fund_is_type"(p_fund_type) THEN
    RETURN;
  END IF;

  -- 所有来源先锁账户再锁序号，避免 ledger→advisory→account 与 account→advisory 的锁顺序倒置。
  -- NO KEY UPDATE 与 RewardLedger 外键持有的 KEY SHARE 兼容。
  PERFORM 1 FROM "RewardAccount" WHERE id = p_account_id FOR NO KEY UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id, 0));
  PERFORM "platform_fund_ensure_opening"(
    p_account_id,
    p_fund_type,
    p_balance_after,
    p_frozen_after
  );

  SELECT COALESCE(MAX("eventSequence"), 0) + 1
    INTO v_sequence
  FROM "PlatformFundEvent"
  WHERE "accountId" = p_account_id;

  -- A transaction rollback removes the complete audit unit. The transaction
  -- id + account sequence therefore identifies one physical row transition
  -- without collapsing legitimate A→B→A→B cycles on the same Reward row.
  -- The account sequence is the authoritative de-duplication boundary.
  p_idempotency_key := p_idempotency_key || ':tx:' || txid_current()::text
    || ':seq:' || v_sequence::text;
  v_event_id := 'pfe_' || md5(p_idempotency_key);

  INSERT INTO "PlatformFundEvent" (
    "id", "accountId", "fundType", "eventType", "changeKind", "eventSequence", "transactionId",
    "idempotencyKey", "occurredAt", "recordedAt", "sourceTable", "sourceOperation",
    "rewardLedgerId", "allocationId", "refType", "refId", "sourceLedgerId",
    "ledgerEntryTypeBefore", "ledgerEntryTypeAfter", "ledgerStatusBefore", "ledgerStatusAfter",
    "ledgerAmountBefore", "ledgerAmountAfter", "ledgerAmountDelta", "moneyDelta",
    "balanceDelta", "frozenDelta", "balanceAfter", "frozenAfter", "metaSnapshot",
    "oldState", "newState"
  ) VALUES (
    v_event_id, p_account_id, p_fund_type, p_event_type, p_change_kind, v_sequence,
    txid_current(),
    p_idempotency_key, COALESCE(p_occurred_at, clock_timestamp()::timestamp(3)), clock_timestamp()::timestamp(3),
    p_source_table, p_source_operation, p_reward_ledger_id, p_allocation_id,
    p_ref_type, p_ref_id, p_source_ledger_id, p_ledger_entry_type_before,
    p_ledger_entry_type_after, p_ledger_status_before, p_ledger_status_after,
    p_ledger_amount_before, p_ledger_amount_after, COALESCE(p_ledger_amount_delta, 0),
    COALESCE(p_money_delta, 0), COALESCE(p_balance_delta, 0), COALESCE(p_frozen_delta, 0),
    p_balance_after, p_frozen_after, p_meta_snapshot, p_old_state, p_new_state
  )
  ON CONFLICT ("idempotencyKey") DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION "platform_fund_reward_account_audit"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET timezone = 'UTC'
AS $$
DECLARE
  v_old_type TEXT;
  v_new_type TEXT;
  v_key TEXT;
  v_kind TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_type := CASE
      WHEN NEW."userId" = 'PLATFORM' AND "platform_fund_is_type"(NEW."type"::text)
        THEN NEW."type"::text
      ELSE NULL
    END;
    IF v_new_type IS NULL THEN RETURN NEW; END IF;

    PERFORM "platform_fund_ensure_opening"(NEW."id", v_new_type, NEW."balance", NEW."frozen");
    v_key := format(
      'platform-fund:RewardAccount:%s:INSERT:%s',
      NEW."id",
      md5(row_to_json(NEW)::text)
    );
    PERFORM "platform_fund_write_event"(
      NEW."id", v_new_type, 'ACCOUNT_CREATED'::text, 'STATE'::text, v_key, clock_timestamp()::timestamp(3),
      'RewardAccount'::text, 'INSERT'::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::double precision, NULL::double precision,
      0::double precision, 0::double precision, 0::double precision, 0::double precision,
      NEW."balance", NEW."frozen", NULL::jsonb,
      jsonb_build_object('userId', NEW."userId", 'type', NEW."type"::text),
      jsonb_build_object('userId', NEW."userId", 'type', NEW."type"::text,
        'balance', NEW."balance", 'frozen', NEW."frozen")
    );
    RETURN NEW;
  END IF;

  v_old_type := CASE
    WHEN OLD."userId" = 'PLATFORM' AND "platform_fund_is_type"(OLD."type"::text)
      THEN OLD."type"::text
    ELSE NULL
  END;
  v_new_type := CASE
    WHEN TG_OP = 'UPDATE'
      AND NEW."userId" = 'PLATFORM'
      AND "platform_fund_is_type"(NEW."type"::text)
      THEN NEW."type"::text
    ELSE NULL
  END;

  -- The audit stream is keyed by the account identity and fund type. There is
  -- no supported cross-fund migration in this release; fail closed rather
  -- than leaving an opening snapshot that cannot reconstruct either stream.
  IF TG_OP = 'UPDATE'
     AND (v_old_type IS NOT NULL OR v_new_type IS NOT NULL)
     AND (OLD."userId" IS DISTINCT FROM NEW."userId"
       OR OLD."type" IS DISTINCT FROM NEW."type") THEN
    RAISE EXCEPTION 'platform fund account identity cannot change after creation'
      USING ERRCODE = '55000';
  END IF;

  IF v_old_type IS NULL AND v_new_type IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' OR (v_old_type IS NOT NULL AND v_new_type IS NULL) THEN
    PERFORM "platform_fund_ensure_opening"(OLD."id", v_old_type, OLD."balance", OLD."frozen");
    v_key := format(
      'platform-fund:RewardAccount:%s:REMOVE:%s',
      OLD."id",
      md5(row_to_json(OLD)::text)
    );
    PERFORM "platform_fund_write_event"(
      OLD."id", v_old_type, 'ACCOUNT_REMOVED',
      CASE WHEN OLD."balance" + OLD."frozen" <> 0 THEN 'MONEY' ELSE 'STATE' END,
      v_key, clock_timestamp()::timestamp(3),
      'RewardAccount'::text, TG_OP::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::double precision, NULL::double precision,
      0::double precision, -(OLD."balance" + OLD."frozen"), -OLD."balance", -OLD."frozen",
      0::double precision, 0::double precision, NULL::jsonb,
      jsonb_build_object('userId', OLD."userId", 'type', OLD."type"::text,
        'balance', OLD."balance", 'frozen', OLD."frozen"), NULL::jsonb
    );
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;

  IF v_new_type IS NOT NULL THEN
    PERFORM "platform_fund_ensure_opening"(NEW."id", v_new_type, NEW."balance", NEW."frozen");
    v_kind := CASE
      WHEN v_old_type IS NULL OR v_old_type <> v_new_type THEN 'ACCOUNT_CREATED'
      ELSE 'ACCOUNT_UPDATED'
    END;
    v_key := format(
      'platform-fund:RewardAccount:%s:%s:%s',
      NEW."id", TG_OP, md5(row_to_json(OLD)::text || ':' || row_to_json(NEW)::text)
    );
    PERFORM "platform_fund_write_event"(
      NEW."id", v_new_type, v_kind,
      CASE WHEN v_old_type = v_new_type
        AND (NEW."balance" - OLD."balance") + (NEW."frozen" - OLD."frozen") <> 0
        THEN 'MONEY' ELSE 'STATE' END,
      v_key, clock_timestamp()::timestamp(3),
      'RewardAccount'::text, TG_OP::text,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::double precision, NULL::double precision,
      0::double precision,
      CASE WHEN v_old_type = v_new_type
        THEN (NEW."balance" - OLD."balance") + (NEW."frozen" - OLD."frozen")
        ELSE 0 END,
      CASE WHEN v_old_type = v_new_type THEN NEW."balance" - OLD."balance" ELSE 0 END,
      CASE WHEN v_old_type = v_new_type THEN NEW."frozen" - OLD."frozen" ELSE 0 END,
      NEW."balance", NEW."frozen",
      NULL::jsonb,
      jsonb_build_object('userId', OLD."userId", 'type', OLD."type"::text,
        'balance', OLD."balance", 'frozen', OLD."frozen"),
      jsonb_build_object('userId', NEW."userId", 'type', NEW."type"::text,
        'balance', NEW."balance", 'frozen', NEW."frozen")
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "platform_fund_reward_ledger_audit"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET timezone = 'UTC'
AS $$
DECLARE
  v_old_type TEXT;
  v_new_type TEXT;
  v_amount_delta DOUBLE PRECISION;
  v_money_delta DOUBLE PRECISION;
  v_key TEXT;
  v_event_type TEXT;
  v_change_kind TEXT;
  v_old_state JSONB;
  v_new_state JSONB;
  v_old_meta JSONB;
  v_new_meta JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_type := "platform_fund_account_type"(OLD."accountId");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_type := "platform_fund_account_type"(NEW."accountId");
  END IF;

  v_old_state := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object(
    'accountId', OLD."accountId", 'userId', OLD."userId", 'entryType', OLD."entryType"::text,
    'amount', OLD."amount", 'status', OLD."status"::text, 'refType', OLD."refType",
    'refId', OLD."refId", 'allocationId', OLD."allocationId", 'sourceLedgerId', OLD."sourceLedgerId",
    'idempotencyKey', OLD."idempotencyKey", 'meta', OLD."meta"
  ) END;
  v_new_state := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object(
    'accountId', NEW."accountId", 'userId', NEW."userId", 'entryType', NEW."entryType"::text,
    'amount', NEW."amount", 'status', NEW."status"::text, 'refType', NEW."refType",
    'refId', NEW."refId", 'allocationId', NEW."allocationId", 'sourceLedgerId', NEW."sourceLedgerId",
    'idempotencyKey', NEW."idempotencyKey", 'meta', NEW."meta"
  ) END;

  v_old_meta := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."meta" END;
  v_new_meta := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."meta" END;

  -- INSERT/DELETE is a source money event. On UPDATE only an amount or
  -- effective entry type change changes money; status/ref/meta-only changes
  -- are state evidence and must not inflate fund totals.
  IF TG_OP = 'INSERT' THEN
    v_amount_delta := NEW."amount";
    v_money_delta := "platform_fund_effective_ledger_amount"(NEW."entryType"::text, NEW."amount");
    v_event_type := 'LEDGER_CREATED';
    v_change_kind := CASE WHEN v_money_delta <> 0 THEN 'MONEY' ELSE 'STATE' END;
    IF v_new_type IS NULL THEN RETURN NEW; END IF;
    PERFORM "platform_fund_ensure_opening"(NEW."accountId", v_new_type, NULL, NULL);
    v_key := format(
      'platform-fund:RewardLedger:%s:INSERT:%s', NEW."id", md5(v_new_state::text)
    );
    PERFORM "platform_fund_write_event"(
      NEW."accountId", v_new_type, v_event_type, v_change_kind, v_key, clock_timestamp()::timestamp(3),
      'RewardLedger'::text, 'INSERT'::text, NEW."id", NEW."allocationId", NEW."refType", NEW."refId",
      NEW."sourceLedgerId", NULL::text, NEW."entryType"::text, NULL::text, NEW."status"::text,
      NULL::double precision, NEW."amount", v_amount_delta, 0::double precision,
      0::double precision, 0::double precision, NULL::double precision, NULL::double precision, v_new_meta,
      NULL, v_new_state
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_amount_delta := -OLD."amount";
    v_money_delta := -"platform_fund_effective_ledger_amount"(OLD."entryType"::text, OLD."amount");
    v_event_type := 'LEDGER_REMOVED';
    v_change_kind := CASE WHEN v_money_delta <> 0 THEN 'MONEY' ELSE 'STATE' END;
    IF v_old_type IS NULL THEN RETURN OLD; END IF;
    PERFORM "platform_fund_ensure_opening"(OLD."accountId", v_old_type, NULL, NULL);
    v_key := format(
      'platform-fund:RewardLedger:%s:DELETE:%s', OLD."id", md5(v_old_state::text)
    );
    PERFORM "platform_fund_write_event"(
      OLD."accountId", v_old_type, v_event_type, v_change_kind, v_key, clock_timestamp()::timestamp(3),
      'RewardLedger'::text, 'DELETE'::text, OLD."id", OLD."allocationId", OLD."refType", OLD."refId",
      OLD."sourceLedgerId", OLD."entryType"::text, NULL::text, OLD."status"::text, NULL::text,
      OLD."amount", NULL::double precision, v_amount_delta, 0::double precision,
      0::double precision, 0::double precision, NULL::double precision, NULL::double precision, v_old_meta,
      v_old_state, NULL
    );
    RETURN OLD;
  END IF;

  -- UPDATE. A moved row is represented as a removal + creation on the two
  -- affected account streams so each account's reconstruction remains valid.
  IF v_old_type IS NOT NULL AND (v_new_type IS NULL OR OLD."accountId" <> NEW."accountId" OR v_old_type <> v_new_type) THEN
    v_money_delta := -"platform_fund_effective_ledger_amount"(OLD."entryType"::text, OLD."amount");
    v_key := format(
      'platform-fund:RewardLedger:%s:MOVE_OLD:%s', OLD."id", md5(v_old_state::text || ':' || v_new_state::text)
    );
    PERFORM "platform_fund_write_event"(
      OLD."accountId", v_old_type, 'LEDGER_REMOVED',
      CASE WHEN v_money_delta <> 0 THEN 'MONEY'::text ELSE 'STATE'::text END, v_key, clock_timestamp()::timestamp(3),
      'RewardLedger'::text, 'UPDATE'::text, OLD."id", OLD."allocationId", OLD."refType", OLD."refId",
      OLD."sourceLedgerId", OLD."entryType"::text, NULL::text, OLD."status"::text, NULL::text,
      OLD."amount", NULL::double precision, -OLD."amount", 0::double precision,
      0::double precision, 0::double precision, NULL::double precision, NULL::double precision, v_old_meta,
      v_old_state, v_new_state
    );
  END IF;

  IF v_new_type IS NOT NULL AND (v_old_type IS NULL OR OLD."accountId" <> NEW."accountId" OR v_old_type <> v_new_type) THEN
    v_money_delta := "platform_fund_effective_ledger_amount"(NEW."entryType"::text, NEW."amount");
    v_key := format(
      'platform-fund:RewardLedger:%s:MOVE_NEW:%s', NEW."id", md5(v_old_state::text || ':' || v_new_state::text)
    );
    PERFORM "platform_fund_ensure_opening"(NEW."accountId", v_new_type, NULL, NULL);
    PERFORM "platform_fund_write_event"(
      NEW."accountId", v_new_type, 'LEDGER_CREATED',
      CASE WHEN v_money_delta <> 0 THEN 'MONEY'::text ELSE 'STATE'::text END, v_key, clock_timestamp()::timestamp(3),
      'RewardLedger'::text, 'UPDATE'::text, NEW."id", NEW."allocationId", NEW."refType", NEW."refId",
      NEW."sourceLedgerId", NULL::text, NEW."entryType"::text, NULL::text, NEW."status"::text,
      NULL::double precision, NEW."amount", NEW."amount", 0::double precision,
      0::double precision, 0::double precision, NULL::double precision, NULL::double precision, v_new_meta,
      v_old_state, v_new_state
    );
    RETURN NEW;
  END IF;

  IF v_new_type IS NULL THEN RETURN NEW; END IF;
  v_amount_delta := NEW."amount" - OLD."amount";
  v_money_delta := "platform_fund_effective_ledger_amount"(NEW."entryType"::text, NEW."amount")
    - "platform_fund_effective_ledger_amount"(OLD."entryType"::text, OLD."amount");
  v_event_type := 'LEDGER_UPDATED';
  v_change_kind := CASE WHEN v_money_delta <> 0 THEN 'MONEY' ELSE 'STATE' END;
  v_key := format(
    'platform-fund:RewardLedger:%s:UPDATE:%s', NEW."id", md5(v_old_state::text || ':' || v_new_state::text)
  );
  PERFORM "platform_fund_write_event"(
    NEW."accountId", v_new_type, v_event_type, v_change_kind, v_key, clock_timestamp()::timestamp(3),
      'RewardLedger'::text, 'UPDATE'::text, NEW."id", NEW."allocationId", NEW."refType", NEW."refId",
    NEW."sourceLedgerId", OLD."entryType"::text, NEW."entryType"::text,
    OLD."status"::text, NEW."status"::text, OLD."amount", NEW."amount", v_amount_delta,
    0::double precision, 0::double precision, 0::double precision,
    NULL::double precision, NULL::double precision, COALESCE(v_new_meta, v_old_meta), v_old_state, v_new_state
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "platform_fund_immutable_guard"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET timezone = 'UTC'
AS $$
BEGIN
  RAISE EXCEPTION 'platform fund audit rows are immutable: %.%', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS "platform_fund_opening_immutable_trigger" ON "PlatformFundOpening";
CREATE TRIGGER "platform_fund_opening_immutable_trigger"
BEFORE UPDATE OR DELETE ON "PlatformFundOpening"
FOR EACH ROW EXECUTE FUNCTION "platform_fund_immutable_guard"();

DROP TRIGGER IF EXISTS "platform_fund_event_immutable_trigger" ON "PlatformFundEvent";
CREATE TRIGGER "platform_fund_event_immutable_trigger"
BEFORE UPDATE OR DELETE ON "PlatformFundEvent"
FOR EACH ROW EXECUTE FUNCTION "platform_fund_immutable_guard"();

DROP TRIGGER IF EXISTS "platform_fund_reward_account_audit_trigger" ON "RewardAccount";
CREATE TRIGGER "platform_fund_reward_account_audit_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "RewardAccount"
FOR EACH ROW EXECUTE FUNCTION "platform_fund_reward_account_audit"();

DROP TRIGGER IF EXISTS "platform_fund_reward_ledger_audit_trigger" ON "RewardLedger";
CREATE TRIGGER "platform_fund_reward_ledger_audit_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "RewardLedger"
FOR EACH ROW EXECUTE FUNCTION "platform_fund_reward_ledger_audit"();

COMMIT;
