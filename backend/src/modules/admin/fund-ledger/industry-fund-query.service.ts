import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyStatus, IndustryFundLedgerEventType, IndustryFundPaymentStatus, IndustryFundUnassignedStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FUND_QUERY_VIEWS, FundQueryDto, FundQueryView } from './fund-ledger.dto';

const FUND_QUERY_VIEW_SET = new Set<string>(FUND_QUERY_VIEWS);

type NormalizedFundQuery = FundQueryDto & { page: number; pageSize: number };

type UnassignedRawRow = {
  id: string;
  allocationId: string;
  orderId: string;
  amount: number;
  scheme: string;
  profitBaseAmount: number;
  reason: string;
  status: IndustryFundUnassignedStatus;
  resolvedCompanyId: string | null;
  resolvedAccrualId: string | null;
  resolvedAt: Date | null;
  resolutionReason: string | null;
  reversedAmount: number;
  reversedAt: Date | null;
  reversalReason: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
};

const hasOwnKeys = (value: object): boolean => Object.keys(value).length > 0;

@Injectable()
export class IndustryFundQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeQuery(q: FundQueryDto = new FundQueryDto()): NormalizedFundQuery {
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('分页参数无效');
    }
    if (q.view && !FUND_QUERY_VIEW_SET.has(q.view)) throw new BadRequestException('快捷视图无效');
    return { ...q, page, pageSize };
  }

  private period(q: FundQueryDto) {
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw new BadRequestException('时间范围无效');
    if (from && to && from > to) throw new BadRequestException('开始时间不能晚于结束时间');
    return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  private searchText(q: FundQueryDto): string | undefined {
    const value = q.search?.trim();
    return value || undefined;
  }

  private companyWhere(q: FundQueryDto): Prisma.IndustryFundAccountWhereInput {
    const company: Prisma.CompanyWhereInput = {};
    const search = this.searchText(q);
    if (search) company.name = { contains: search, mode: 'insensitive' };
    if (q.status) company.status = q.status as CompanyStatus;

    const where: Prisma.IndustryFundAccountWhereInput = {
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(hasOwnKeys(company) ? { company } : {}),
    };
    const view = this.companyViewWhere(q.view);
    return { ...where, ...view };
  }

  private companyViewWhere(view?: FundQueryView): Prisma.IndustryFundAccountWhereInput {
    switch (view) {
      case 'available':
        return { payableAmount: { gt: 0 } };
      case 'review':
        return {
          reservedAmount: { gt: 0 },
          payments: { some: { status: IndustryFundPaymentStatus.RESERVED, needsReview: true } },
        };
      case 'recovery':
        return { recoveryDue: { gt: 0 } };
      case 'pending':
        return {
          reservedAmount: { gt: 0 },
          payments: { some: { status: IndustryFundPaymentStatus.RESERVED, needsReview: false } },
        };
      case 'all':
      case undefined:
        return {};
    }
  }

  private paymentWhere(q: FundQueryDto, allowBankReferenceSearch: boolean): Prisma.IndustryFundPaymentWhereInput {
    const search = this.searchText(q);
    const bankReference = q.bankReference?.trim();
    if (bankReference && !allowBankReferenceSearch) throw new ForbiddenException('无银行流水号查询权限');
    const where: Prisma.IndustryFundPaymentWhereInput = {
      ...(bankReference ? { bankReference } : {}),
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.status ? { status: q.status as IndustryFundPaymentStatus } : {}),
      createdAt: this.period(q),
    };
    if (search) {
      const terms: Prisma.IndustryFundPaymentWhereInput[] = [
        { id: { contains: search, mode: 'insensitive' } },
        { company: { name: { contains: search, mode: 'insensitive' } } },
      ];
      // Bank references are sensitive evidence. They are searchable only for
      // administrators who can already register a payment or reverse one.
      if (allowBankReferenceSearch) terms.push({ bankReference: { contains: search, mode: 'insensitive' } });
      where.OR = terms;
    }
    return where;
  }

  private paymentViewWhere(view?: FundQueryView): Prisma.IndustryFundPaymentWhereInput {
    switch (view) {
      case 'pending':
        return { status: IndustryFundPaymentStatus.RESERVED, needsReview: false };
      case 'review':
        return { status: IndustryFundPaymentStatus.RESERVED, needsReview: true };
      case 'recovery':
        return { items: { some: { recoveryDue: { gt: 0 } } } };
      case 'all':
      case 'available':
      case undefined:
        return {};
    }
  }

  private withPaymentView(base: Prisma.IndustryFundPaymentWhereInput, view?: FundQueryView): Prisma.IndustryFundPaymentWhereInput {
    const viewWhere = this.paymentViewWhere(view);
    return hasOwnKeys(viewWhere) ? { AND: [base, viewWhere] } : base;
  }

  private companyView(row: { company: { id: string; name: string; status: string }; frozenAmount: number; payableAmount: number; reservedAmount: number; totalPaid: number; totalAccrued: number; totalReversed: number; recoveryDue: number; updatedAt: Date }) {
    return { id: row.company.id, name: row.company.name, status: row.company.status,
      frozen: row.frozenAmount, available: row.payableAmount, reserved: row.reservedAmount,
      paid: row.totalPaid, accrued: row.totalAccrued, reversed: row.totalReversed,
      recoverable: row.recoveryDue, updatedAt: row.updatedAt, lastEntryAt: row.updatedAt };
  }

  async summary(q: FundQueryDto = new FundQueryDto()) {
    const query = this.normalizeQuery(q);
    this.period(query);
    // Prisma Date 参数按 timestamptz 绑定，显式转成 UTC 文本再比较 timestamp 列。
    const from = query.from ? new Date(query.from).toISOString().slice(0, 23).replace('T', ' ') : null;
    const to = query.to ? new Date(query.to).toISOString().slice(0, 23).replace('T', ' ') : null;
    return this.prisma.$transaction(async tx => {
      const [sum, unassigned, movements] = await Promise.all([
        tx.industryFundAccount.aggregate({ _sum: { frozenAmount: true, payableAmount: true, reservedAmount: true, totalAccrued: true, totalReversed: true, totalPaid: true, totalRecovered: true, recoveryDue: true } }),
        tx.$queryRaw<Array<{ amount: number; count: bigint }>>`SELECT COALESCE(SUM(amount - "reversedAmount"),0)::float8 AS amount, COUNT(*) AS count FROM industry_fund_unassigned_entries WHERE status = 'PENDING' AND amount > "reversedAmount"`,
        tx.$queryRaw<Array<{ initialBalance: number; periodIncome: number; periodExpense: number }>>(Prisma.sql`
          WITH movement AS (SELECT "createdAt", ("frozenDelta" + "payableDelta" + "reservedDelta") AS delta FROM industry_fund_ledgers)
          SELECT COALESCE(SUM(CASE WHEN ${from}::timestamp IS NOT NULL AND "createdAt" < ${from}::timestamp THEN delta ELSE 0 END),0)::float8 AS "initialBalance",
          COALESCE(SUM(CASE WHEN (${from}::timestamp IS NULL OR "createdAt" >= ${from}::timestamp) AND (${to}::timestamp IS NULL OR "createdAt" <= ${to}::timestamp) THEN GREATEST(delta,0) ELSE 0 END),0)::float8 AS "periodIncome",
          COALESCE(SUM(CASE WHEN (${from}::timestamp IS NULL OR "createdAt" >= ${from}::timestamp) AND (${to}::timestamp IS NULL OR "createdAt" <= ${to}::timestamp) THEN GREATEST(-delta,0) ELSE 0 END),0)::float8 AS "periodExpense" FROM movement`),
      ]);
      const s = sum._sum;
      return { ...movements[0], frozen: s.frozenAmount ?? 0, available: s.payableAmount ?? 0, reserved: s.reservedAmount ?? 0,
        companyPayable: (s.frozenAmount ?? 0) + (s.payableAmount ?? 0) + (s.reservedAmount ?? 0),
        accrued: s.totalAccrued ?? 0, reversed: s.totalReversed ?? 0, paid: s.totalPaid ?? 0,
        recovered: s.totalRecovered ?? 0, recoverable: s.recoveryDue ?? 0,
        unassigned: { amount: unassigned[0]?.amount ?? 0, count: Number(unassigned[0]?.count ?? 0) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async companies(q: FundQueryDto) {
    const query = this.normalizeQuery(q);
    this.period(query);
    if (query.status && !Object.values(CompanyStatus).includes(query.status as CompanyStatus)) {
      throw new BadRequestException('公司状态无效');
    }
    const where = this.companyWhere(query);
    const [rows, total, aggregate] = await this.prisma.$transaction(async tx => Promise.all([
      tx.industryFundAccount.findMany({ where, include: { company: { select: { id: true, name: true, status: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      tx.industryFundAccount.count({ where }),
      tx.industryFundAccount.aggregate({ where, _sum: { frozenAmount: true, payableAmount: true, reservedAmount: true, recoveryDue: true } }),
    ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    // 公司账户列展示当前投影余额；期间筛选只作用于汇总和流水，不伪装成历史余额。
    const sums = aggregate._sum;
    return {
      summary: {
        available: sums.payableAmount ?? 0,
        frozen: sums.frozenAmount ?? 0,
        reserved: sums.reservedAmount ?? 0,
        recoverable: sums.recoveryDue ?? 0,
        count: total,
      },
      items: rows.map(r => this.companyView(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async company(id: string) {
    const row = await this.prisma.industryFundAccount.findUnique({ where: { companyId: id }, include: { company: { select: { id: true, name: true, status: true } } } });
    if (!row) {
      const company = await this.prisma.company.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
      if (!company) throw new NotFoundException('公司不存在');
      return { ...company, frozen: 0, available: 0, reserved: 0, paid: 0, accrued: 0, reversed: 0, recoverable: 0 };
    }
    return this.companyView(row);
  }

  private ledgerView(row: Prisma.IndustryFundLedgerGetPayload<{ include: { accrual: true; account: { include: { company: { select: { name: true } } } } } }>) {
    const net = row.frozenDelta + row.payableDelta + row.reservedDelta;
    return { id: row.id, fundType: 'INDUSTRY_FUND', eventType: row.eventType, amount: row.amount,
      direction: net > 0 ? 'CREDIT' : net < 0 ? 'DEBIT' : 'INTERNAL', createdAt: row.createdAt,
      balanceAfter: row.balanceFrozen + row.balancePayable + row.balanceReserved,
      availableAfter: row.balancePayable, frozenAfter: row.balanceFrozen, reservedAfter: row.balanceReserved,
      recoveryDueAfter: row.balanceRecoveryDue,
      sourceType: row.accrual ? (row.accrual.scheme.startsWith('VIP') ? 'VIP' : 'NORMAL') : null,
      orderId: row.orderId, companyId: row.companyId, companyName: row.account.company.name,
      allocationId: row.allocationId, accrualId: row.accrualId, paymentId: row.paymentId,
      profitBase: row.accrual?.profitBaseAmount, allocationRatio: row.accrual?.industryFundRatio,
      snapshot: row.accrual?.configSnapshot, reason: row.reason,
      // 原始 meta 可能包含付款凭证或账户信息，账本只返回余额变化和关联编号。
      metadata: { frozenDelta: row.frozenDelta, payableDelta: row.payableDelta, reservedDelta: row.reservedDelta,
        paidDelta: row.totalPaidDelta, recoveredDelta: row.totalRecoveredDelta, recoveryDueDelta: row.recoveryDueDelta,
        recoveryDueAfter: row.balanceRecoveryDue },
      operator: row.actorId ? { id: row.actorId } : null };
  }

  async ledgers(q: FundQueryDto, companyId?: string) {
    const query = this.normalizeQuery(q);
    if (query.eventType && !Object.values(IndustryFundLedgerEventType).includes(query.eventType as IndustryFundLedgerEventType)) throw new BadRequestException('流水类型无效');
    const search = this.searchText(query);
    const where: Prisma.IndustryFundLedgerWhereInput = {
      ...(companyId || query.companyId ? { companyId: companyId || query.companyId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}), createdAt: this.period(query),
      ...(query.eventType ? { eventType: query.eventType as IndustryFundLedgerEventType } : {}),
      ...(query.sourceType ? { accrual: { scheme: { startsWith: query.sourceType === 'VIP' ? 'VIP' : query.sourceType === 'NORMAL' ? 'NORMAL' : '__LEGACY_NONE__' } } } : {}),
      ...(search ? {
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          { orderId: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const [rows, total] = await this.prisma.$transaction(async tx => Promise.all([
      tx.industryFundLedger.findMany({ where, include: { accrual: true, account: { include: { company: { select: { name: true } } } } }, orderBy: { sequence: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      tx.industryFundLedger.count({ where }),
    ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: rows.map(r => this.ledgerView(r)), total, page: query.page, pageSize: query.pageSize };
  }

  async ledger(id: string) {
    const row = await this.prisma.industryFundLedger.findUnique({ where: { id }, include: { accrual: true, account: { include: { company: { select: { name: true } } } } } });
    if (!row) throw new NotFoundException('流水不存在');
    return this.ledgerView(row);
  }

  async payments(q: FundQueryDto, allowBankReferenceSearch = false) {
    const query = this.normalizeQuery(q);
    if (query.status && !Object.values(IndustryFundPaymentStatus).includes(query.status as IndustryFundPaymentStatus)) throw new BadRequestException('付款状态无效');
    const baseWhere = this.paymentWhere(query, allowBankReferenceSearch);
    const where = this.withPaymentView(baseWhere, query.view);
    const pendingWhere = this.withPaymentView(baseWhere, 'pending');
    const reviewWhere = this.withPaymentView(baseWhere, 'review');
    const recoveryWhere = this.withPaymentView(baseWhere, 'recovery');
    const [items, total, pendingCount, reviewCount, recoveryCount] = await this.prisma.$transaction(async tx => Promise.all([
      tx.industryFundPayment.findMany({ where, select: { id: true, companyId: true, company: { select: { id: true, name: true } }, amount: true, status: true, needsReview: true, reviewReason: true, actualPaidAt: true, createdAt: true, updatedAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      tx.industryFundPayment.count({ where }),
      tx.industryFundPayment.count({ where: pendingWhere }),
      tx.industryFundPayment.count({ where: reviewWhere }),
      tx.industryFundPayment.count({ where: recoveryWhere }),
    ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      summary: { pendingCount, reviewCount, recoveryCount },
      items: items.map(r => ({ ...r, paidAt: r.actualPaidAt, actualAmount: r.status === 'PAID' || r.status === 'REVERSED' ? r.amount : null })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async payment(id: string, sensitive: boolean) {
    const row = await this.prisma.industryFundPayment.findUnique({ where: { id }, include: {
      company: { select: { id: true, name: true } },
      items: { include: { accrual: { select: { orderId: true, originalAmount: true } } } },
      recoveries: { orderBy: { createdAt: 'asc' } },
      ledgers: { orderBy: { createdAt: 'asc' } },
    } });
    if (!row) throw new NotFoundException('付款单不存在');
    const { bankAccount, proofKey, sourceAccountRef, bankReference, recoveries, ledgers, ...rest } = row;
    return { ...rest, paidAt: row.actualPaidAt,
      actualAmount: row.status === 'PAID' || row.status === 'REVERSED' ? row.amount : null,
      bankAccount: sensitive ? bankAccount : `****${bankAccount.slice(-4)}`,
      proofKey: sensitive ? proofKey : null,
      sourceAccountRef: sensitive ? sourceAccountRef : null,
      bankReference: sensitive ? bankReference : null,
      items: row.items.map(i => ({ id: i.id, accrualId: i.accrualId, amount: i.amount, reservedAmount: i.reservedAmount,
        paidAmount: i.paidAmount, recoveryDue: i.recoveryDue, recoveredAmount: i.recoveredAmount,
        orderId: i.accrual.orderId, sourceAmount: i.accrual.originalAmount })),
      recoveries: recoveries.map(r => ({ id: r.id, paymentId: r.paymentId, companyId: r.companyId, amount: r.amount,
        recoveredAt: r.recoveredAt, bankReference: sensitive ? r.bankReference : null, proofKey: sensitive ? r.proofKey : null,
        reason: r.reason, createdAt: r.createdAt, operator: r.actorId ? { id: r.actorId } : null })),
      statusHistory: ledgers.map(l => ({ id: l.id, eventType: l.eventType, amount: l.amount, reason: l.reason,
        occurredAt: l.createdAt, operator: l.actorId ? { id: l.actorId } : null })),
    };
  }

  async unassigned(q: FundQueryDto) {
    const query = this.normalizeQuery(q);
    if (query.status && !['ALL', ...Object.values(IndustryFundUnassignedStatus)].includes(query.status)) throw new BadRequestException('待归属状态无效');
    const period = this.period(query);
    const filters: Prisma.Sql[] = [Prisma.sql`1 = 1`];
    if (period.gte) filters.push(Prisma.sql`"createdAt" >= ${period.gte}`);
    if (period.lte) filters.push(Prisma.sql`"createdAt" <= ${period.lte}`);
    if (query.orderId) filters.push(Prisma.sql`"orderId" = ${query.orderId}`);
    if (query.status === IndustryFundUnassignedStatus.PENDING) {
      // A pending entry with a fully reversed amount is no longer actionable,
      // even if an older writer left its persisted status as PENDING.
      filters.push(Prisma.sql`"status" = ${IndustryFundUnassignedStatus.PENDING}::"IndustryFundUnassignedStatus"`);
      filters.push(Prisma.sql`"amount" > "reversedAmount"`);
    } else if (query.status && query.status !== 'ALL') {
      filters.push(Prisma.sql`"status" = ${query.status as IndustryFundUnassignedStatus}::"IndustryFundUnassignedStatus"`);
    }
    const where = Prisma.join(filters, ' AND ');
    const offset = (query.page - 1) * query.pageSize;
    const [items, total, events] = await this.prisma.$transaction(async tx => {
      const [pageItems, countRows] = await Promise.all([
        tx.$queryRaw<UnassignedRawRow[]>(Prisma.sql`
          SELECT "id", "allocationId", "orderId", "amount", "scheme", "profitBaseAmount", "reason", "status",
                 "resolvedCompanyId", "resolvedAccrualId", "resolvedAt", "resolutionReason", "reversedAmount",
                 "reversedAt", "reversalReason", "idempotencyKey", "createdAt", "updatedAt"
          FROM "industry_fund_unassigned_entries"
          WHERE ${where}
          ORDER BY "createdAt" DESC, "id" DESC
          LIMIT ${query.pageSize} OFFSET ${offset}`),
        tx.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS total
          FROM "industry_fund_unassigned_entries"
          WHERE ${where}`),
      ]);
      const eventRows = pageItems.length
        ? await tx.$queryRaw<Array<{ id: bigint; entryId: string; createdAt: Date; beforeState: { reversedAmount?: number } | null; afterState: { amount: number; reversedAmount?: number } }>>(Prisma.sql`
            SELECT "id", "entryId", "createdAt", "beforeState", "afterState"
            FROM "IndustryFundUnassignedEvent"
            WHERE "entryId" IN (${Prisma.join(pageItems.map(item => item.id))})
            ORDER BY "id" ASC`)
        : [];
      return [pageItems, Number(countRows[0]?.total ?? 0), eventRows] as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: items.map(r => ({ ...r, originalAmount: r.amount, events: events.filter(e => e.entryId === r.id).map(e => ({ id: e.id.toString(), createdAt: e.createdAt, reversedBefore: e.beforeState?.reversedAmount ?? 0, reversedAfter: e.afterState.reversedAmount ?? 0 })), amount: Math.max(0, r.amount - r.reversedAmount), status: r.amount === r.reversedAmount ? 'REVERSED' : r.status })), total, page: query.page, pageSize: query.pageSize };
  }
}
