import {
  IndustryFundError,
  IndustryFundService,
  IndustryFundTx,
  centsToYuan,
  yuanToCents,
} from './industry-fund.service';

type MutableAccount = {
  id: string;
  companyId: string;
  frozenAmount: number;
  payableAmount: number;
  reservedAmount: number;
  totalAccrued: number;
  totalReversed: number;
  totalPaid: number;
  totalRecovered: number;
  recoveryDue: number;
  version: number;
};

const makeAccount = (id: string, companyId: string): MutableAccount => ({
  id,
  companyId,
  frozenAmount: 0,
  payableAmount: 0,
  reservedAmount: 0,
  totalAccrued: 0,
  totalReversed: 0,
  totalPaid: 0,
  totalRecovered: 0,
  recoveryDue: 0,
  version: 0,
});

describe('IndustryFundService', () => {
  it('uses integer cents for money and rejects negative/non-finite inputs', () => {
    expect(yuanToCents(0.1 + 0.2)).toBe(30);
    expect(centsToYuan(960)).toBe(9.6);
    expect(() => yuanToCents(-0.01)).toThrow(IndustryFundError);
    expect(() => yuanToCents(Number.NaN)).toThrow(IndustryFundError);
  });

  it('accrues by the split insertion order, keeps cents conserved, and is idempotent', async () => {
    const accounts = new Map<string, MutableAccount>();
    const accruals = new Map<string, Record<string, unknown>>();
    const ledgers: Record<string, unknown>[] = [];
    const unassigned: Record<string, unknown>[] = [];
    let nextAccrualId = 1;

    const tx = {
      rewardAllocation: {
        findUnique: jest.fn().mockResolvedValue({ meta: { profit: 100, ruleVersion: 'r1' } }),
      },
      company: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id })),
      },
      industryFundAccount: {
        upsert: jest.fn(({ where }: { where: { companyId: string } }) => {
          let row = accounts.get(where.companyId);
          if (!row) {
            row = makeAccount(`account-${where.companyId}`, where.companyId);
            accounts.set(where.companyId, row);
          }
          return Promise.resolve(row);
        }),
        updateMany: jest.fn(({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
          const row = [...accounts.values()].find((item) => item.id === where.id);
          if (!row || row.version !== where.version) return Promise.resolve({ count: 0 });
          for (const field of ['frozenAmount', 'payableAmount', 'reservedAmount', 'totalAccrued', 'totalReversed', 'totalPaid', 'totalRecovered', 'recoveryDue']) {
            const value = data[field];
            if (typeof value === 'number') (row as unknown as Record<string, number>)[field] = value;
          }
          row.version += 1;
          return Promise.resolve({ count: 1 });
        }),
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve([...accounts.values()].find((item) => item.id === where.id) ?? null)),
        findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve([...accounts.values()].find((item) => item.id === where.id))),
      },
      industryFundAccrual: {
        findUnique: jest.fn(({ where }: { where: Record<string, unknown> }) => {
          if (where.id) return Promise.resolve([...accruals.values()].find((item) => item.id === where.id) ?? null);
          const compound = where.allocationId_companyId as { allocationId: string; companyId: string };
          return Promise.resolve(accruals.get(`${compound.allocationId}:${compound.companyId}`) ?? null);
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `accrual-${nextAccrualId++}`, version: 0, ...data };
          accruals.set(`${data.allocationId as string}:${data.companyId as string}`, row);
          return Promise.resolve(row);
        }),
      },
      industryFundLedger: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `ledger-${ledgers.length + 1}`, ...data };
          ledgers.push(row);
          return Promise.resolve(row);
        }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      industryFundUnassignedEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `unassigned-${unassigned.length + 1}`, ...data };
          unassigned.push(row);
          return Promise.resolve(row);
        }),
      },
    } as unknown as IndustryFundTx;

    const service = new IndustryFundService({} as never);
    const first = await service.accrueInTransaction(tx, {
      allocationId: 'allocation-1',
      orderId: 'order-1',
      amount: 16,
      companyProfitShares: { companyA: 0.6, companyB: 0.4 },
      scheme: 'NORMAL_PLATFORM_SPLIT',
    });
    const second = await service.accrueInTransaction(tx, {
      allocationId: 'allocation-1',
      orderId: 'order-1',
      amount: 16,
      companyProfitShares: { companyA: 0.6, companyB: 0.4 },
      scheme: 'NORMAL_PLATFORM_SPLIT',
    });

    expect(first.accrualIds).toHaveLength(2);
    expect(second.accrualIds).toEqual(first.accrualIds);
    expect([...accruals.values()].map((row) => row.originalAmount)).toEqual([9.6, 6.4]);
    expect([...accounts.values()].map((row) => row.frozenAmount)).toEqual([9.6, 6.4]);
    expect(ledgers).toHaveLength(2);
    expect((tx.industryFundAccount?.updateMany as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('fails closed when a release is attempted before the return window closes', async () => {
    const account = makeAccount('account-1', 'company-1');
    const tx = {
      industryFundLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      industryFundAccrual: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'accrual-1', accountId: account.id, companyId: account.companyId,
          allocationId: 'allocation-1', orderId: 'order-1', version: 0,
          frozenAmount: 10, payableAmount: 0, reservedAmount: 0,
          reversalPendingAmount: 0,
          account,
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          returnWindowExpiresAt: new Date(Date.now() + 60_000),
          afterSaleRequests: [],
        }),
      },
    } as unknown as IndustryFundTx;
    const service = new IndustryFundService({} as never);

    await expect(service.releaseAccrual(tx, {
      accrualId: 'accrual-1',
      idempotencyKey: 'release-1',
    })).rejects.toMatchObject({ code: 'RETURN_WINDOW_OPEN' });
  });

  it('rejects a payment whose payee does not match the active company', async () => {
    const tx = {
      industryFundPayment: { findUnique: jest.fn().mockResolvedValue(null) },
      company: {
        findUnique: jest.fn().mockResolvedValue({ id: 'company-1', name: '正确公司', status: 'ACTIVE' }),
      },
    } as unknown as IndustryFundTx;
    const service = new IndustryFundService({} as never);

    await expect(service.reservePayment(tx, {
      companyId: 'company-1', amount: 1, payeeName: '错误户名', bankAccount: '6222',
      bankName: '银行', reason: 'test', idempotencyKey: 'payment-1',
    })).rejects.toMatchObject({ code: 'PAYEE_NAME_MISMATCH' });
  });

  it('reverses unassigned order amounts without routing them to a platform account', async () => {
    const entry = { id: 'unassigned-1', orderId: 'order-1', amount: 3.2, reversedAmount: 0, status: 'PENDING' };
    const update = jest.fn().mockResolvedValue({ ...entry, reversedAmount: 3.2 });
    const tx = {
      industryFundAccrual: { findMany: jest.fn().mockResolvedValue([]) },
      industryFundUnassignedEntry: {
        findMany: jest.fn().mockResolvedValue([entry]),
        update,
      },
    } as unknown as IndustryFundTx;
    const service = new IndustryFundService({} as never);

    const result = await service.reverseOrderInTransaction(tx, 'order-1', 'AFTER_SALE_SUCCESS');

    expect(result).toEqual({ reversedCents: 0, pendingCents: 0, recoveryDueCents: 0 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'unassigned-1' },
      data: expect.objectContaining({ reversedAmount: 3.2 }),
    }));
  });

  it('reconciliation checks both projection totals and immutable ledger deltas', async () => {
    const account = {
      ...makeAccount('account-1', 'company-1'),
      frozenAmount: 5,
      totalAccrued: 5,
    };
    const tx = {
      industryFundAccount: { findUnique: jest.fn().mockResolvedValue(account) },
      industryFundAccrual: {
        findMany: jest.fn().mockResolvedValue([{
          originalAmount: 5, frozenAmount: 5, payableAmount: 0, reservedAmount: 0,
          reversedAmount: 0, paidAmount: 0, recoveredAmount: 0, recoveryDue: 0,
        }]),
      },
      industryFundLedger: {
        findMany: jest.fn().mockResolvedValue([{
          sequence: 1n,
          frozenDelta: 0, payableDelta: 0, reservedDelta: 0, paidDelta: 0,
          recoveredDelta: 0, recoveryDueDelta: 0,
          totalAccruedDelta: 0, totalReversedDelta: 0, totalPaidDelta: 0,
          totalRecoveredDelta: 0,
          balanceFrozen: 0, balancePayable: 0, balanceReserved: 0, balanceRecoveryDue: 0,
        }]),
      },
      industryFundPayment: { findMany: jest.fn().mockResolvedValue([]) },
      industryFundRecovery: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as IndustryFundTx;
    const service = new IndustryFundService({} as never);

    const result = await service.reconcileAccount(tx, 'company-1');

    expect(result.ok).toBe(false);
    expect(result.discrepancyCents).toBeGreaterThan(0);
  });

  it('reconciles partial paid plus reserved after-sale state through payment and recovery items', async () => {
    const account = {
      ...makeAccount('account-topology', 'company-topology'),
      reservedAmount: 5,
      totalAccrued: 15,
      totalReversed: 10,
      totalPaid: 10,
      totalRecovered: 10,
    };
    const accrual = {
      id: 'accrual-topology', accountId: account.id, companyId: account.companyId,
      originalAmount: 15, frozenAmount: 0, payableAmount: 0, reservedAmount: 5,
      paidAmount: 10, reversedAmount: 10, reversedPaidAmount: 10,
      recoveredAmount: 10, recoveryDue: 0,
    };
    const ledger = (sequence: bigint, deltas: Record<string, number>, balances: Record<string, number>) => ({
      id: `ledger-${sequence}`, sequence, ...deltas, ...balances,
      recoveredDelta: deltas.recoveredDelta ?? 0, recoveryDueDelta: deltas.recoveryDueDelta ?? 0,
      totalAccruedDelta: deltas.totalAccruedDelta ?? 0, totalReversedDelta: deltas.totalReversedDelta ?? 0,
      totalPaidDelta: deltas.totalPaidDelta ?? 0, totalRecoveredDelta: deltas.totalRecoveredDelta ?? 0,
    });
    const ledgers = [
      ledger(1n, { frozenDelta: 15, payableDelta: 0, reservedDelta: 0, paidDelta: 0, totalAccruedDelta: 15 }, { balanceFrozen: 15, balancePayable: 0, balanceReserved: 0, balanceRecoveryDue: 0 }),
      ledger(2n, { frozenDelta: -15, payableDelta: 15, reservedDelta: 0, paidDelta: 0 }, { balanceFrozen: 0, balancePayable: 15, balanceReserved: 0, balanceRecoveryDue: 0 }),
      ledger(3n, { frozenDelta: 0, payableDelta: -10, reservedDelta: 10, paidDelta: 0 }, { balanceFrozen: 0, balancePayable: 5, balanceReserved: 10, balanceRecoveryDue: 0 }),
      ledger(4n, { frozenDelta: 0, payableDelta: 0, reservedDelta: -10, paidDelta: 10, totalPaidDelta: 10 }, { balanceFrozen: 0, balancePayable: 5, balanceReserved: 0, balanceRecoveryDue: 0 }),
      ledger(5n, { frozenDelta: 0, payableDelta: -5, reservedDelta: 5, paidDelta: 0 }, { balanceFrozen: 0, balancePayable: 0, balanceReserved: 5, balanceRecoveryDue: 0 }),
      ledger(6n, { frozenDelta: 0, payableDelta: 0, reservedDelta: 0, paidDelta: 0, recoveryDueDelta: 10, totalReversedDelta: 10 }, { balanceFrozen: 0, balancePayable: 0, balanceReserved: 5, balanceRecoveryDue: 10 }),
      ledger(7n, { frozenDelta: 0, payableDelta: 0, reservedDelta: 0, paidDelta: 0, recoveredDelta: 10, recoveryDueDelta: -10, totalRecoveredDelta: 10 }, { balanceFrozen: 0, balancePayable: 0, balanceReserved: 5, balanceRecoveryDue: 0 }),
    ];
    const tx = {
      industryFundAccount: { findUnique: jest.fn().mockResolvedValue(account) },
      industryFundAccrual: { findMany: jest.fn().mockResolvedValue([accrual]) },
      industryFundLedger: { findMany: jest.fn().mockResolvedValue(ledgers) },
      industryFundPayment: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'payment-paid', accountId: account.id, amount: 10, status: 'PAID', items: [{ id: 'item-paid', accrualId: accrual.id, amount: 10, reservedAmount: 0, paidAmount: 10, recoveryDue: 0, recoveredAmount: 10 }] },
          { id: 'payment-reserved', accountId: account.id, amount: 5, status: 'RESERVED', items: [{ id: 'item-reserved', accrualId: accrual.id, amount: 5, reservedAmount: 5, paidAmount: 0, recoveryDue: 0, recoveredAmount: 0 }] },
        ]),
      },
      industryFundRecovery: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'recovery-1', paymentId: 'payment-paid', amount: 10, items: [{ id: 'recovery-item-1', accrualId: accrual.id, amount: 10 }] },
        ]),
      },
    } as unknown as IndustryFundTx;
    const service = new IndustryFundService({} as never);

    const result = await service.reconcileAccount(tx, account.companyId);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('does not create new recovery after a paid item was already recovered before pending cancellation', async () => {
    const account = {
      ...makeAccount('account-pending', 'company-pending'),
      payableAmount: 5,
      totalAccrued: 15,
      totalReversed: 10,
      totalPaid: 10,
      totalRecovered: 10,
    };
    const accrual = {
      id: 'accrual-pending', accountId: account.id, companyId: account.companyId,
      allocationId: 'allocation-pending', orderId: 'order-pending', version: 0,
      originalAmount: 15, frozenAmount: 0, payableAmount: 5, reservedAmount: 0,
      paidAmount: 10, reversedAmount: 10, reversedPaidAmount: 10,
      recoveredAmount: 10, recoveryDue: 0, reversalPendingAmount: 5,
      account,
    };
    const paidItem = {
      id: 'item-paid', accrualId: accrual.id, amount: 10, reservedAmount: 0,
      paidAmount: 10, recoveryDue: 0, recoveredAmount: 10,
      createdAt: new Date('2026-01-01'),
    };
    const paymentItemUpdate = jest.fn();
    const accrualUpdate = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      Object.assign(accrual, {
        ...data,
        version: accrual.version + 1,
        payableAmount: data.payableAmount,
        reversedAmount: data.reversedAmount,
        reversedPaidAmount: data.reversedPaidAmount,
        recoveryDue: data.recoveryDue,
        reversalPendingAmount: data.reversalPendingAmount,
      });
      return Promise.resolve({ count: 1 });
    });
    const accountUpdate = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      for (const field of ['frozenAmount', 'payableAmount', 'reservedAmount', 'totalAccrued', 'totalReversed', 'totalPaid', 'totalRecovered', 'recoveryDue']) {
        if (typeof data[field] === 'number') (account as unknown as Record<string, number>)[field] = data[field] as number;
      }
      account.version += 1;
      return Promise.resolve({ count: 1 });
    });
    const tx = {
      industryFundPaymentItem: {
        findMany: jest.fn().mockResolvedValue([paidItem]),
        update: paymentItemUpdate,
      },
      industryFundAccrual: {
        updateMany: accrualUpdate,
        findUniqueOrThrow: jest.fn().mockResolvedValue(accrual),
      },
      industryFundAccount: {
        updateMany: accountUpdate,
        findUniqueOrThrow: jest.fn().mockResolvedValue(account),
      },
      industryFundLedger: { create: jest.fn().mockResolvedValue({ id: 'ledger-pending-finalize' }) },
    } as unknown as IndustryFundTx;
    const service = new IndustryFundService({} as never);

    await (service as unknown as {
      finalizePendingReversal: (innerTx: IndustryFundTx, row: typeof accrual, reason: string) => Promise<void>;
    }).finalizePendingReversal(tx, accrual, '已回款后取消预留');

    expect(paymentItemUpdate).not.toHaveBeenCalled();
    expect(accrual.recoveryDue).toBe(0);
    expect(accrual.reversedAmount).toBe(15);
    expect(account.recoveryDue).toBe(0);
    expect(account.totalReversed).toBe(15);
  });
});
