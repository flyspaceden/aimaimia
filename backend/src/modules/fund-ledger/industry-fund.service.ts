import { Injectable } from '@nestjs/common';
import { IndustryFundLedgerEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Company industry-fund ledger.
 *
 * The project stores money as Float yuan for compatibility with the existing
 * schema. Every transition in this service first converts the input and the
 * stored projection to integer cents. The Float values written back to Prisma
 * are therefore always two-decimal yuan values.
 *
 * This class intentionally exposes transaction-level methods. The caller that
 * owns order receipt, after-sale success, or an admin payment request must run
 * the method in its existing Serializable transaction. No method here writes
 * RewardAccount/RewardLedger and no method calls an external bank.
 */

export type IndustryFundTx = Prisma.TransactionClient;

export interface IndustryFundAccrueInput {
  allocationId: string;
  orderId: string;
  amount: number;
  companyProfitShares: Record<string, number>;
  scheme: string;
  ledgerVersion?: string;
  configSnapshot?: unknown;
  sourceEventAt?: Date;
}

export interface IndustryFundAccrueResult {
  accrualIds: string[];
  unassignedEntryIds: string[];
  totalCents: number;
}

export interface IndustryFundActor {
  actorId?: string;
  actorType?: string;
}

export interface IndustryFundReleaseInput extends IndustryFundActor {
  accrualId: string;
  idempotencyKey: string;
  now?: Date;
}

export interface IndustryFundReverseInput extends IndustryFundActor {
  orderId: string;
  reason: string;
  idempotencyKey?: string;
  afterSaleId?: string;
}

export interface IndustryFundPaymentReserveInput extends IndustryFundActor {
  companyId: string;
  amount: number;
  payeeName: string;
  bankAccount: string;
  bankName: string;
  reason: string;
  idempotencyKey: string;
}

export interface IndustryFundPaymentConfirmInput extends IndustryFundActor {
  actualAmount: number;
  paidAt: Date;
  sourceAccountRef: string;
  bankReference: string;
  proofKey: string;
  idempotencyKey: string;
  /** Required when a reversal flagged the reserved payment as already paid. */
  confirmActualPayment?: boolean;
  confirmationReason?: string;
}

export interface IndustryFundPaymentCancelInput extends IndustryFundActor {
  reason: string;
  idempotencyKey: string;
}

export interface IndustryFundRecoveryInput extends IndustryFundActor {
  amount: number;
  recoveredAt: Date;
  bankReference: string;
  proofKey: string;
  reason: string;
  idempotencyKey: string;
}

export interface IndustryFundReconcileInput extends IndustryFundActor {
  limit?: number;
  cursor?: string;
  now?: Date;
}

export interface IndustryFundReconcileResult {
  processed: number;
  released: number;
  reversed: number;
  skipped: number;
  nextCursor: string | null;
}

export class IndustryFundError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IndustryFundError';
  }
}

const EPSILON_CENTS = 0.000001;
const DEFAULT_LEDGER_VERSION = 'COMPANY_LEDGER_V1';

const SAFE_AFTER_SALE_STATUSES = new Set([
  'REJECTED',
  'CLOSED',
  'CANCELED',
]);

const SUCCESSFUL_AFTER_SALE_STATUSES = new Set([
  'REFUNDED',
  'COMPLETED',
]);

const centsToYuan = (cents: number): number => {
  if (!Number.isSafeInteger(cents)) {
    throw new IndustryFundError('INVALID_CENTS', `invalid integer cents: ${cents}`);
  }
  return cents / 100;
};

const yuanToCents = (amount: number): number => {
  if (!Number.isFinite(amount)) {
    throw new IndustryFundError('INVALID_AMOUNT', 'amount must be finite');
  }
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new IndustryFundError('INVALID_AMOUNT', `amount is outside the safe range: ${amount}`);
  }
  if (cents < 0) {
    throw new IndustryFundError('NEGATIVE_AMOUNT', 'amount must not be negative');
  }
  return cents;
};

const signedYuanToCents = (amount: number): number => {
  if (!Number.isFinite(amount)) {
    throw new IndustryFundError('INVALID_AMOUNT', 'signed amount must be finite');
  }
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new IndustryFundError('INVALID_AMOUNT', `signed amount is outside the safe range: ${amount}`);
  }
  return cents;
};

const positiveCents = (amount: number, field: string): number => {
  const cents = yuanToCents(amount);
  if (cents <= 0) {
    throw new IndustryFundError('AMOUNT_MUST_BE_POSITIVE', `${field} must be greater than zero`);
  }
  return cents;
};

const nonNegativeCents = (amount: number, field: string): number => {
  const cents = yuanToCents(amount);
  if (cents < 0) {
    throw new IndustryFundError('NEGATIVE_AMOUNT', `${field} must not be negative`);
  }
  return cents;
};

type AccountRow = Prisma.IndustryFundAccountGetPayload<{}>;
type AccrualRow = Prisma.IndustryFundAccrualGetPayload<{}>;
type AccrualWithAccount = Prisma.IndustryFundAccrualGetPayload<{
  include: { account: true };
}>;
type PaymentWithItems = Prisma.IndustryFundPaymentGetPayload<{
  include: { items: true };
}>;

interface AccountDelta {
  frozen: number;
  payable: number;
  reserved: number;
  paid: number;
  recovered: number;
  recoveryDue: number;
  totalAccrued: number;
  totalReversed: number;
  totalPaid: number;
  totalRecovered: number;
}

const zeroDelta = (): AccountDelta => ({
  frozen: 0,
  payable: 0,
  reserved: 0,
  paid: 0,
  recovered: 0,
  recoveryDue: 0,
  totalAccrued: 0,
  totalReversed: 0,
  totalPaid: 0,
  totalRecovered: 0,
});

const addDelta = (target: AccountDelta, source: AccountDelta): AccountDelta => ({
  frozen: target.frozen + source.frozen,
  payable: target.payable + source.payable,
  reserved: target.reserved + source.reserved,
  paid: target.paid + source.paid,
  recovered: target.recovered + source.recovered,
  recoveryDue: target.recoveryDue + source.recoveryDue,
  totalAccrued: target.totalAccrued + source.totalAccrued,
  totalReversed: target.totalReversed + source.totalReversed,
  totalPaid: target.totalPaid + source.totalPaid,
  totalRecovered: target.totalRecovered + source.totalRecovered,
});

const jsonInput = (value: unknown): Prisma.InputJsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  return value as Prisma.InputJsonValue;
};

const readNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

@Injectable()
export class IndustryFundService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates new company accruals for an existing RewardAllocation. This is
   * the method used by normal/vip platform split services. The old allocation
   * remains the idempotency boundary; the new company rows are keyed by
   * allocationId + companyId and can therefore be retried safely.
   */
  async accrueInTransaction(
    tx: IndustryFundTx,
    input: IndustryFundAccrueInput,
  ): Promise<IndustryFundAccrueResult> {
    const amountCents = yuanToCents(input.amount);
    if (amountCents === 0) {
      return { accrualIds: [], unassignedEntryIds: [], totalCents: 0 };
    }
    if (!input.allocationId || !input.orderId || !input.scheme) {
      throw new IndustryFundError('INVALID_ACCRUAL_SOURCE', 'allocationId, orderId, and scheme are required');
    }

    const allocation = await tx.rewardAllocation.findUnique({
      where: { id: input.allocationId },
      select: { meta: true },
    });
    if (!allocation) {
      throw new IndustryFundError('ALLOCATION_NOT_FOUND', `reward allocation not found: ${input.allocationId}`);
    }

    const configSnapshot = input.configSnapshot ?? allocation.meta ?? undefined;
    const profitBaseAmount = this.profitBaseAmount(configSnapshot);
    if (profitBaseAmount === null || profitBaseAmount <= 0) {
      throw new IndustryFundError('MISSING_PROFIT_SNAPSHOT', `allocation has no immutable profit snapshot: ${input.allocationId}`);
    }
    // 只有自提核销可以跳过常规售后窗口；检查必须留在本事务内，避免新计提
    // 在计提与释放之间短暂或永久停留在冻结状态。
    const pickupVerified = await this.isVerifiedPickupOrder(tx, input.orderId);
    const industryFundRatio = this.configuredIndustryFundRatio(configSnapshot, input.scheme)
      ?? input.amount / profitBaseAmount;

    // Preserve the split service's insertion order. Its last company is the
    // existing remainder beneficiary; sorting here would silently move cents
    // between companies while still passing a sum check.
    const entries = Object.entries(input.companyProfitShares);
    for (const [companyId, ratio] of entries) {
      if (!companyId || !Number.isFinite(ratio) || ratio < 0) {
        throw new IndustryFundError('INVALID_COMPANY_SHARE', `invalid company share for ${companyId}`);
      }
    }

    let allocatedKnownCents = 0;
    const shares: Array<{ companyId: string; cents: number; ratio: number }> = [];
    entries.forEach(([companyId, ratio], index) => {
      // Preserve the existing platform split rule: the final company receives
      // the whole integer-cent remainder. This is required when historical
      // company ratios were derived from a rounded profit denominator and sum
      // slightly above one.
      const remainingCents = Math.max(0, amountCents - allocatedKnownCents);
      const cents = index === entries.length - 1
        ? remainingCents
        : Math.min(remainingCents, Math.max(0, Math.floor(amountCents * ratio + EPSILON_CENTS)));
      allocatedKnownCents += cents;
      if (cents > 0) shares.push({ companyId, cents, ratio });
    });

    const accrualIds: string[] = [];
    const unassignedEntryIds: string[] = [];
    let unassignedCents = entries.length === 0 ? amountCents : 0;
    const unassignedReasons: string[] = [];

    for (const share of shares) {
      const company = await tx.company.findUnique({
        where: { id: share.companyId },
        select: { id: true },
      });
      if (!company) {
        unassignedCents += share.cents;
        unassignedReasons.push(`COMPANY_NOT_FOUND:${share.companyId}`);
        continue;
      }

      const existing = await tx.industryFundAccrual.findUnique({
        where: {
          allocationId_companyId: {
            allocationId: input.allocationId,
            companyId: share.companyId,
          },
        },
      });
      if (existing) {
        this.assertAccrualIdempotency(existing, share.cents, input);
        accrualIds.push(existing.id);
        continue;
      }

      const account = await tx.industryFundAccount.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id },
        update: {},
      });
      const accrual = await tx.industryFundAccrual.create({
        data: {
          accountId: account.id,
          companyId: company.id,
          allocationId: input.allocationId,
          orderId: input.orderId,
          scheme: input.scheme,
          ledgerVersion: input.ledgerVersion ?? DEFAULT_LEDGER_VERSION,
          profitBaseAmount,
          companyShareAmount: centsToYuan(share.cents),
          companyShareRatio: share.ratio,
          industryFundRatio,
          configSnapshot: jsonInput(configSnapshot),
          originalAmount: centsToYuan(share.cents),
          frozenAmount: centsToYuan(share.cents),
          sourceEventAt: input.sourceEventAt,
        },
      });

      const nextAccount = await this.mutateAccount(tx, account, {
        ...zeroDelta(),
        frozen: share.cents,
        totalAccrued: share.cents,
      });
      await this.createLedger(tx, nextAccount, {
        eventType: 'ACCRUAL',
        amountCents: share.cents,
        deltas: {
          ...zeroDelta(),
          frozen: share.cents,
          totalAccrued: share.cents,
        },
        accrualId: accrual.id,
        companyId: company.id,
        allocationId: input.allocationId,
        orderId: input.orderId,
        idempotencyKey: `industry-fund:accrual:${input.allocationId}:${company.id}`,
        reason: '产业基金计提',
        meta: {
          scheme: input.scheme,
          ledgerVersion: input.ledgerVersion ?? DEFAULT_LEDGER_VERSION,
          profitBaseAmount,
          companyShareRatio: share.ratio,
          industryFundRatio,
          configSnapshot,
        },
      });
      accrualIds.push(accrual.id);
    }

    // 保留两条不可变审计流水：ACCRUAL 记录来源分配，RELEASE 记录转为可支付。
    // 未归属金额不参与释放，继续留在可见的待人工归属账中。
    if (pickupVerified) {
      for (const accrualId of accrualIds) {
        await this.releaseAccrual(tx, {
          accrualId,
          idempotencyKey: `industry-fund:release:${accrualId}`,
          actorType: 'SYSTEM',
        });
      }
    }

    if (unassignedCents > 0) {
      const reason = unassignedReasons.length > 0
        ? unassignedReasons.join(',')
        : 'COMPANY_SHARE_MISSING';
      const existing = await tx.industryFundUnassignedEntry.findUnique({
        where: { allocationId: input.allocationId },
      });
      if (existing) {
        if (yuanToCents(existing.amount) !== unassignedCents || existing.orderId !== input.orderId) {
          throw new IndustryFundError('IDEMPOTENCY_CONFLICT', `unassigned allocation already has a different amount: ${input.allocationId}`);
        }
        unassignedEntryIds.push(existing.id);
      } else {
        const row = await tx.industryFundUnassignedEntry.create({
          data: {
            allocationId: input.allocationId,
            orderId: input.orderId,
            amount: centsToYuan(unassignedCents),
            scheme: input.scheme,
            profitBaseAmount,
            reason,
            idempotencyKey: `industry-fund:unassigned:${input.allocationId}`,
          },
        });
        unassignedEntryIds.push(row.id);
      }
    }

    return { accrualIds, unassignedEntryIds, totalCents: amountCents };
  }

  /** Alias retained for callers that use the shorter design-document name. */
  async accrue(
    tx: IndustryFundTx,
    input: IndustryFundAccrueInput,
  ): Promise<IndustryFundAccrueResult> {
    return this.accrueInTransaction(tx, input);
  }

  async releaseAccrual(
    tx: IndustryFundTx,
    input: IndustryFundReleaseInput,
  ): Promise<{ accrualId: string; releasedCents: number; skipped: boolean }> {
    const existingLedger = await tx.industryFundLedger.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existingLedger) {
      if (existingLedger.accrualId !== input.accrualId || existingLedger.eventType !== 'RELEASE') {
        throw new IndustryFundError(
          'IDEMPOTENCY_CONFLICT',
          `release idempotency key already belongs to another event: ${input.idempotencyKey}`,
        );
      }
      return {
        accrualId: input.accrualId,
        releasedCents: yuanToCents(existingLedger.amount),
        skipped: true,
      };
    }

    const accrual = await tx.industryFundAccrual.findUnique({
      where: { id: input.accrualId },
      include: { account: true },
    });
    if (!accrual) throw new IndustryFundError('ACCRUAL_NOT_FOUND', `accrual not found: ${input.accrualId}`);
    const frozenCents = yuanToCents(accrual.frozenAmount);
    if (frozenCents <= 0) {
      return { accrualId: accrual.id, releasedCents: 0, skipped: true };
    }
    if (yuanToCents(accrual.reversalPendingAmount) > 0) {
      throw new IndustryFundError('REVERSAL_PENDING', `accrual has a pending reversal: ${accrual.id}`);
    }

    const releaseMode = await this.assertOrderReleaseEligible(tx, accrual.orderId, input.now ?? new Date());
    const updatedAccrual = await this.updateAccrualCas(tx, accrual, {
      frozenAmount: centsToYuan(0),
      payableAmount: centsToYuan(yuanToCents(accrual.payableAmount) + frozenCents),
    });
    void updatedAccrual;

    const nextAccount = await this.mutateAccount(tx, accrual.account, {
      ...zeroDelta(),
      frozen: -frozenCents,
      payable: frozenCents,
    });
    await this.createLedger(tx, nextAccount, {
      eventType: 'RELEASE',
      amountCents: frozenCents,
      deltas: { ...zeroDelta(), frozen: -frozenCents, payable: frozenCents },
      accrualId: accrual.id,
      companyId: accrual.companyId,
      allocationId: accrual.allocationId,
      orderId: accrual.orderId,
      idempotencyKey: input.idempotencyKey,
      reason: releaseMode === 'PICKUP_VERIFIED'
        ? '自提核销完成，产业基金即时释放'
        : '售后保护期结束，产业基金释放',
      actorId: input.actorId,
      actorType: input.actorType ?? 'SYSTEM',
    });
    return { accrualId: accrual.id, releasedCents: frozenCents, skipped: false };
  }

  async reconcileMaturedAccruals(
    tx: IndustryFundTx,
    input: IndustryFundReconcileInput = {},
  ): Promise<IndustryFundReconcileResult> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const now = input.now ?? new Date();
    const rows = await tx.industryFundAccrual.findMany({
      where: {
        frozenAmount: { gt: 0 },
        reversalPendingAmount: 0,
        order: { returnWindowExpiresAt: { lte: now } },
      },
      // 与独立定时任务使用相同的唯一 id 扫描顺序，补偿入口共享游标口径。
      orderBy: { id: 'asc' },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: limit,
      select: { id: true, orderId: true, createdAt: true },
    });

    const orderIds = [...new Set(rows.map((row) => row.orderId))];
    let released = 0;
    let reversed = 0;
    let skipped = 0;
    for (const orderId of orderIds) {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          returnWindowExpiresAt: true,
          afterSaleRequests: { select: { id: true, status: true } },
        },
      });
      if (!order?.returnWindowExpiresAt || order.returnWindowExpiresAt > now) {
        skipped += 1;
        continue;
      }
      const successfulAfterSale = order.afterSaleRequests.find((item) =>
        SUCCESSFUL_AFTER_SALE_STATUSES.has(item.status),
      );
      if (successfulAfterSale) {
        await this.reverseOrderInTransaction(tx, orderId, 'AFTER_SALE_SUCCESS', successfulAfterSale.id);
        reversed += 1;
        continue;
      }
      if (order.afterSaleRequests.some((item) => !SAFE_AFTER_SALE_STATUSES.has(item.status))) {
        skipped += 1;
        continue;
      }
      const orderRows = rows.filter((row) => row.orderId === orderId);
      for (const row of orderRows) {
        const result = await this.releaseAccrual(tx, {
          accrualId: row.id,
          idempotencyKey: `industry-fund:release:${row.id}`,
          now,
          actorId: input.actorId,
          actorType: input.actorType ?? 'SYSTEM',
        });
        if (result.releasedCents > 0) released += 1;
      }
    }
    const nextCursor = rows.length === limit ? rows[rows.length - 1]?.id ?? null : null;
    return { processed: rows.length, released, reversed, skipped, nextCursor };
  }

  /**
   * Reverses the whole order's company obligations. Frozen/payable amounts
   * are reversed immediately. Reserved amounts stay reserved, mark their
   * payment as needing review, and are finalized only after that payment is
   * cancelled. Already paid amounts become recovery receivables.
   */
  async reverseOrderInTransaction(
    tx: IndustryFundTx,
    orderId: string,
    reason: string,
    afterSaleId?: string,
  ): Promise<{ reversedCents: number; pendingCents: number; recoveryDueCents: number }> {
    const accruals = await tx.industryFundAccrual.findMany({
      where: { orderId },
      include: { account: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    let reversedCents = 0;
    let pendingCents = 0;
    let recoveryDueCents = 0;
    for (const accrual of accruals) {
      // The include snapshot above is only for ordering. Reload each account
      // after the previous accrual mutates the shared company projection so
      // the account version CAS cannot use a stale version for multi-accrual
      // orders.
      const latestAccrual = await tx.industryFundAccrual.findUnique({
        where: { id: accrual.id },
        include: { account: true },
      });
      if (!latestAccrual) continue;
      const outcome = await this.reverseAccrual(tx, latestAccrual, {
        reason,
        afterSaleId,
      });
      reversedCents += outcome.reversedCents;
      pendingCents += outcome.pendingCents;
      recoveryDueCents += outcome.recoveryDueCents;
    }
    const unassigned = await tx.industryFundUnassignedEntry.findMany({
      where: { orderId, status: 'PENDING', reversedAmount: { lt: 0.000001 } },
    });
    for (const entry of unassigned) {
      await tx.industryFundUnassignedEntry.update({
        where: { id: entry.id },
        data: {
          reversedAmount: entry.amount,
          reversedAt: new Date(),
          reversalReason: reason,
        },
      });
    }
    return { reversedCents, pendingCents, recoveryDueCents };
  }

  async reverseOrder(
    tx: IndustryFundTx,
    input: IndustryFundReverseInput,
  ): Promise<{ reversedCents: number; pendingCents: number; recoveryDueCents: number }> {
    return this.reverseOrderInTransaction(tx, input.orderId, input.reason, input.afterSaleId);
  }

  async reservePayment(
    tx: IndustryFundTx,
    input: IndustryFundPaymentReserveInput,
  ): Promise<PaymentWithItems> {
    const amountCents = positiveCents(input.amount, 'payment amount');
    const existing = await tx.industryFundPayment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      if (yuanToCents(existing.amount) !== amountCents || existing.companyId !== input.companyId) {
        throw new IndustryFundError('IDEMPOTENCY_CONFLICT', `payment idempotency key already belongs to another payment: ${input.idempotencyKey}`);
      }
      return existing;
    }
    if (!input.payeeName.trim() || !input.bankAccount.trim() || !input.bankName.trim()) {
      throw new IndustryFundError('INVALID_PAYEE', 'payee name, bank account, and bank name are required');
    }

    const company = await tx.company.findUnique({
      where: { id: input.companyId },
      select: { id: true, name: true, status: true },
    });
    if (!company) throw new IndustryFundError('COMPANY_NOT_FOUND', `company not found: ${input.companyId}`);
    if (company.status !== 'ACTIVE') throw new IndustryFundError('COMPANY_NOT_ACTIVE', 'only active companies can receive payments');
    if (company.name.trim() !== input.payeeName.trim()) throw new IndustryFundError('PAYEE_NAME_MISMATCH', 'payee name must match the company legal name');

    const account = await tx.industryFundAccount.findUnique({ where: { companyId: input.companyId } });
    if (!account) throw new IndustryFundError('ACCOUNT_NOT_FOUND', `industry fund account not found: ${input.companyId}`);
    if (yuanToCents(account.recoveryDue) > 0) {
      throw new IndustryFundError('RECOVERY_DUE_BLOCKS_PAYMENT', `company has unpaid recovery: ${input.companyId}`);
    }
    if (yuanToCents(account.payableAmount) < amountCents) {
      throw new IndustryFundError('INSUFFICIENT_PAYABLE_BALANCE', 'payable balance is insufficient');
    }

    const accruals = await tx.industryFundAccrual.findMany({
      where: {
        accountId: account.id,
        payableAmount: { gt: 0 },
        reversalPendingAmount: 0,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    let remainingCents = amountCents;
    const items: Array<{ accrual: AccrualRow; cents: number }> = [];
    for (const accrual of accruals) {
      if (remainingCents <= 0) break;
      const payableCents = yuanToCents(accrual.payableAmount);
      const cents = Math.min(remainingCents, payableCents);
      if (cents > 0) {
        await this.assertOrderReleaseEligible(tx, accrual.orderId, new Date());
        items.push({ accrual, cents });
        remainingCents -= cents;
      }
    }
    if (remainingCents > 0) throw new IndustryFundError('INSUFFICIENT_PAYABLE_BALANCE', 'payable accruals are insufficient');

    const payment = await tx.industryFundPayment.create({
      data: {
        accountId: account.id,
        companyId: input.companyId,
        amount: centsToYuan(amountCents),
        payeeName: input.payeeName.trim(),
        bankAccount: input.bankAccount.trim(),
        bankName: input.bankName.trim(),
        reason: input.reason.trim(),
        createdBy: input.actorId,
        idempotencyKey: input.idempotencyKey,
      },
    });
    for (const item of items) {
      const updatedAccrual = await this.updateAccrualCas(tx, item.accrual, {
        payableAmount: centsToYuan(yuanToCents(item.accrual.payableAmount) - item.cents),
        reservedAmount: centsToYuan(yuanToCents(item.accrual.reservedAmount) + item.cents),
      });
      await tx.industryFundPaymentItem.create({
        data: {
          paymentId: payment.id,
          accrualId: updatedAccrual.id,
          amount: centsToYuan(item.cents),
          reservedAmount: centsToYuan(item.cents),
        },
      });
    }
    const nextAccount = await this.mutateAccount(tx, account, {
      ...zeroDelta(),
      payable: -amountCents,
      reserved: amountCents,
    });
    await this.createLedger(tx, nextAccount, {
      eventType: 'PAYMENT_RESERVED',
      amountCents,
      deltas: { ...zeroDelta(), payable: -amountCents, reserved: amountCents },
      companyId: input.companyId,
      paymentId: payment.id,
      idempotencyKey: `industry-fund:payment:${payment.id}:reserve`,
      reason: input.reason,
      actorId: input.actorId,
      actorType: input.actorType ?? 'ADMIN',
    });
    return tx.industryFundPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { items: true } });
  }

  async confirmPayment(
    tx: IndustryFundTx,
    paymentId: string,
    input: IndustryFundPaymentConfirmInput,
  ): Promise<PaymentWithItems> {
    const payment = await tx.industryFundPayment.findUnique({ where: { id: paymentId }, include: { items: true } });
    if (!payment) throw new IndustryFundError('PAYMENT_NOT_FOUND', `payment not found: ${paymentId}`);
    if (payment.status === 'PAID') {
      if (payment.bankReference !== input.bankReference || payment.proofKey !== input.proofKey) {
        throw new IndustryFundError('PAYMENT_ALREADY_CONFIRMED', 'payment has already been confirmed with different evidence');
      }
      return payment;
    }
    if (payment.status !== 'RESERVED') throw new IndustryFundError('INVALID_PAYMENT_STATE', `payment is ${payment.status}`);
    const actualPaymentOverride = payment.needsReview && Boolean(input.confirmActualPayment);
    if (payment.needsReview && !actualPaymentOverride) {
      throw new IndustryFundError('PAYMENT_NEEDS_REVIEW', 'payment is blocked by a pending reversal review; explicit actual-payment confirmation is required');
    }
    if (payment.needsReview && !input.confirmationReason?.trim()) {
      throw new IndustryFundError('CONFIRMATION_REASON_REQUIRED', 'a reason is required when confirming a payment flagged for reversal review');
    }
    const actualCents = positiveCents(input.actualAmount, 'actual payment amount');
    const expectedCents = yuanToCents(payment.amount);
    if (actualCents !== expectedCents) throw new IndustryFundError('PAYMENT_AMOUNT_MISMATCH', 'actual payment amount must equal reserved amount');
    if (!input.sourceAccountRef.trim() || !input.bankReference.trim() || !input.proofKey.trim()) {
      throw new IndustryFundError('PAYMENT_EVIDENCE_REQUIRED', 'source account, bank reference, and proof key are required');
    }
    const duplicate = await tx.industryFundPayment.findFirst({
      where: {
        sourceAccountRef: input.sourceAccountRef.trim(),
        bankReference: input.bankReference.trim(),
        id: { not: payment.id },
      },
      select: { id: true },
    });
    if (duplicate) throw new IndustryFundError('DUPLICATE_BANK_REFERENCE', 'bank reference already belongs to another payment');

    const account = await tx.industryFundAccount.findUnique({ where: { id: payment.accountId } });
    if (!account) throw new IndustryFundError('ACCOUNT_NOT_FOUND', `industry fund account not found: ${payment.accountId}`);
    const itemAmountCents = payment.items.reduce((sum, item) => sum + yuanToCents(item.reservedAmount), 0);
    if (itemAmountCents !== expectedCents) throw new IndustryFundError('PAYMENT_ITEM_MISMATCH', 'payment allocation does not equal payment amount');

    let currentAccount = account;
    for (const item of payment.items) {
      const reservedCents = yuanToCents(item.reservedAmount);
      if (reservedCents <= 0) continue;
      const accrual = await tx.industryFundAccrual.findUnique({ where: { id: item.accrualId }, include: { account: true } });
      if (!accrual) throw new IndustryFundError('ACCRUAL_NOT_FOUND', `accrual not found: ${item.accrualId}`);
      if (!actualPaymentOverride) await this.assertOrderReleaseEligible(tx, accrual.orderId, new Date());
      if (yuanToCents(accrual.reversalPendingAmount) > 0 && !actualPaymentOverride) {
        throw new IndustryFundError('PAYMENT_NEEDS_REVIEW', `accrual has a pending reversal: ${accrual.id}`);
      }
      const updatedAccrual = await this.updateAccrualCas(tx, accrual, {
        reservedAmount: centsToYuan(yuanToCents(accrual.reservedAmount) - reservedCents),
        paidAmount: centsToYuan(yuanToCents(accrual.paidAmount) + reservedCents),
      });
      void updatedAccrual;
      currentAccount = await this.mutateAccount(tx, currentAccount, {
        ...zeroDelta(),
        reserved: -reservedCents,
        totalPaid: reservedCents,
      });
      await tx.industryFundPaymentItem.update({
        where: { id: item.id },
        data: { reservedAmount: 0, paidAmount: { increment: centsToYuan(reservedCents) } },
      });
      await this.createLedger(tx, currentAccount, {
        eventType: 'PAYMENT_CONFIRMED',
        amountCents: reservedCents,
        deltas: { ...zeroDelta(), reserved: -reservedCents, paid: reservedCents, totalPaid: reservedCents },
        accrualId: accrual.id,
        companyId: payment.companyId,
        orderId: accrual.orderId,
        paymentId: payment.id,
        idempotencyKey: `industry-fund:payment:${payment.id}:confirm:${accrual.id}`,
        reason: '线下公对公付款登记',
        actorId: input.actorId,
        actorType: input.actorType ?? 'ADMIN',
        meta: {
          sourceAccountRef: input.sourceAccountRef.trim(),
          bankReference: input.bankReference.trim(),
          proofKey: input.proofKey.trim(),
          confirmationReason: input.confirmationReason,
          confirmActualPayment: actualPaymentOverride,
        },
      });
      if (actualPaymentOverride && yuanToCents(updatedAccrual.reversalPendingAmount) > 0) {
        const latest = await tx.industryFundAccrual.findUnique({ where: { id: accrual.id }, include: { account: true } });
        if (latest) {
          await this.finalizePendingReversal(tx, latest, input.confirmationReason ?? '已付款后售后冲回');
          const refreshedAccount = await tx.industryFundAccount.findUnique({ where: { id: payment.accountId } });
          if (!refreshedAccount) throw new IndustryFundError('ACCOUNT_NOT_FOUND', `industry fund account not found: ${payment.accountId}`);
          currentAccount = refreshedAccount;
        }
      }
    }
    await tx.industryFundPayment.updateMany({
      where: { id: payment.id, status: 'RESERVED' },
      data: {
        status: 'PAID',
        sourceAccountRef: input.sourceAccountRef.trim(),
        bankReference: input.bankReference.trim(),
        proofKey: input.proofKey.trim(),
        actualPaidAt: input.paidAt,
        confirmedBy: input.actorId,
      },
    });
    return tx.industryFundPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { items: true } });
  }

  async cancelPayment(
    tx: IndustryFundTx,
    paymentId: string,
    input: IndustryFundPaymentCancelInput,
  ): Promise<PaymentWithItems> {
    const payment = await tx.industryFundPayment.findUnique({ where: { id: paymentId }, include: { items: true } });
    if (!payment) throw new IndustryFundError('PAYMENT_NOT_FOUND', `payment not found: ${paymentId}`);
    if (payment.status === 'CANCELLED') return payment;
    if (payment.status !== 'RESERVED') throw new IndustryFundError('INVALID_PAYMENT_STATE', `payment is ${payment.status}`);
    const account = await tx.industryFundAccount.findUnique({ where: { id: payment.accountId } });
    if (!account) throw new IndustryFundError('ACCOUNT_NOT_FOUND', `industry fund account not found: ${payment.accountId}`);
    const totalReservedCents = payment.items.reduce((sum, item) => sum + yuanToCents(item.reservedAmount), 0);
    const paymentCents = yuanToCents(payment.amount);
    if (totalReservedCents !== paymentCents) throw new IndustryFundError('PAYMENT_ITEM_MISMATCH', 'payment allocation does not equal payment amount');
    const pendingAccrualIds: string[] = [];
    for (const item of payment.items) {
      const reservedCents = yuanToCents(item.reservedAmount);
      if (reservedCents <= 0) continue;
      const accrual = await tx.industryFundAccrual.findUnique({ where: { id: item.accrualId }, include: { account: true } });
      if (!accrual) throw new IndustryFundError('ACCRUAL_NOT_FOUND', `accrual not found: ${item.accrualId}`);
      await this.updateAccrualCas(tx, accrual, {
        reservedAmount: centsToYuan(yuanToCents(accrual.reservedAmount) - reservedCents),
        payableAmount: centsToYuan(yuanToCents(accrual.payableAmount) + reservedCents),
      });
      await tx.industryFundPaymentItem.update({ where: { id: item.id }, data: { reservedAmount: 0 } });
      if (yuanToCents(accrual.reversalPendingAmount) > 0) pendingAccrualIds.push(accrual.id);
    }
    const nextAccount = await this.mutateAccount(tx, account, {
      ...zeroDelta(),
      reserved: -totalReservedCents,
      payable: totalReservedCents,
    });
    await this.createLedger(tx, nextAccount, {
      eventType: 'PAYMENT_UNRESERVED',
      amountCents: totalReservedCents,
      deltas: { ...zeroDelta(), reserved: -totalReservedCents, payable: totalReservedCents },
      companyId: payment.companyId,
      paymentId: payment.id,
      idempotencyKey: `industry-fund:payment:${payment.id}:cancel`,
      reason: input.reason,
      actorId: input.actorId,
      actorType: input.actorType ?? 'ADMIN',
    });
    await tx.industryFundPayment.update({
      where: { id: payment.id },
      data: { status: 'CANCELLED', cancelledBy: input.actorId },
    });
    for (const accrualId of pendingAccrualIds) {
      const latest = await tx.industryFundAccrual.findUnique({ where: { id: accrualId }, include: { account: true } });
      if (latest && yuanToCents(latest.reservedAmount) === 0) await this.finalizePendingReversal(tx, latest, input.reason);
    }
    return tx.industryFundPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { items: true } });
  }

  async reversePayment(
    tx: IndustryFundTx,
    paymentId: string,
    input: IndustryFundPaymentCancelInput,
  ): Promise<PaymentWithItems> {
    const payment = await tx.industryFundPayment.findUnique({ where: { id: paymentId }, include: { items: true } });
    if (!payment) throw new IndustryFundError('PAYMENT_NOT_FOUND', `payment not found: ${paymentId}`);
    if (payment.status === 'REVERSED') return payment;
    if (payment.status !== 'PAID') throw new IndustryFundError('INVALID_PAYMENT_STATE', `payment is ${payment.status}`);
    const account = await tx.industryFundAccount.findUnique({ where: { id: payment.accountId } });
    if (!account) throw new IndustryFundError('ACCOUNT_NOT_FOUND', `industry fund account not found: ${payment.accountId}`);
    let totalPaidCents = 0;
    for (const item of payment.items) {
      const paidCents = yuanToCents(item.paidAmount);
      if (paidCents <= 0) continue;
      const accrual = await tx.industryFundAccrual.findUnique({ where: { id: item.accrualId }, include: { account: true } });
      if (!accrual) throw new IndustryFundError('ACCRUAL_NOT_FOUND', `accrual not found: ${item.accrualId}`);
      if (yuanToCents(accrual.reversedAmount) > 0 || yuanToCents(accrual.reversalPendingAmount) > 0 || yuanToCents(item.recoveryDue) > 0) {
        throw new IndustryFundError('PAYMENT_REVERSE_BLOCKED', 'payment is already involved in an order reversal');
      }
      await this.updateAccrualCas(tx, accrual, {
        paidAmount: centsToYuan(yuanToCents(accrual.paidAmount) - paidCents),
        payableAmount: centsToYuan(yuanToCents(accrual.payableAmount) + paidCents),
      });
      await tx.industryFundPaymentItem.update({ where: { id: item.id }, data: { paidAmount: 0 } });
      totalPaidCents += paidCents;
    }
    const nextAccount = await this.mutateAccount(tx, account, {
      ...zeroDelta(),
      payable: totalPaidCents,
      totalPaid: -totalPaidCents,
    });
    await this.createLedger(tx, nextAccount, {
      eventType: 'PAYMENT_REVERSED',
      amountCents: totalPaidCents,
      deltas: { ...zeroDelta(), payable: totalPaidCents, paid: -totalPaidCents, totalPaid: -totalPaidCents },
      companyId: payment.companyId,
      paymentId: payment.id,
      idempotencyKey: `industry-fund:payment:${payment.id}:reverse`,
      reason: input.reason,
      actorId: input.actorId,
      actorType: input.actorType ?? 'ADMIN',
    });
    await tx.industryFundPayment.update({ where: { id: payment.id }, data: { status: 'REVERSED', reversedBy: input.actorId } });
    return tx.industryFundPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { items: true } });
  }

  async recordRecovery(
    tx: IndustryFundTx,
    paymentId: string,
    input: IndustryFundRecoveryInput,
  ): Promise<{ amountCents: number; recoveryId: string; ledgerIds: string[] }> {
    const existing = await tx.industryFundRecovery.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { items: true },
    });
    if (existing) {
      return {
        amountCents: yuanToCents(existing.amount),
        recoveryId: existing.id,
        ledgerIds: [],
      };
    }
    const amountCents = positiveCents(input.amount, 'recovery amount');
    if (!input.bankReference.trim() || !input.proofKey.trim()) throw new IndustryFundError('RECOVERY_EVIDENCE_REQUIRED', 'bank reference and proof key are required');
    const duplicate = await tx.industryFundRecovery.findUnique({ where: { bankReference: input.bankReference.trim() }, select: { id: true } });
    if (duplicate) throw new IndustryFundError('DUPLICATE_BANK_REFERENCE', 'bank reference already used for a recovery');
    const payment = await tx.industryFundPayment.findUnique({ where: { id: paymentId }, include: { items: true } });
    if (!payment) throw new IndustryFundError('PAYMENT_NOT_FOUND', `payment not found: ${paymentId}`);
    if (payment.status !== 'PAID' && payment.status !== 'REVERSED') throw new IndustryFundError('INVALID_PAYMENT_STATE', 'only an actual payment can have a recovery');
    const account = await tx.industryFundAccount.findUnique({ where: { id: payment.accountId } });
    if (!account) throw new IndustryFundError('ACCOUNT_NOT_FOUND', `industry fund account not found: ${payment.accountId}`);
    if (yuanToCents(account.recoveryDue) < amountCents) throw new IndustryFundError('RECOVERY_EXCEEDS_DUE', 'recovery exceeds the company recovery due');
    const recoveryItems = payment.items
      .filter((item) => yuanToCents(item.recoveryDue) > 0)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
    const availableCents = recoveryItems.reduce((sum, item) => sum + yuanToCents(item.recoveryDue), 0);
    if (availableCents < amountCents) throw new IndustryFundError('RECOVERY_PAYMENT_SCOPE_EXCEEDED', 'recovery exceeds the selected payment recovery due');

    const recovery = await tx.industryFundRecovery.create({
      data: {
        accountId: account.id,
        companyId: payment.companyId,
        paymentId: payment.id,
        amount: centsToYuan(amountCents),
        bankReference: input.bankReference.trim(),
        proofKey: input.proofKey.trim(),
        recoveredAt: input.recoveredAt,
        reason: input.reason,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
      },
    });
    let remainingCents = amountCents;
    let currentAccount = account;
    const ledgerIds: string[] = [];
    for (const item of recoveryItems) {
      if (remainingCents <= 0) break;
      const dueCents = yuanToCents(item.recoveryDue);
      const cents = Math.min(remainingCents, dueCents);
      if (cents <= 0) continue;
      const accrual = await tx.industryFundAccrual.findUnique({ where: { id: item.accrualId }, include: { account: true } });
      if (!accrual) throw new IndustryFundError('ACCRUAL_NOT_FOUND', `accrual not found: ${item.accrualId}`);
      await this.updateAccrualCas(tx, accrual, {
        recoveryDue: centsToYuan(yuanToCents(accrual.recoveryDue) - cents),
        recoveredAmount: centsToYuan(yuanToCents(accrual.recoveredAmount) + cents),
      });
      await tx.industryFundPaymentItem.update({
        where: { id: item.id },
        data: {
          recoveryDue: centsToYuan(dueCents - cents),
          recoveredAmount: { increment: centsToYuan(cents) },
        },
      });
      await tx.industryFundRecoveryItem.create({
        data: { recoveryId: recovery.id, accrualId: accrual.id, amount: centsToYuan(cents) },
      });
      currentAccount = await this.mutateAccount(tx, currentAccount, {
        ...zeroDelta(),
        recoveryDue: -cents,
        recovered: cents,
        totalRecovered: cents,
      });
      const ledger = await this.createLedger(tx, currentAccount, {
        eventType: 'RECOVERY',
        amountCents: cents,
        deltas: { ...zeroDelta(), recoveryDue: -cents, recovered: cents, totalRecovered: cents },
        accrualId: accrual.id,
        companyId: payment.companyId,
        orderId: accrual.orderId,
        paymentId: payment.id,
        recoveryId: recovery.id,
        bankReference: input.bankReference.trim(),
        idempotencyKey: `${input.idempotencyKey}:${accrual.id}`,
        reason: input.reason,
        actorId: input.actorId,
        actorType: input.actorType ?? 'ADMIN',
        meta: { recoveredAt: input.recoveredAt, proofKey: input.proofKey.trim() },
      });
      ledgerIds.push(ledger.id);
      remainingCents -= cents;
    }
    if (remainingCents > 0) throw new IndustryFundError('RECOVERY_ACCRUAL_MISMATCH', 'recovery due could not be allocated to accruals');
    return { amountCents, recoveryId: recovery.id, ledgerIds };
  }

  async reconcileAccount(
    tx: IndustryFundTx,
    companyId: string,
  ): Promise<{
    ok: boolean;
    accountId: string;
    expected: AccountDelta;
    actual: AccountDelta;
    discrepancyCents: number;
    errors: string[];
  }> {
    const account = await tx.industryFundAccount.findUnique({ where: { companyId } });
    if (!account) throw new IndustryFundError('ACCOUNT_NOT_FOUND', `industry fund account not found: ${companyId}`);
    const ledgerOrderBy: Prisma.IndustryFundLedgerOrderByWithRelationInput[] = [
      { sequence: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ];
    const [accruals, ledgers, payments, recoveries] = await Promise.all([
      tx.industryFundAccrual.findMany({ where: { accountId: account.id } }),
      tx.industryFundLedger.findMany({ where: { accountId: account.id }, orderBy: ledgerOrderBy }),
      tx.industryFundPayment.findMany({ where: { accountId: account.id }, include: { items: true } }),
      tx.industryFundRecovery.findMany({ where: { accountId: account.id }, include: { items: true } }),
    ]);
    const errors: string[] = [];
    const fail = (message: string): void => {
      errors.push(message);
    };
    const accrualById = new Map(accruals.map((accrual) => [accrual.id, accrual]));
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    const paymentItemTotals = new Map<string, AccountDelta>();
    const paymentItemRecovered = new Map<string, number>();
    const recoveryItemTotals = new Map<string, number>();
    const recoveryItemByPaymentAccrual = new Map<string, number>();

    for (const payment of payments) {
      const paymentCents = yuanToCents(payment.amount);
      const itemAmountCents = payment.items.reduce((sum, item) => sum + yuanToCents(item.amount), 0);
      const itemReservedCents = payment.items.reduce((sum, item) => sum + yuanToCents(item.reservedAmount), 0);
      const itemPaidCents = payment.items.reduce((sum, item) => sum + yuanToCents(item.paidAmount), 0);
      const itemRecoveryDueCents = payment.items.reduce((sum, item) => sum + yuanToCents(item.recoveryDue), 0);
      const itemRecoveredCents = payment.items.reduce((sum, item) => sum + yuanToCents(item.recoveredAmount), 0);
      if (itemAmountCents !== paymentCents) fail(`PAYMENT_ITEM_AMOUNT_MISMATCH:${payment.id}`);
      if (payment.status === 'RESERVED' && (itemReservedCents !== paymentCents || itemPaidCents !== 0 || itemRecoveryDueCents !== 0 || itemRecoveredCents !== 0)) {
        fail(`PAYMENT_RESERVED_STATE_MISMATCH:${payment.id}`);
      }
      if (payment.status === 'PAID' && (itemReservedCents !== 0 || itemPaidCents !== paymentCents)) {
        fail(`PAYMENT_PAID_STATE_MISMATCH:${payment.id}`);
      }
      if ((payment.status === 'CANCELLED' || payment.status === 'REVERSED') && (itemReservedCents !== 0 || itemPaidCents !== 0 || itemRecoveryDueCents !== 0 || itemRecoveredCents !== 0)) {
        fail(`PAYMENT_CLOSED_STATE_MISMATCH:${payment.id}`);
      }
      for (const item of payment.items) {
        const accrual = accrualById.get(item.accrualId);
        if (!accrual) {
          fail(`PAYMENT_ITEM_ACCRUAL_MISSING:${payment.id}:${item.accrualId}`);
          continue;
        }
        if (accrual.accountId !== account.id) fail(`PAYMENT_ITEM_ACCOUNT_MISMATCH:${item.id}`);
        const itemRecoveryDueCents = yuanToCents(item.recoveryDue);
        const itemRecoveredCents = yuanToCents(item.recoveredAmount);
        const itemPaidCents = yuanToCents(item.paidAmount);
        if (itemRecoveryDueCents + itemRecoveredCents > itemPaidCents) fail(`PAYMENT_ITEM_RECOVERY_OVER_PAID:${item.id}`);
        const current = paymentItemTotals.get(item.accrualId) ?? zeroDelta();
        current.reserved += yuanToCents(item.reservedAmount);
        current.totalPaid += itemPaidCents;
        current.recoveryDue += itemRecoveryDueCents;
        current.totalRecovered += itemRecoveredCents;
        paymentItemTotals.set(item.accrualId, current);
        paymentItemRecovered.set(`${payment.id}:${item.accrualId}`, itemRecoveredCents);
      }
    }

    let recoveryParentTotalCents = 0;
    for (const recovery of recoveries) {
      const payment = paymentById.get(recovery.paymentId);
      if (!payment) fail(`RECOVERY_PAYMENT_MISSING:${recovery.id}`);
      if (payment && payment.accountId !== account.id) fail(`RECOVERY_PAYMENT_ACCOUNT_MISMATCH:${recovery.id}`);
      const recoveryAmountCents = yuanToCents(recovery.amount);
      const itemAmountCents = recovery.items.reduce((sum, item) => sum + yuanToCents(item.amount), 0);
      if (itemAmountCents !== recoveryAmountCents) fail(`RECOVERY_ITEM_AMOUNT_MISMATCH:${recovery.id}`);
      recoveryParentTotalCents += recoveryAmountCents;
      for (const item of recovery.items) {
        const accrual = accrualById.get(item.accrualId);
        if (!accrual) {
          fail(`RECOVERY_ITEM_ACCRUAL_MISSING:${recovery.id}:${item.accrualId}`);
          continue;
        }
        if (accrual.accountId !== account.id) fail(`RECOVERY_ITEM_ACCOUNT_MISMATCH:${item.id}`);
        recoveryItemTotals.set(item.accrualId, (recoveryItemTotals.get(item.accrualId) ?? 0) + yuanToCents(item.amount));
        recoveryItemByPaymentAccrual.set(
          `${recovery.paymentId}:${item.accrualId}`,
          (recoveryItemByPaymentAccrual.get(`${recovery.paymentId}:${item.accrualId}`) ?? 0) + yuanToCents(item.amount),
        );
      }
    }

    for (const payment of payments) {
      for (const item of payment.items) {
        const persistedRecoveredCents = paymentItemRecovered.get(`${payment.id}:${item.accrualId}`) ?? 0;
        const recoveredByParentCents = recoveryItemByPaymentAccrual.get(`${payment.id}:${item.accrualId}`) ?? 0;
        if (persistedRecoveredCents !== recoveredByParentCents) fail(`PAYMENT_ITEM_RECOVERY_MISMATCH:${item.id}`);
      }
    }
    const expected = zeroDelta();
    for (const accrual of accruals) {
      expected.frozen += yuanToCents(accrual.frozenAmount);
      expected.payable += yuanToCents(accrual.payableAmount);
      expected.reserved += yuanToCents(accrual.reservedAmount);
      expected.totalAccrued += yuanToCents(accrual.originalAmount);
      expected.totalReversed += yuanToCents(accrual.reversedAmount);
      expected.totalPaid += yuanToCents(accrual.paidAmount);
      expected.totalRecovered += yuanToCents(accrual.recoveredAmount);
      expected.recoveryDue += yuanToCents(accrual.recoveryDue);
      const paymentTotals = paymentItemTotals.get(accrual.id) ?? zeroDelta();
      if (paymentTotals.reserved !== yuanToCents(accrual.reservedAmount)) fail(`ACCRUAL_RESERVED_ITEMS_MISMATCH:${accrual.id}`);
      if (paymentTotals.totalPaid !== yuanToCents(accrual.paidAmount)) fail(`ACCRUAL_PAID_ITEMS_MISMATCH:${accrual.id}`);
      if (paymentTotals.recoveryDue !== yuanToCents(accrual.recoveryDue)) fail(`ACCRUAL_RECOVERY_DUE_ITEMS_MISMATCH:${accrual.id}`);
      if (paymentTotals.totalRecovered !== yuanToCents(accrual.recoveredAmount)) fail(`ACCRUAL_RECOVERED_ITEMS_MISMATCH:${accrual.id}`);
      if ((recoveryItemTotals.get(accrual.id) ?? 0) !== yuanToCents(accrual.recoveredAmount)) fail(`ACCRUAL_RECOVERY_ITEMS_MISMATCH:${accrual.id}`);
    }
    const actual: AccountDelta = {
      frozen: yuanToCents(account.frozenAmount),
      payable: yuanToCents(account.payableAmount),
      reserved: yuanToCents(account.reservedAmount),
      paid: 0,
      recovered: 0,
      recoveryDue: yuanToCents(account.recoveryDue),
      totalAccrued: yuanToCents(account.totalAccrued),
      totalReversed: yuanToCents(account.totalReversed),
      totalPaid: yuanToCents(account.totalPaid),
      totalRecovered: yuanToCents(account.totalRecovered),
    };
    const ledgerTotals = zeroDelta();
    let ledgerRunning = { frozen: 0, payable: 0, reserved: 0, recoveryDue: 0 };
    let previousSequence: bigint | null = null;
    for (const ledger of ledgers) {
      const dynamicLedger = ledger as unknown as { sequence?: bigint | number | string };
      if (dynamicLedger.sequence !== undefined) {
        let sequence: bigint;
        try {
          sequence = BigInt(String(dynamicLedger.sequence));
        } catch {
          fail(`LEDGER_SEQUENCE_INVALID:${ledger.id}`);
          sequence = previousSequence ?? 0n;
        }
        if (previousSequence !== null && sequence <= previousSequence) fail(`LEDGER_SEQUENCE_NOT_MONOTONIC:${ledger.id}`);
        previousSequence = sequence;
      }
      ledgerTotals.frozen += signedYuanToCents(ledger.frozenDelta);
      ledgerTotals.payable += signedYuanToCents(ledger.payableDelta);
      ledgerTotals.reserved += signedYuanToCents(ledger.reservedDelta);
      ledgerTotals.paid += signedYuanToCents(ledger.paidDelta);
      ledgerTotals.recovered += signedYuanToCents(ledger.recoveredDelta);
      ledgerTotals.recoveryDue += signedYuanToCents(ledger.recoveryDueDelta);
      ledgerTotals.totalAccrued += signedYuanToCents(ledger.totalAccruedDelta);
      ledgerTotals.totalReversed += signedYuanToCents(ledger.totalReversedDelta);
      ledgerTotals.totalPaid += signedYuanToCents(ledger.totalPaidDelta);
      ledgerTotals.totalRecovered += signedYuanToCents(ledger.totalRecoveredDelta);
      ledgerRunning.frozen += signedYuanToCents(ledger.frozenDelta);
      ledgerRunning.payable += signedYuanToCents(ledger.payableDelta);
      ledgerRunning.reserved += signedYuanToCents(ledger.reservedDelta);
      ledgerRunning.recoveryDue += signedYuanToCents(ledger.recoveryDueDelta);
      if (ledgerRunning.frozen !== yuanToCents(ledger.balanceFrozen) ||
        ledgerRunning.payable !== yuanToCents(ledger.balancePayable) ||
        ledgerRunning.reserved !== yuanToCents(ledger.balanceReserved) ||
        ledgerRunning.recoveryDue !== yuanToCents(ledger.balanceRecoveryDue)) {
        fail(`LEDGER_BALANCE_AFTER_MISMATCH:${ledger.id}`);
      }
    }
    const expectedNet = expected.totalAccrued - expected.totalReversed - expected.totalPaid + expected.totalRecovered;
    const actualNet = actual.frozen + actual.payable + actual.reserved - actual.recoveryDue;
    const ledgerNet = ledgerTotals.totalAccrued - ledgerTotals.totalReversed - ledgerTotals.totalPaid + ledgerTotals.totalRecovered;
    const projectionMatches = expected.frozen === actual.frozen &&
      expected.payable === actual.payable &&
      expected.reserved === actual.reserved &&
      expected.recoveryDue === actual.recoveryDue &&
      expected.totalAccrued === actual.totalAccrued &&
      expected.totalReversed === actual.totalReversed &&
      expected.totalPaid === actual.totalPaid &&
      expected.totalRecovered === actual.totalRecovered;
    const ledgerMatches = ledgerTotals.frozen === actual.frozen &&
      ledgerTotals.payable === actual.payable &&
      ledgerTotals.reserved === actual.reserved &&
      ledgerTotals.recoveryDue === actual.recoveryDue &&
      ledgerTotals.totalAccrued === actual.totalAccrued &&
      ledgerTotals.totalReversed === actual.totalReversed &&
      ledgerTotals.totalPaid === actual.totalPaid &&
      ledgerTotals.totalRecovered === actual.totalRecovered;
    const discrepancies = [
      expectedNet - actualNet,
      actual.frozen - expected.frozen,
      actual.payable - expected.payable,
      actual.reserved - expected.reserved,
      actual.recoveryDue - expected.recoveryDue,
      actual.totalAccrued - ledgerTotals.totalAccrued,
      actual.totalReversed - ledgerTotals.totalReversed,
      actual.totalPaid - ledgerTotals.totalPaid,
      actual.totalRecovered - ledgerTotals.totalRecovered,
    ];
    return {
      ok: expectedNet === actualNet && ledgerNet === actualNet && projectionMatches && ledgerMatches &&
        ledgerRunning.frozen === actual.frozen && ledgerRunning.payable === actual.payable &&
        ledgerRunning.reserved === actual.reserved && ledgerRunning.recoveryDue === actual.recoveryDue &&
        recoveryParentTotalCents === actual.totalRecovered && errors.length === 0,
      accountId: account.id,
      expected,
      actual,
      discrepancyCents: discrepancies.reduce((max, value) => Math.max(max, Math.abs(value)), errors.length > 0 ? 1 : 0),
      errors,
    };
  }

  private async reverseAccrual(
    tx: IndustryFundTx,
    accrual: AccrualWithAccount,
    input: { reason: string; afterSaleId?: string },
  ): Promise<{ reversedCents: number; pendingCents: number; recoveryDueCents: number }> {
    const frozenCents = yuanToCents(accrual.frozenAmount);
    const payableCents = yuanToCents(accrual.payableAmount);
    const paidOutstandingCents = Math.max(0, yuanToCents(accrual.paidAmount) - yuanToCents(accrual.reversedPaidAmount));
    const reservedCents = yuanToCents(accrual.reservedAmount);
    const existingReversal = await tx.industryFundLedger.findUnique({
      where: { idempotencyKey: `industry-fund:reversal:${accrual.orderId}:${accrual.id}` },
    });
    if (existingReversal && reservedCents <= 0) {
      return { reversedCents: yuanToCents(existingReversal.amount), pendingCents: yuanToCents(accrual.reversalPendingAmount), recoveryDueCents: yuanToCents(accrual.recoveryDue) };
    }

    let workingAccrual: AccrualRow = accrual;
    let pendingCents = yuanToCents(accrual.reversalPendingAmount);
    if (reservedCents > 0 && pendingCents < reservedCents) {
      pendingCents = reservedCents;
      workingAccrual = await this.updateAccrualCas(tx, accrual, {
        reversalPendingAmount: centsToYuan(pendingCents),
        reversalPendingReason: input.reason,
      });
      const paymentItems = await tx.industryFundPaymentItem.findMany({
        where: { accrualId: accrual.id, reservedAmount: { gt: 0 } },
        select: { paymentId: true },
      });
      for (const item of paymentItems) {
        await tx.industryFundPayment.updateMany({
          where: { id: item.paymentId, status: 'RESERVED' },
          data: { needsReview: true, reviewReason: input.reason },
        });
      }
      const pendingLedgerExists = await tx.industryFundLedger.findUnique({
        where: { idempotencyKey: `industry-fund:reversal-pending:${accrual.id}` },
      });
      if (!pendingLedgerExists) {
        await this.createLedger(tx, accrual.account, {
          eventType: 'REVERSAL_PENDING',
          amountCents: 0,
          deltas: zeroDelta(),
          accrualId: accrual.id,
          companyId: accrual.companyId,
          allocationId: accrual.allocationId,
          orderId: accrual.orderId,
          afterSaleId: input.afterSaleId,
          idempotencyKey: `industry-fund:reversal-pending:${accrual.id}`,
          reason: input.reason,
          actorType: 'SYSTEM',
          meta: { pendingAmount: centsToYuan(pendingCents), affectedPaymentIds: paymentItems.map((item) => item.paymentId) },
        });
      }
    }

    if (paidOutstandingCents > 0) {
      const paidItems = await tx.industryFundPaymentItem.findMany({
        where: { accrualId: accrual.id, paidAmount: { gt: 0 } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      let remainingPaidCents = paidOutstandingCents;
      for (const item of paidItems) {
        if (remainingPaidCents <= 0) break;
        const itemPaidCents = yuanToCents(item.paidAmount);
        const itemRecoveryDueCents = yuanToCents(item.recoveryDue);
        const itemRecoveredCents = yuanToCents(item.recoveredAmount);
        const itemCapacityCents = Math.max(0, itemPaidCents - itemRecoveryDueCents - itemRecoveredCents);
        const itemReversalCents = Math.min(remainingPaidCents, itemCapacityCents);
        if (itemReversalCents > 0) {
          await tx.industryFundPaymentItem.update({
            where: { id: item.id },
            data: { recoveryDue: { increment: centsToYuan(itemReversalCents) } },
          });
          remainingPaidCents -= itemReversalCents;
        }
      }
      if (remainingPaidCents > 0) {
        throw new IndustryFundError('PAYMENT_ITEM_MISMATCH', `paid accrual has no payment item recovery capacity: ${accrual.id}`);
      }
    }

    const immediateCents = frozenCents + payableCents + paidOutstandingCents;
    if (immediateCents <= 0) {
      return { reversedCents: 0, pendingCents, recoveryDueCents: paidOutstandingCents };
    }
    const updatedAccrual = await this.updateAccrualCas(tx, workingAccrual, {
      frozenAmount: 0,
      payableAmount: 0,
      reversedAmount: centsToYuan(yuanToCents(accrual.reversedAmount) + immediateCents),
      reversedPaidAmount: centsToYuan(yuanToCents(accrual.reversedPaidAmount) + paidOutstandingCents),
      recoveryDue: centsToYuan(yuanToCents(accrual.recoveryDue) + paidOutstandingCents),
      reversedAt: pendingCents === 0 ? new Date() : undefined,
    });
    void updatedAccrual;
    const nextAccount = await this.mutateAccount(tx, accrual.account, {
      ...zeroDelta(),
      frozen: -frozenCents,
      payable: -payableCents,
      recoveryDue: paidOutstandingCents,
      totalReversed: immediateCents,
    });
    await this.createLedger(tx, nextAccount, {
      eventType: 'REVERSAL',
      amountCents: immediateCents,
      deltas: {
        ...zeroDelta(),
        frozen: -frozenCents,
        payable: -payableCents,
        recoveryDue: paidOutstandingCents,
        totalReversed: immediateCents,
      },
      accrualId: accrual.id,
      companyId: accrual.companyId,
      allocationId: accrual.allocationId,
      orderId: accrual.orderId,
      afterSaleId: input.afterSaleId,
      idempotencyKey: `industry-fund:reversal:${accrual.orderId}:${accrual.id}`,
      reason: input.reason,
      actorType: 'SYSTEM',
    });
    return { reversedCents: immediateCents, pendingCents, recoveryDueCents: paidOutstandingCents };
  }

  private async finalizePendingReversal(
    tx: IndustryFundTx,
    accrual: AccrualWithAccount,
    reason: string,
  ): Promise<void> {
    const pendingCents = yuanToCents(accrual.reversalPendingAmount);
    if (pendingCents <= 0) return;
    if (yuanToCents(accrual.reservedAmount) > 0) return;
    const payableCents = yuanToCents(accrual.payableAmount);
    const paidItems = await tx.industryFundPaymentItem.findMany({
      where: { accrualId: accrual.id, paidAmount: { gt: 0 } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    let paidCapacityCents = 0;
    for (const item of paidItems) {
      paidCapacityCents += Math.max(
        0,
        yuanToCents(item.paidAmount) - yuanToCents(item.recoveryDue) - yuanToCents(item.recoveredAmount),
      );
    }
    const paidReversalCents = Math.min(pendingCents, paidCapacityCents);
    const payableReversalCents = pendingCents - paidReversalCents;
    if (payableCents < payableReversalCents) throw new IndustryFundError('REVERSAL_UNDERFLOW', `pending reversal exceeds recoverable amounts: ${accrual.id}`);
    let remainingPaidCents = paidReversalCents;
    for (const item of paidItems) {
      if (remainingPaidCents <= 0) break;
      const itemCapacityCents = Math.max(
        0,
        yuanToCents(item.paidAmount) - yuanToCents(item.recoveryDue) - yuanToCents(item.recoveredAmount),
      );
      const itemCents = Math.min(remainingPaidCents, itemCapacityCents);
      if (itemCents > 0) {
        await tx.industryFundPaymentItem.update({
          where: { id: item.id },
          data: { recoveryDue: { increment: centsToYuan(itemCents) } },
        });
        remainingPaidCents -= itemCents;
      }
    }
    await this.updateAccrualCas(tx, accrual, {
      payableAmount: centsToYuan(payableCents - payableReversalCents),
      reversedAmount: centsToYuan(yuanToCents(accrual.reversedAmount) + pendingCents),
      reversedPaidAmount: centsToYuan(yuanToCents(accrual.reversedPaidAmount) + paidReversalCents),
      recoveryDue: centsToYuan(yuanToCents(accrual.recoveryDue) + paidReversalCents),
      reversalPendingAmount: 0,
      reversalPendingReason: null,
      reversedAt: new Date(),
    });
    const nextAccount = await this.mutateAccount(tx, accrual.account, {
      ...zeroDelta(),
      payable: -payableReversalCents,
      recoveryDue: paidReversalCents,
      totalReversed: pendingCents,
    });
    await this.createLedger(tx, nextAccount, {
      eventType: 'REVERSAL',
      amountCents: pendingCents,
      deltas: {
        ...zeroDelta(),
        payable: -payableReversalCents,
        recoveryDue: paidReversalCents,
        totalReversed: pendingCents,
      },
      accrualId: accrual.id,
      companyId: accrual.companyId,
      allocationId: accrual.allocationId,
      orderId: accrual.orderId,
      idempotencyKey: `industry-fund:pending-reversal:${accrual.id}`,
      reason,
      actorType: 'SYSTEM',
    });
  }

  private async isVerifiedPickupOrder(tx: IndustryFundTx, orderId: string): Promise<boolean> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        fulfillmentMode: true,
        status: true,
        pickupFulfillment: { select: { status: true } },
      },
    });
    return order?.fulfillmentMode === 'PICKUP' &&
      order.status === 'RECEIVED' &&
      order.pickupFulfillment?.status === 'PICKED_UP';
  }

  private async assertOrderReleaseEligible(
    tx: IndustryFundTx,
    orderId: string,
    now: Date,
  ): Promise<'PICKUP_VERIFIED' | 'DELIVERY'> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        fulfillmentMode: true,
        status: true,
        pickupFulfillment: { select: { status: true } },
        returnWindowExpiresAt: true,
        afterSaleRequests: { select: { status: true } },
      },
    });
    if (!order) throw new IndustryFundError('ORDER_NOT_FOUND', `order not found: ${orderId}`);
    if (order.afterSaleRequests.some((item) => !SAFE_AFTER_SALE_STATUSES.has(item.status))) {
      throw new IndustryFundError('AFTER_SALE_ACTIVE', `order has a non-terminal after-sale: ${orderId}`);
    }

    if (order.fulfillmentMode === 'PICKUP') {
      if (order.status !== 'RECEIVED' || order.pickupFulfillment?.status !== 'PICKED_UP') {
        throw new IndustryFundError('PICKUP_NOT_VERIFIED', `pickup order is not verified: ${orderId}`);
      }
      return 'PICKUP_VERIFIED';
    }

    if (!order.returnWindowExpiresAt || order.returnWindowExpiresAt > now) {
      throw new IndustryFundError('RETURN_WINDOW_OPEN', `order return window is still open: ${orderId}`);
    }
    return 'DELIVERY';
  }

  private async updateAccrualCas(
    tx: IndustryFundTx,
    accrual: AccrualRow,
    changes: Prisma.IndustryFundAccrualUpdateInput,
  ): Promise<AccrualRow> {
    const stateFields = [
      'originalAmount', 'frozenAmount', 'payableAmount', 'reservedAmount',
      'paidAmount', 'reversedAmount', 'reversedPaidAmount', 'recoveredAmount',
      'recoveryDue', 'reversalPendingAmount',
    ] as const;
    const nextState = Object.fromEntries(stateFields.map((field) => {
      const current = yuanToCents(Number(accrual[field]));
      const change = changes[field];
      return [field, typeof change === 'number' ? yuanToCents(change) : current];
    })) as Record<(typeof stateFields)[number], number>;
    if (nextState.originalAmount <= 0 || nextState.frozenAmount < 0 || nextState.payableAmount < 0 || nextState.reservedAmount < 0 || nextState.paidAmount < 0 || nextState.reversedAmount < 0 || nextState.reversedPaidAmount < 0 || nextState.recoveredAmount < 0 || nextState.recoveryDue < 0 || nextState.reversalPendingAmount < 0) {
      throw new IndustryFundError('ACCRUAL_UNDERFLOW', `accrual state would become negative: ${accrual.id}`);
    }
    if (nextState.reversedPaidAmount > nextState.paidAmount) {
      throw new IndustryFundError('ACCRUAL_STATE_INVALID', `reversed paid amount exceeds paid amount: ${accrual.id}`);
    }
    if (nextState.recoveredAmount > nextState.reversedPaidAmount || nextState.recoveryDue > nextState.reversedPaidAmount - nextState.recoveredAmount) {
      throw new IndustryFundError('ACCRUAL_STATE_INVALID', `recovery state exceeds reversed paid amount: ${accrual.id}`);
    }
    const result = await tx.industryFundAccrual.updateMany({
      where: { id: accrual.id, version: accrual.version },
      data: { ...changes, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new IndustryFundError('CONCURRENT_ACCRUAL_UPDATE', `accrual changed concurrently: ${accrual.id}`);
    return tx.industryFundAccrual.findUniqueOrThrow({ where: { id: accrual.id } });
  }

  private async mutateAccount(
    tx: IndustryFundTx,
    account: AccountRow,
    delta: AccountDelta,
  ): Promise<AccountRow> {
    const current = {
      frozen: yuanToCents(account.frozenAmount),
      payable: yuanToCents(account.payableAmount),
      reserved: yuanToCents(account.reservedAmount),
      recoveryDue: yuanToCents(account.recoveryDue),
      totalAccrued: yuanToCents(account.totalAccrued),
      totalReversed: yuanToCents(account.totalReversed),
      totalPaid: yuanToCents(account.totalPaid),
      totalRecovered: yuanToCents(account.totalRecovered),
    };
    const next = {
      frozen: current.frozen + delta.frozen,
      payable: current.payable + delta.payable,
      reserved: current.reserved + delta.reserved,
      recoveryDue: current.recoveryDue + delta.recoveryDue,
      totalAccrued: current.totalAccrued + delta.totalAccrued,
      totalReversed: current.totalReversed + delta.totalReversed,
      totalPaid: current.totalPaid + delta.totalPaid,
      totalRecovered: current.totalRecovered + delta.totalRecovered,
    };
    for (const [field, value] of Object.entries(next)) {
      if (value < 0) throw new IndustryFundError('ACCOUNT_UNDERFLOW', `${field} would become negative for ${account.id}`);
      if (!Number.isSafeInteger(value)) throw new IndustryFundError('ACCOUNT_OVERFLOW', `${field} is outside the safe range for ${account.id}`);
    }
    const data: Prisma.IndustryFundAccountUpdateManyMutationInput = {
      version: { increment: 1 },
      frozenAmount: centsToYuan(next.frozen),
      payableAmount: centsToYuan(next.payable),
      reservedAmount: centsToYuan(next.reserved),
      recoveryDue: centsToYuan(next.recoveryDue),
      totalAccrued: centsToYuan(next.totalAccrued),
      totalReversed: centsToYuan(next.totalReversed),
      totalPaid: centsToYuan(next.totalPaid),
      totalRecovered: centsToYuan(next.totalRecovered),
    };
    const result = await tx.industryFundAccount.updateMany({
      where: { id: account.id, version: account.version },
      data,
    });
    if (result.count !== 1) throw new IndustryFundError('CONCURRENT_ACCOUNT_UPDATE', `account changed concurrently: ${account.id}`);
    return tx.industryFundAccount.findUniqueOrThrow({ where: { id: account.id } });
  }

  private async createLedger(
    tx: IndustryFundTx,
    account: AccountRow,
    input: {
      eventType: IndustryFundLedgerEventType;
      amountCents: number;
      deltas: AccountDelta;
      accrualId?: string;
      companyId?: string;
      allocationId?: string;
      orderId?: string;
      afterSaleId?: string;
      paymentId?: string;
      recoveryId?: string;
      bankReference?: string;
      idempotencyKey: string;
      sourceLedgerId?: string;
      relatedLedgerId?: string;
      reason?: string;
      actorType?: string;
      actorId?: string;
      meta?: unknown;
    },
  ): Promise<Prisma.IndustryFundLedgerGetPayload<{}>> {
    return tx.industryFundLedger.create({
      data: {
        accountId: account.id,
        accrualId: input.accrualId,
        companyId: input.companyId ?? account.companyId,
        allocationId: input.allocationId,
        orderId: input.orderId,
        afterSaleId: input.afterSaleId,
        paymentId: input.paymentId,
        recoveryId: input.recoveryId,
        eventType: input.eventType,
        amount: centsToYuan(input.amountCents),
        frozenDelta: centsToYuan(input.deltas.frozen),
        payableDelta: centsToYuan(input.deltas.payable),
        reservedDelta: centsToYuan(input.deltas.reserved),
        paidDelta: centsToYuan(input.deltas.paid),
        recoveredDelta: centsToYuan(input.deltas.recovered),
        recoveryDueDelta: centsToYuan(input.deltas.recoveryDue),
        totalAccruedDelta: centsToYuan(input.deltas.totalAccrued),
        totalReversedDelta: centsToYuan(input.deltas.totalReversed),
        totalPaidDelta: centsToYuan(input.deltas.totalPaid),
        totalRecoveredDelta: centsToYuan(input.deltas.totalRecovered),
        balanceFrozen: account.frozenAmount,
        balancePayable: account.payableAmount,
        balanceReserved: account.reservedAmount,
        balanceRecoveryDue: account.recoveryDue,
        idempotencyKey: input.idempotencyKey,
        sourceLedgerId: input.sourceLedgerId,
        relatedLedgerId: input.relatedLedgerId,
        bankReference: input.bankReference,
        reason: input.reason,
        actorType: input.actorType,
        actorId: input.actorId,
        meta: jsonInput(input.meta),
      },
    });
  }

  private assertAccrualIdempotency(
    existing: AccrualRow,
    expectedCents: number,
    input: IndustryFundAccrueInput,
  ): void {
    if (yuanToCents(existing.originalAmount) !== expectedCents || existing.orderId !== input.orderId || existing.scheme !== input.scheme || existing.ledgerVersion !== (input.ledgerVersion ?? DEFAULT_LEDGER_VERSION)) {
      throw new IndustryFundError('IDEMPOTENCY_CONFLICT', `accrual already exists with different source data: ${existing.id}`);
    }
  }

  private profitBaseAmount(snapshot: unknown): number | null {
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      const record = snapshot as Record<string, unknown>;
      for (const key of ['profit', 'profitBaseAmount', 'distributableProfitAmount', 'distributableProfit']) {
        const value = readNumber(record[key]);
        if (value !== null && value > 0) return value;
      }
    }
    return null;
  }

  private configuredIndustryFundRatio(snapshot: unknown, scheme: string): number | null {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const record = snapshot as Record<string, unknown>;
    const isVip = scheme.toUpperCase().includes('VIP');
    const keys = isVip
      ? ['vipIndustryFundPercent', 'VIP_INDUSTRY_FUND_PERCENT', 'industryFundRatio']
      : ['normalIndustryFundPercent', 'NORMAL_INDUSTRY_FUND_PERCENT', 'industryFundRatio'];
    for (const key of keys) {
      const value = readNumber(record[key]);
      if (value !== null && value >= 0 && value <= 1) return value;
    }
    const nestedConfig = record.configSnapshot;
    const nested = this.configuredIndustryFundRatio(nestedConfig, scheme);
    if (nested !== null) return nested;
    const rates = record.rates;
    if (rates && typeof rates === 'object' && !Array.isArray(rates)) {
      const path = (rates as Record<string, unknown>)[isVip ? 'vip' : 'normal'];
      const nestedRate = this.configuredIndustryFundRatio(path, scheme);
      if (nestedRate !== null) return nestedRate;
    }
    return null;
  }
}

export { centsToYuan, yuanToCents };
