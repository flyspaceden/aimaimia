import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Platform-owned RewardAccount types that form the independent fund views. */
export const PLATFORM_FUND_TYPES = [
  'PLATFORM_PROFIT',
  'CHARITY_FUND',
  'TECH_FUND',
  'RESERVE_FUND',
  'FUND_POOL',
  'POINTS',
  'INDUSTRY_FUND',
] as const;

export type PlatformFundType = (typeof PLATFORM_FUND_TYPES)[number];
export type PlatformFundSourceType = 'NORMAL' | 'VIP' | 'LEGACY';

type FundQuery = {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  sourceType?: string;
  orderId?: string;
  companyId?: string;
  eventType?: string;
  status?: string;
  search?: string;
};

type DateRange = { from?: Date; to?: Date; fromTimestamp?: string; toTimestamp?: string };

type RawSummaryRow = {
  fundType: string;
  initialBalance: number | null;
  initialFrozen: number | null;
  cutoverBalance: number | null;
  cutoverFrozen: number | null;
  periodIncome: number | null;
  periodExpense: number | null;
  netMovement: number | null;
  allTimeNetMovement: number | null;
  currentBalance: number | null;
  currentFrozen: number | null;
  reconstructedTotal: number | null;
  currentTotal: number | null;
  lastEntryAt: Date | null;
};

type RawEntryRow = {
  id: string;
  accountId: string;
  fundType: string;
  auditEventType: string;
  logicalEventType: string;
  changeKind: string;
  eventSequence: bigint | number | null;
  transactionId: bigint | number | null;
  occurredAt: Date;
  recordedAt: Date;
  sourceTable: string;
  sourceOperation: string;
  rewardLedgerId: string | null;
  allocationId: string | null;
  sourceLedgerId: string | null;
  orderId: string | null;
  companyId: string | null;
  sourceType: string;
  statusBefore: string | null;
  statusAfter: string | null;
  ledgerEntryTypeBefore: string | null;
  ledgerEntryTypeAfter: string | null;
  ledgerAmountBefore: number | null;
  ledgerAmountAfter: number | null;
  ledgerAmountDelta: number | null;
  amount: number | null;
  sourceAmount: number | null;
  direction: string;
  balanceAfter: number | null;
  frozenAfter: number | null;
  pairedAccountEventId: string | null;
  historicalStateUnknown: boolean;
  historicalCutoverSnapshot: boolean;
  historicalFollowupEventId: string | null;
  metaSnapshot: unknown;
  total: bigint | number | null;
};

type QueryEntriesResult = {
  rows: RawEntryRow[];
  total: number;
};

const VALID_EVENT_TYPES = new Set([
  'ACCRUAL',
  'FREEZE',
  'RELEASE',
  'REVERSAL',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RESERVE',
  'UNRESERVE',
  'PAYMENT',
  'PAYMENT_REVERSAL',
  'RECOVERY',
  'STATE_CHANGE',
]);

const VALID_SOURCE_TYPES = new Set<PlatformFundSourceType>(['NORMAL', 'VIP', 'LEGACY']);

const FUND_TYPE_SET = new Set<string>(PLATFORM_FUND_TYPES);

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toCount = (value: unknown): number => {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) ? number : 0;
};

const toBigIntString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'bigint' ? value.toString() : String(value);
};

const maskToken = (value: string): string => {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
};

/** Keep source evidence useful while preventing raw user/contact metadata from crossing the API. */
const safeSnapshot = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const denied = new Set([
    'phone',
    'mobile',
    'email',
    'accountNo',
    'bankAccount',
    'bankAccountNo',
    'sourceAccountRef',
    'bankReference',
    'accessToken',
    'refreshToken',
    'secret',
    'password',
    'rawBody',
  ]);
  for (const [key, raw] of Object.entries(input)) {
    if (denied.has(key) || key.toLowerCase().includes('password') || key.toLowerCase().includes('token')) continue;
    if (key === 'configSnapshot' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
      output[key] = safeSnapshot(raw);
      continue;
    }
    if (raw === null || typeof raw === 'number' || typeof raw === 'boolean') {
      output[key] = raw;
    } else if (typeof raw === 'string') {
      output[key] = /(?:user|owner|admin|receiver|inviter|original.*id|ledgerid|orderid|companyid|allocationid)/i.test(key)
        ? maskToken(raw)
        : raw;
    }
  }
  return output;
};

@Injectable()
export class PlatformFundQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: FundQuery = {}) {
    const range = this.dateRange(query);
    const eventFilters = [Prisma.sql`1 = 1`, ...this.dateClauses('e', range)];
    const beforeDate = range.fromTimestamp
      ? Prisma.sql`e."occurredAt" < CAST(${range.fromTimestamp} AS TIMESTAMP(3))`
      : Prisma.sql`FALSE`;
    const initialBalance = range.fromTimestamp
      ? Prisma.sql`CASE WHEN o."cutoverAt" IS NULL
          OR CAST(${range.fromTimestamp} AS TIMESTAMP(3)) < o."cutoverAt"
        THEN NULL::float8
        ELSE (COALESCE(o."initialBalance", 0) + COALESCE(b."balanceBefore", 0))::float8 END`
      : Prisma.sql`(COALESCE(o."initialBalance", 0) + COALESCE(b."balanceBefore", 0))::float8`;
    const initialFrozen = range.fromTimestamp
      ? Prisma.sql`CASE WHEN o."cutoverAt" IS NULL
          OR CAST(${range.fromTimestamp} AS TIMESTAMP(3)) < o."cutoverAt"
        THEN NULL::float8
        ELSE (COALESCE(o."initialFrozen", 0) + COALESCE(b."frozenBefore", 0))::float8 END`
      : Prisma.sql`(COALESCE(o."initialFrozen", 0) + COALESCE(b."frozenBefore", 0))::float8`;
    const values = Prisma.join(PLATFORM_FUND_TYPES.map((type) => Prisma.sql`(${type})`), ',');
    const summarySql = Prisma.sql`
      WITH fund_types("fundType") AS (VALUES ${values}),
      openings AS (
        SELECT "fundType", SUM("openingBalance") AS "initialBalance",
               SUM("openingFrozen") AS "initialFrozen",
               MIN("capturedAt") AS "cutoverAt"
        FROM "PlatformFundOpening"
        GROUP BY "fundType"
      ),
      accounts AS (
        SELECT "type"::text AS "fundType", SUM("balance") AS "currentBalance",
               SUM("frozen") AS "currentFrozen"
        FROM "RewardAccount"
        WHERE "userId" = 'PLATFORM'
          AND "type"::text IN (${Prisma.join(PLATFORM_FUND_TYPES.map((type) => Prisma.sql`${type}`), ',')})
        GROUP BY "type"::text
      ),
      events AS (
        SELECT e."fundType",
          SUM(CASE WHEN e."sourceTable" = 'RewardAccount' AND e."moneyDelta" > 0 THEN e."moneyDelta" ELSE 0 END) AS "periodIncome",
          SUM(CASE WHEN e."sourceTable" = 'RewardAccount' AND e."moneyDelta" < 0 THEN -e."moneyDelta" ELSE 0 END) AS "periodExpense",
          SUM(CASE WHEN e."sourceTable" = 'RewardAccount' THEN e."moneyDelta" ELSE 0 END) AS "netMovement",
          MAX(e."occurredAt") AS "lastEntryAt"
        FROM "PlatformFundEvent" e
        WHERE ${Prisma.join(eventFilters, ' AND ')}
        GROUP BY e."fundType"
      ),
      before_events AS (
        SELECT e."fundType",
          SUM(CASE WHEN e."sourceTable" = 'RewardAccount' THEN e."balanceDelta" ELSE 0 END) AS "balanceBefore",
          SUM(CASE WHEN e."sourceTable" = 'RewardAccount' THEN e."frozenDelta" ELSE 0 END) AS "frozenBefore"
        FROM "PlatformFundEvent" e
        WHERE e."sourceTable" = 'RewardAccount' AND ${beforeDate}
        GROUP BY e."fundType"
      )
      SELECT f."fundType",
        ${initialBalance} AS "initialBalance",
        ${initialFrozen} AS "initialFrozen",
        COALESCE(o."initialBalance", 0)::float8 AS "cutoverBalance",
        COALESCE(o."initialFrozen", 0)::float8 AS "cutoverFrozen",
        COALESCE(e."periodIncome", 0)::float8 AS "periodIncome",
        COALESCE(e."periodExpense", 0)::float8 AS "periodExpense",
        COALESCE(e."netMovement", 0)::float8 AS "netMovement",
        0::float8 AS "allTimeNetMovement",
        COALESCE(a."currentBalance", 0)::float8 AS "currentBalance",
        COALESCE(a."currentFrozen", 0)::float8 AS "currentFrozen",
        (COALESCE(o."initialBalance", 0) + COALESCE(o."initialFrozen", 0) + COALESCE(e."netMovement", 0))::float8 AS "reconstructedTotal",
        (COALESCE(a."currentBalance", 0) + COALESCE(a."currentFrozen", 0))::float8 AS "currentTotal",
        e."lastEntryAt"
      FROM fund_types f
      LEFT JOIN openings o ON o."fundType" = f."fundType"
      LEFT JOIN accounts a ON a."fundType" = f."fundType"
      LEFT JOIN events e ON e."fundType" = f."fundType"
      LEFT JOIN before_events b ON b."fundType" = f."fundType"
      ORDER BY f."fundType"
    `;
    const allTimeFilters = [Prisma.sql`e."sourceTable" = 'RewardAccount'`];
    const allTimeSql = Prisma.sql`
      SELECT e."fundType", SUM(e."moneyDelta")::float8 AS "allTimeNetMovement"
      FROM "PlatformFundEvent" e
      WHERE ${Prisma.join(allTimeFilters, ' AND ')}
      GROUP BY e."fundType"
    `;

    const [rows, allTime] = await this.prisma.$transaction(async (tx) => Promise.all([
      tx.$queryRaw<RawSummaryRow[]>(summarySql),
      tx.$queryRaw<Array<{ fundType: string; allTimeNetMovement: number | null }>>(allTimeSql),
    ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const allTimeNet = new Map(allTime.map((row) => [row.fundType, toNumber(row.allTimeNetMovement) ?? 0]));

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      asOf: new Date().toISOString(),
      funds: rows.map((row) => ({
        fundType: row.fundType,
        initialBalance: toNumber(row.initialBalance) ?? 0,
        initialFrozen: toNumber(row.initialFrozen) ?? 0,
        periodIncome: toNumber(row.periodIncome) ?? 0,
        periodExpense: toNumber(row.periodExpense) ?? 0,
        currentBalance: toNumber(row.currentBalance) ?? 0,
        available: toNumber(row.currentBalance) ?? 0,
        frozen: toNumber(row.currentFrozen) ?? 0,
        lastEntryAt: row.lastEntryAt?.toISOString() ?? null,
        reconstructedTotal: (toNumber(row.cutoverBalance) ?? 0) + (toNumber(row.cutoverFrozen) ?? 0) + (allTimeNet.get(row.fundType) ?? 0),
        currentTotal: toNumber(row.currentTotal) ?? 0,
      })),
    };
  }

  async entries(fundType: string, query: FundQuery = {}) {
    const type = this.assertFundType(fundType);
    const normalized = this.normalizeQuery(query);
    const { rows, total } = await this.queryEntries(type, normalized);
    return {
      items: rows.map((row) => this.entryView(row)),
      total,
      page: normalized.page,
      pageSize: normalized.pageSize,
      asOf: new Date().toISOString(),
    };
  }

  async entry(fundType: string, id: string) {
    const type = this.assertFundType(fundType);
    if (!id || id.length > 200) throw new BadRequestException('流水编号无效');
    const { rows } = await this.queryEntries(type, { page: 1, pageSize: 1 }, id);
    if (rows.length === 0) throw new NotFoundException('基金流水不存在');
    const view = this.entryView(rows[0]);
    const related = rows[0].rewardLedgerId
      ? await this.relatedEvents(type, rows[0].rewardLedgerId)
      : [];
    return { ...view, relatedEntries: related };
  }

  private async relatedEvents(fundType: PlatformFundType, rewardLedgerId: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      eventType: string;
      changeKind: string;
      eventSequence: bigint | number;
      occurredAt: Date;
      sourceTable: string;
      amount: number | null;
      balanceAfter: number | null;
    }>>(Prisma.sql`
      SELECT "id", "eventType", "changeKind", "eventSequence", "occurredAt",
             "sourceTable", "moneyDelta" AS amount, "balanceAfter"
      FROM "PlatformFundEvent"
      WHERE "fundType" = ${fundType} AND "rewardLedgerId" = ${rewardLedgerId}
      ORDER BY "eventSequence" ASC
    `);
    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      changeKind: row.changeKind,
      eventSequence: toBigIntString(row.eventSequence),
      occurredAt: row.occurredAt.toISOString(),
      sourceTable: row.sourceTable,
      amount: toNumber(row.amount) ?? 0,
      balanceAfter: toNumber(row.balanceAfter),
    }));
  }

  private async queryEntries(type: PlatformFundType, query: Required<Pick<FundQuery, 'page' | 'pageSize'>> & FundQuery, id?: string) {
    const range = this.dateRange(query);
    const auditFilters = [Prisma.sql`e."fundType" = ${type}`];
    const historicalFilters = [Prisma.sql`h."accountUserId" = 'PLATFORM'`, Prisma.sql`h."accountType"::text = ${type}`];
    auditFilters.push(...this.dateClauses('e', range));
    historicalFilters.push(...this.dateClauses('h', range, 'createdAt'));

    if (id) {
      auditFilters.push(Prisma.sql`e."id" = ${id}`);
      historicalFilters.push(Prisma.sql`('legacy:' || h."id") = ${id}`);
    }
    if (query.orderId) {
      auditFilters.push(Prisma.sql`COALESCE(e."refId", e."metaSnapshot"->>'sourceOrderId') = ${query.orderId}`);
      historicalFilters.push(Prisma.sql`COALESCE(h."effectiveRefId", h."effectiveMeta"->>'sourceOrderId') = ${query.orderId}`);
    }
    if (query.companyId) {
      auditFilters.push(Prisma.sql`(
        e."metaSnapshot"->>'companyId' = ${query.companyId}
        OR EXISTS (
          SELECT 1 FROM "OrderItem" oi
          WHERE oi."orderId" = COALESCE(e."refId", e."metaSnapshot"->>'sourceOrderId')
            AND oi."companyId" = ${query.companyId}
        )
      )`);
      historicalFilters.push(Prisma.sql`(
        h."effectiveMeta"->>'companyId' = ${query.companyId}
        OR EXISTS (
          SELECT 1 FROM "OrderItem" oi
          WHERE oi."orderId" = COALESCE(h."effectiveRefId", h."effectiveMeta"->>'sourceOrderId')
            AND oi."companyId" = ${query.companyId}
        )
      )`);
    }
    if (query.sourceType) {
      this.assertSourceType(query.sourceType);
      const sourceCondition = this.sourceTypeCondition(query.sourceType, 'e."metaSnapshot"');
      const legacySourceCondition = this.sourceTypeCondition(query.sourceType, 'h."effectiveMeta"');
      auditFilters.push(sourceCondition);
      historicalFilters.push(legacySourceCondition);
    }

    const logicalEventExpression = Prisma.sql`CASE
      WHEN e."sourceTable" = 'RewardLedger' THEN CASE COALESCE(e."ledgerEntryTypeAfter", e."ledgerEntryTypeBefore")
        WHEN 'FREEZE' THEN 'FREEZE'
        WHEN 'RELEASE' THEN 'RELEASE'
        WHEN 'VOID' THEN 'REVERSAL'
        WHEN 'WITHDRAW' THEN 'PAYMENT'
        WHEN 'DEDUCT' THEN 'PAYMENT'
        WHEN 'ADJUST' THEN CASE WHEN e."ledgerAmountDelta" >= 0 THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END
        ELSE 'STATE_CHANGE' END
      WHEN e."moneyDelta" > 0 THEN 'TRANSFER_IN'
      WHEN e."moneyDelta" < 0 THEN 'TRANSFER_OUT'
      ELSE 'STATE_CHANGE'
    END`;
    const historicalEntryType = Prisma.sql`CASE WHEN h."cutoverState" IS NULL
      THEN h."entryType"::text ELSE h."cutoverState"->>'entryType' END`;
    const historicalAmount = Prisma.sql`CASE WHEN h."cutoverState" IS NULL
      THEN h."amount" ELSE (h."cutoverState"->>'amount')::float8 END`;
    const legacyLogicalEventExpression = Prisma.sql`CASE ${historicalEntryType}
      WHEN 'FREEZE' THEN 'FREEZE'
      WHEN 'RELEASE' THEN 'RELEASE'
      WHEN 'VOID' THEN 'REVERSAL'
      WHEN 'WITHDRAW' THEN 'PAYMENT'
      WHEN 'DEDUCT' THEN 'PAYMENT'
      WHEN 'ADJUST' THEN CASE WHEN ${historicalAmount} >= 0 THEN 'TRANSFER_IN' ELSE 'TRANSFER_OUT' END
      ELSE 'STATE_CHANGE' END`;
    const sourceTypeExpression = (meta: Prisma.Sql) => Prisma.sql`CASE
      WHEN COALESCE((${meta})->>'scheme', '') LIKE 'VIP%' THEN 'VIP'
      WHEN COALESCE((${meta})->>'scheme', '') LIKE 'NORMAL%' THEN 'NORMAL'
      ELSE 'LEGACY' END`;

    const outerFilters = [Prisma.sql`1 = 1`];
    if (query.eventType) {
      if (!VALID_EVENT_TYPES.has(query.eventType)) throw new BadRequestException('事件类型无效');
      outerFilters.push(Prisma.sql`r."logicalEventType" = ${query.eventType}`);
    }
    if (query.status) outerFilters.push(Prisma.sql`COALESCE(r."statusAfter", r."statusBefore") = ${query.status}`);
    if (query.search) {
      const search = `%${query.search}%`;
      outerFilters.push(Prisma.sql`(r."id" ILIKE ${search} OR COALESCE(r."orderId", '') ILIKE ${search} OR COALESCE(r."companyId", '') ILIKE ${search})`);
    }

    const effectiveLedgerAmount = (entryType: Prisma.Sql, amount: Prisma.Sql) => Prisma.sql`CASE
      WHEN ${entryType} IN ('WITHDRAW', 'DEDUCT') THEN -ABS(COALESCE(${amount}, 0))
      WHEN ${entryType} = 'VOID' AND COALESCE(${amount}, 0) > 0 THEN -ABS(COALESCE(${amount}, 0))
      ELSE COALESCE(${amount}, 0)
    END`;
    const ledgerAmountBefore = effectiveLedgerAmount(
      Prisma.sql`l."ledgerEntryTypeBefore"`,
      Prisma.sql`l."ledgerAmountBefore"`,
    );
    const ledgerAmountAfter = effectiveLedgerAmount(
      Prisma.sql`l."ledgerEntryTypeAfter"`,
      Prisma.sql`l."ledgerAmountAfter"`,
    );
    const pairingExpectedDelta = Prisma.sql`CASE l."eventType"
      WHEN 'LEDGER_CREATED' THEN ${ledgerAmountAfter}
      WHEN 'LEDGER_REMOVED' THEN -(${ledgerAmountBefore})
      ELSE (${ledgerAmountAfter}) - (${ledgerAmountBefore})
    END`;
    const historicalEffectiveAmount = effectiveLedgerAmount(historicalEntryType, historicalAmount);
    const entriesCte = Prisma.sql`
      WITH pairing_candidates AS (
        SELECT l."id" AS "ledgerEventId", a."id" AS "accountEventId",
               a."balanceAfter", a."frozenAfter", a."moneyDelta",
               ${pairingExpectedDelta} AS "expectedDelta"
        FROM "PlatformFundEvent" l
        JOIN "PlatformFundEvent" a
          ON a."accountId" = l."accountId"
         AND a."fundType" = l."fundType"
         AND a."transactionId" = l."transactionId"
         AND a."sourceTable" = 'RewardAccount'
         AND a."eventSequence" = l."eventSequence" + 1
        WHERE l."sourceTable" = 'RewardLedger'
      ),
      pairings AS (
        SELECT "ledgerEventId", "accountEventId", "balanceAfter", "frozenAfter", "moneyDelta"
        FROM pairing_candidates
        WHERE "expectedDelta" <> 0
          AND ABS("moneyDelta" - "expectedDelta") < 0.000001
      ),
      historical_source AS (
        SELECT rl.*, ra."userId" AS "accountUserId", ra."type"::text AS "accountType",
          first_event."id" AS "followupEventId", first_event."oldState" AS "cutoverState",
          COALESCE(first_event."oldState"->>'refId', rl."refId") AS "effectiveRefId",
          COALESCE(first_event."oldState"->'meta', rl."meta") AS "effectiveMeta"
        FROM "RewardLedger" rl
        JOIN "RewardAccount" ra ON ra."id" = rl."accountId"
        LEFT JOIN LATERAL (
          SELECT e0."id", e0."oldState"
          FROM "PlatformFundEvent" e0
          WHERE e0."rewardLedgerId" = rl."id"
          ORDER BY e0."eventSequence" ASC, e0."recordedAt" ASC, e0."id" ASC
          LIMIT 1
        ) first_event ON TRUE
      ),
      audit_rows AS (
        SELECT e."id", e."accountId", e."fundType", e."eventType" AS "auditEventType", e."changeKind",
          e."eventSequence", e."transactionId", e."occurredAt", e."recordedAt",
          e."sourceTable", e."sourceOperation", e."rewardLedgerId", e."allocationId", e."sourceLedgerId",
          COALESCE(e."refId", e."metaSnapshot"->>'sourceOrderId') AS "orderId",
          e."metaSnapshot"->>'companyId' AS "companyId",
          ${sourceTypeExpression(Prisma.sql`e."metaSnapshot"`)} AS "sourceType",
          e."ledgerStatusBefore" AS "statusBefore", e."ledgerStatusAfter" AS "statusAfter",
          e."ledgerEntryTypeBefore", e."ledgerEntryTypeAfter", e."ledgerAmountBefore", e."ledgerAmountAfter",
          e."ledgerAmountDelta",
          CASE WHEN e."sourceTable" = 'RewardLedger' THEN COALESCE(pair."moneyDelta", 0)
               ELSE e."moneyDelta" END AS "amount",
          e."ledgerAmountAfter" AS "sourceAmount",
          CASE WHEN e."sourceTable" = 'RewardLedger' AND COALESCE(pair."moneyDelta", 0) > 0 THEN 'CREDIT'
               WHEN e."sourceTable" = 'RewardLedger' AND COALESCE(pair."moneyDelta", 0) < 0 THEN 'DEBIT'
               WHEN e."sourceTable" = 'RewardAccount' AND e."moneyDelta" > 0 THEN 'CREDIT'
               WHEN e."sourceTable" = 'RewardAccount' AND e."moneyDelta" < 0 THEN 'DEBIT'
               ELSE 'INTERNAL' END AS "direction",
          CASE WHEN e."sourceTable" = 'RewardLedger' THEN pair."balanceAfter" ELSE e."balanceAfter" END AS "balanceAfter",
          CASE WHEN e."sourceTable" = 'RewardLedger' THEN pair."frozenAfter" ELSE e."frozenAfter" END AS "frozenAfter",
          pair."accountEventId" AS "pairedAccountEventId",
          false AS "historicalStateUnknown",
          false AS "historicalCutoverSnapshot",
          NULL::text AS "historicalFollowupEventId",
          e."metaSnapshot",
          ${logicalEventExpression} AS "logicalEventType"
        FROM "PlatformFundEvent" e
        LEFT JOIN pairings pair ON pair."ledgerEventId" = e."id"
        WHERE ${Prisma.join(auditFilters, ' AND ')}
          AND NOT EXISTS (
            SELECT 1 FROM pairings paired_account
            WHERE paired_account."accountEventId" = e."id"
          )
      ),
      historical_rows AS (
        SELECT 'legacy:' || h."id" AS "id",
          CASE WHEN h."cutoverState" IS NULL THEN h."accountId"
               ELSE h."cutoverState"->>'accountId' END AS "accountId",
          ${type} AS "fundType", 'HISTORICAL_REWARD_LEDGER' AS "auditEventType", 'STATE' AS "changeKind",
          NULL::bigint AS "eventSequence", NULL::bigint AS "transactionId", h."createdAt" AS "occurredAt",
          h."createdAt" AS "recordedAt", 'RewardLedger' AS "sourceTable",
          CASE WHEN h."followupEventId" IS NULL THEN 'HISTORICAL' ELSE 'HISTORICAL_CUTOVER' END AS "sourceOperation",
          h."id" AS "rewardLedgerId",
          CASE WHEN h."cutoverState" IS NULL THEN h."allocationId"
               ELSE h."cutoverState"->>'allocationId' END AS "allocationId",
          CASE WHEN h."cutoverState" IS NULL THEN h."sourceLedgerId"
               ELSE h."cutoverState"->>'sourceLedgerId' END AS "sourceLedgerId",
          h."effectiveRefId" AS "orderId", h."effectiveMeta"->>'companyId' AS "companyId",
          ${sourceTypeExpression(Prisma.sql`h."effectiveMeta"`)} AS "sourceType",
          NULL::text AS "statusBefore",
          CASE WHEN h."cutoverState" IS NULL THEN h."status"::text
               ELSE h."cutoverState"->>'status' END AS "statusAfter",
          NULL::text AS "ledgerEntryTypeBefore", ${historicalEntryType} AS "ledgerEntryTypeAfter",
          NULL::float8 AS "ledgerAmountBefore", ${historicalAmount} AS "ledgerAmountAfter",
          CASE WHEN h."followupEventId" IS NULL THEN ${historicalAmount} ELSE 0::float8 END AS "ledgerAmountDelta",
          CASE WHEN h."followupEventId" IS NULL THEN ${historicalEffectiveAmount} ELSE 0::float8 END AS "amount",
          ${historicalAmount} AS "sourceAmount",
          CASE WHEN h."followupEventId" IS NOT NULL THEN 'INTERNAL'
               WHEN ${historicalEffectiveAmount} > 0 THEN 'CREDIT'
               WHEN ${historicalEffectiveAmount} < 0 THEN 'DEBIT'
               ELSE 'INTERNAL' END AS "direction",
          NULL::float8 AS "balanceAfter", NULL::float8 AS "frozenAfter", NULL::text AS "pairedAccountEventId",
          true AS "historicalStateUnknown",
          (h."followupEventId" IS NOT NULL) AS "historicalCutoverSnapshot",
          h."followupEventId" AS "historicalFollowupEventId",
          h."effectiveMeta" AS "metaSnapshot",
          ${legacyLogicalEventExpression} AS "logicalEventType"
        FROM historical_source h
        WHERE ${Prisma.join(historicalFilters, ' AND ')}
          AND NOT EXISTS (
            SELECT 1 FROM "PlatformFundEvent" e0
            WHERE e0."rewardLedgerId" = h."id"
              AND e0."eventType" = 'LEDGER_CREATED'
          )
      ),
      all_rows AS (
        SELECT * FROM audit_rows
        UNION ALL
        SELECT * FROM historical_rows
      )
    `;
    const outerWhere = Prisma.join(outerFilters, ' AND ');
    const offset = (query.page - 1) * query.pageSize;
    const sql = Prisma.sql`
      ${entriesCte}
      SELECT r.*, COUNT(*) OVER() AS total
      FROM all_rows r
      WHERE ${outerWhere}
      ORDER BY r."occurredAt" DESC, r."accountId" ASC,
               r."eventSequence" DESC NULLS LAST, r."id" DESC
      LIMIT ${query.pageSize} OFFSET ${offset}
    `;
    const countSql = Prisma.sql`
      ${entriesCte}
      SELECT COUNT(*)::bigint AS total
      FROM all_rows r
      WHERE ${outerWhere}
    `;
    const [rows, countRows] = await this.prisma.$transaction(async (tx) => Promise.all([
      tx.$queryRaw<RawEntryRow[]>(sql),
      tx.$queryRaw<Array<{ total: bigint | number }>>(countSql),
    ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { rows, total: toCount(countRows[0]?.total) };
  }

  private entryView(row: RawEntryRow) {
    const historical = row.id.startsWith('legacy:');
    const sourceAmount = toNumber(row.sourceAmount);
    const historicalCutoverSnapshot = historical && row.historicalCutoverSnapshot;
    const amount = historicalCutoverSnapshot ? 0 : (toNumber(row.amount) ?? 0);
    return {
      id: row.id,
      entryNo: historical ? `LEGACY-${row.rewardLedgerId ?? row.id.slice(7)}` : `PFA-${toBigIntString(row.eventSequence) ?? row.id.slice(0, 12)}`,
      fundType: row.fundType,
      eventType: row.logicalEventType,
      auditEventType: row.auditEventType,
      changeKind: row.changeKind,
      direction: historicalCutoverSnapshot ? 'INTERNAL' : row.direction,
      amount,
      sourceAmount,
      occurredAt: row.occurredAt?.toISOString() ?? null,
      createdAt: row.recordedAt?.toISOString() ?? row.occurredAt?.toISOString(),
      balanceAfter: toNumber(row.balanceAfter),
      availableAfter: toNumber(row.balanceAfter),
      frozenAfter: toNumber(row.frozenAfter),
      reservedAfter: null,
      sourceType: row.sourceType,
      orderId: row.orderId,
      allocationId: row.allocationId,
      companyId: row.companyId,
      reversalOfId: row.sourceLedgerId,
      relatedEntryId: row.rewardLedgerId,
      status: row.statusAfter ?? row.statusBefore,
      snapshot: safeSnapshot(row.metaSnapshot),
      metadata: {
        audited: !historical,
        historical,
        sourceTable: row.sourceTable,
        sourceOperation: row.sourceOperation,
        auditEventType: row.auditEventType,
        changeKind: row.changeKind,
        eventSequence: toBigIntString(row.eventSequence),
        transactionId: toBigIntString(row.transactionId),
        ledgerEntryTypeBefore: row.ledgerEntryTypeBefore,
        ledgerEntryTypeAfter: row.ledgerEntryTypeAfter,
        ledgerStatusBefore: row.statusBefore,
        ledgerStatusAfter: row.statusAfter,
        ledgerAmountBefore: toNumber(row.ledgerAmountBefore),
        ledgerAmountAfter: toNumber(row.ledgerAmountAfter),
        ledgerAmountDelta: toNumber(row.ledgerAmountDelta),
        pairedAccountEventId: row.pairedAccountEventId,
        historicalStateUnknown: row.historicalStateUnknown,
        historicalCutoverSnapshot: row.historicalCutoverSnapshot,
        historicalFollowupEventId: row.historicalFollowupEventId,
        nonIncomeEvidence: historicalCutoverSnapshot,
        balanceAfterIsFaithful: !historical && (row.sourceTable === 'RewardAccount' || row.pairedAccountEventId !== null),
      },
      source: {
        audited: !historical,
        historical,
        rewardLedgerId: row.rewardLedgerId,
        allocationId: row.allocationId,
        sourceLedgerId: row.sourceLedgerId,
      },
    };
  }

  private assertFundType(value: string): PlatformFundType {
    if (!FUND_TYPE_SET.has(value)) throw new BadRequestException('基金类型无效');
    return value as PlatformFundType;
  }

  private assertSourceType(value: string): asserts value is PlatformFundSourceType {
    if (!VALID_SOURCE_TYPES.has(value as PlatformFundSourceType)) throw new BadRequestException('来源类型无效');
  }

  private normalizeQuery(query: FundQuery): Required<Pick<FundQuery, 'page' | 'pageSize'>> & FundQuery {
    const page = Math.max(1, Math.min(100000, Number(query.page ?? 1)));
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize ?? 20)));
    if (!Number.isInteger(page) || !Number.isInteger(pageSize)) throw new BadRequestException('分页参数无效');
    if (query.sourceType) this.assertSourceType(query.sourceType);
    return { ...query, page, pageSize };
  }

  private dateRange(query: FundQuery): DateRange {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new BadRequestException('时间范围无效');
    }
    if (from && to && from > to) throw new BadRequestException('开始时间不能晚于结束时间');
    return {
      from,
      to,
      fromTimestamp: from ? from.toISOString().replace('Z', '') : undefined,
      toTimestamp: to ? to.toISOString().replace('Z', '') : undefined,
    };
  }

  private dateClauses(alias: 'e' | 'rl' | 'h', range: DateRange, field = 'occurredAt'): Prisma.Sql[] {
    const clauses: Prisma.Sql[] = [];
    if (range.fromTimestamp) {
      clauses.push(Prisma.sql`${Prisma.raw(alias)}.${Prisma.raw(`"${field}"`)} >= CAST(${range.fromTimestamp} AS TIMESTAMP(3))`);
    }
    if (range.toTimestamp) {
      clauses.push(Prisma.sql`${Prisma.raw(alias)}.${Prisma.raw(`"${field}"`)} <= CAST(${range.toTimestamp} AS TIMESTAMP(3))`);
    }
    return clauses;
  }

  private sourceTypeCondition(sourceType: string, metaExpression: string): Prisma.Sql {
    this.assertSourceType(sourceType);
    if (sourceType === 'VIP') return Prisma.sql`COALESCE(${Prisma.raw(metaExpression)}->>'scheme', '') LIKE 'VIP%'`;
    if (sourceType === 'NORMAL') return Prisma.sql`COALESCE(${Prisma.raw(metaExpression)}->>'scheme', '') LIKE 'NORMAL%'`;
    return Prisma.sql`COALESCE(${Prisma.raw(metaExpression)}->>'scheme', '') NOT LIKE 'VIP%' AND COALESCE(${Prisma.raw(metaExpression)}->>'scheme', '') NOT LIKE 'NORMAL%'`;
  }
}
