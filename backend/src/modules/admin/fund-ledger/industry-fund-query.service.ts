import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CompanyStatus, IndustryFundLedgerEventType, IndustryFundPaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FundQueryDto } from './fund-ledger.dto';

@Injectable()
export class IndustryFundQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private period(q: FundQueryDto) {
    if (q.from && q.to && new Date(q.from) > new Date(q.to)) throw new BadRequestException('开始时间不能晚于结束时间');
    return { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
  }

  private companyView(row: { company: { id: string; name: string; status: string }; frozenAmount: number; payableAmount: number; reservedAmount: number; totalPaid: number; totalAccrued: number; totalReversed: number; recoveryDue: number; updatedAt: Date }) {
    return { id: row.company.id, name: row.company.name, status: row.company.status,
      frozen: row.frozenAmount, available: row.payableAmount, reserved: row.reservedAmount,
      paid: row.totalPaid, accrued: row.totalAccrued, reversed: row.totalReversed,
      recoverable: row.recoveryDue, updatedAt: row.updatedAt, lastEntryAt: row.updatedAt };
  }

  async summary(q: FundQueryDto = new FundQueryDto()) {
    this.period(q);
    // Prisma Date 参数按 timestamptz 绑定，显式转成 UTC 文本再比较 timestamp 列。
    const from = q.from ? new Date(q.from).toISOString().slice(0, 23).replace('T', ' ') : null;
    const to = q.to ? new Date(q.to).toISOString().slice(0, 23).replace('T', ' ') : null;
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
    if (q.status && !Object.values(CompanyStatus).includes(q.status as CompanyStatus)) {
      throw new BadRequestException('公司状态无效');
    }
    const where: Prisma.IndustryFundAccountWhereInput = {
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...((q.search || q.status) ? {
        company: {
          ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
          ...(q.status ? { status: q.status as CompanyStatus } : {}),
        },
      } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.industryFundAccount.findMany({ where, include: { company: { select: { id: true, name: true, status: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.industryFundAccount.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    // 公司账户列展示当前投影余额；期间筛选只作用于汇总和流水，不伪装成历史余额。
    return { items: rows.map(r => this.companyView(r)), total, page: q.page, pageSize: q.pageSize };
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
    if (q.eventType && !Object.values(IndustryFundLedgerEventType).includes(q.eventType as IndustryFundLedgerEventType)) throw new BadRequestException('流水类型无效');
    const where: Prisma.IndustryFundLedgerWhereInput = {
      ...(companyId || q.companyId ? { companyId: companyId || q.companyId } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}), createdAt: this.period(q),
      ...(q.eventType ? { eventType: q.eventType as IndustryFundLedgerEventType } : {}),
      ...(q.sourceType ? { accrual: { scheme: { startsWith: q.sourceType === 'VIP' ? 'VIP' : q.sourceType === 'NORMAL' ? 'NORMAL' : '__LEGACY_NONE__' } } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.industryFundLedger.findMany({ where, include: { accrual: true, account: { include: { company: { select: { name: true } } } } }, orderBy: { sequence: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.industryFundLedger.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: rows.map(r => this.ledgerView(r)), total, page: q.page, pageSize: q.pageSize };
  }

  async ledger(id: string) {
    const row = await this.prisma.industryFundLedger.findUnique({ where: { id }, include: { accrual: true, account: { include: { company: { select: { name: true } } } } } });
    if (!row) throw new NotFoundException('流水不存在');
    return this.ledgerView(row);
  }

  async payments(q: FundQueryDto) {
    if (q.status && !Object.values(IndustryFundPaymentStatus).includes(q.status as IndustryFundPaymentStatus)) throw new BadRequestException('付款状态无效');
    const where: Prisma.IndustryFundPaymentWhereInput = {
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.status ? { status: q.status as IndustryFundPaymentStatus } : {}), createdAt: this.period(q),
      ...(q.search ? { company: { name: { contains: q.search, mode: 'insensitive' } } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.industryFundPayment.findMany({ where, select: { id: true, companyId: true, company: { select: { id: true, name: true } }, amount: true, status: true, needsReview: true, reviewReason: true, actualPaidAt: true, createdAt: true, updatedAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.industryFundPayment.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { items: items.map(r => ({ ...r, paidAt: r.actualPaidAt, actualAmount: r.status === 'PAID' || r.status === 'REVERSED' ? r.amount : null })), total, page: q.page, pageSize: q.pageSize };
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
    const where: Prisma.IndustryFundUnassignedEntryWhereInput = { createdAt: this.period(q), ...(q.orderId ? { orderId: q.orderId } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.industryFundUnassignedEntry.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.industryFundUnassignedEntry.count({ where }),
    ]);
    const events = items.length ? await this.prisma.$queryRaw<Array<{ id: bigint; entryId: string; createdAt: Date; beforeState: { reversedAmount?: number } | null; afterState: { amount: number; reversedAmount?: number } }>>(Prisma.sql`SELECT * FROM "IndustryFundUnassignedEvent" WHERE "entryId" IN (${Prisma.join(items.map(i => i.id))}) ORDER BY id ASC`) : [];
    return { items: items.map(r => ({ ...r, originalAmount: r.amount, events: events.filter(e => e.entryId === r.id).map(e => ({ id: e.id.toString(), createdAt: e.createdAt, reversedBefore: e.beforeState?.reversedAmount ?? 0, reversedAfter: e.afterState.reversedAmount ?? 0 })), amount: Math.max(0, r.amount - r.reversedAmount), status: r.amount === r.reversedAmount ? 'REVERSED' : r.status })), total, page: q.page, pageSize: q.pageSize };
  }
}
