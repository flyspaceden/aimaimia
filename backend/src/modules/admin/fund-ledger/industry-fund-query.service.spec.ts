import { IndustryFundQueryService } from './industry-fund-query.service';
import { FundQueryDto } from './fund-ledger.dto';

describe('IndustryFundQueryService payment read contract', () => {
  it('returns the actual payment amount, parent recovery evidence and payment status history', async () => {
    const payment = {
      id: 'payment-1',
      companyId: 'company-1',
      amount: 10,
      status: 'PAID',
      payeeName: '公司一',
      bankAccount: '1234567890123456',
      bankName: '测试银行',
      proofKey: '11111111-1111-4111-8111-111111111111',
      sourceAccountRef: 'platform-account',
      bankReference: 'bank-payment-1',
      actualPaidAt: new Date('2026-09-08T12:00:00.000Z'),
      reason: '付款登记',
      needsReview: false,
      reviewReason: null,
      createdAt: new Date('2026-09-08T11:00:00.000Z'),
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
      createdBy: 'admin-1',
      confirmedBy: 'admin-1',
      cancelledBy: null,
      reversedBy: null,
      company: { id: 'company-1', name: '公司一' },
      items: [{
        id: 'item-1', accrualId: 'accrual-1', amount: 10, reservedAmount: 0, paidAmount: 10,
        recoveryDue: 2, recoveredAmount: 0, accrual: { orderId: 'order-1', originalAmount: 10 },
      }],
      recoveries: [{
        id: 'recovery-1', paymentId: 'payment-1', companyId: 'company-1', amount: 1,
        bankReference: 'bank-recovery-1', proofKey: '22222222-2222-4222-8222-222222222222',
        recoveredAt: new Date('2026-09-09T12:00:00.000Z'), reason: '回款', actorId: 'admin-2',
        createdAt: new Date('2026-09-09T12:00:00.000Z'),
      }],
      ledgers: [
        { id: 'ledger-reserve', eventType: 'PAYMENT_RESERVED', amount: 10, reason: '预留', createdAt: new Date('2026-09-08T11:30:00.000Z'), actorId: 'admin-1' },
        { id: 'ledger-confirm', eventType: 'PAYMENT_CONFIRMED', amount: 10, reason: '确认', createdAt: new Date('2026-09-08T12:00:00.000Z'), actorId: 'admin-1' },
      ],
    };
    const prisma = {
      industryFundPayment: { findUnique: jest.fn().mockResolvedValue(payment) },
    } as any;
    const service = new IndustryFundQueryService(prisma);

    const result = await service.payment('payment-1', true);

    expect(result).toEqual(expect.objectContaining({ actualAmount: 10, payeeName: '公司一', bankName: '测试银行' }));
    expect(result.recoveries).toEqual([expect.objectContaining({
      id: 'recovery-1', amount: 1, bankReference: 'bank-recovery-1', recoveredAt: payment.recoveries[0].recoveredAt,
    })]);
    expect(result.statusHistory).toEqual([
      expect.objectContaining({ eventType: 'PAYMENT_RESERVED', operator: { id: 'admin-1' } }),
      expect.objectContaining({ eventType: 'PAYMENT_CONFIRMED', operator: { id: 'admin-1' } }),
    ]);
  });

  it('redacts recovery bank evidence for a read-only administrator', async () => {
    const payment = {
      id: 'payment-2', companyId: 'company-1', amount: 10, status: 'PAID', payeeName: '公司一',
      bankAccount: '1234567890123456', bankName: '测试银行', proofKey: '11111111-1111-4111-8111-111111111111',
      sourceAccountRef: 'platform-account', bankReference: 'bank-payment-2', actualPaidAt: null,
      reason: '付款登记', needsReview: false, reviewReason: null, createdAt: new Date(), updatedAt: new Date(),
      createdBy: 'admin-1', confirmedBy: 'admin-1', cancelledBy: null, reversedBy: null,
      company: { id: 'company-1', name: '公司一' }, items: [], recoveries: [{
        id: 'recovery-2', paymentId: 'payment-2', companyId: 'company-1', amount: 1,
        bankReference: 'secret-recovery', proofKey: '22222222-2222-4222-8222-222222222222',
        recoveredAt: new Date(), reason: '回款', actorId: 'admin-2', createdAt: new Date(),
      }], ledgers: [],
    };
    const service = new IndustryFundQueryService({ industryFundPayment: { findUnique: jest.fn().mockResolvedValue(payment) } } as any);

    const result = await service.payment('payment-2', false);
    expect(result.bankAccount).toBe('****3456');
    expect(result.proofKey).toBeNull();
    expect(result.recoveries?.[0]).toEqual(expect.objectContaining({ bankReference: null, proofKey: null }));
  });
});

describe('IndustryFundQueryService list query contract', () => {
  it('searches company names and returns a same-filter summary in one repeatable-read transaction', async () => {
    const row = {
      company: { id: 'company-1', name: '青禾果园', status: 'ACTIVE' },
      frozenAmount: 2,
      payableAmount: 10,
      reservedAmount: 3,
      totalPaid: 4,
      totalAccrued: 19,
      totalReversed: 1,
      recoveryDue: 5,
      updatedAt: new Date('2026-09-09T12:00:00.000Z'),
    };
    const tx = {
      industryFundAccount: {
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(1),
        aggregate: jest.fn().mockResolvedValue({ _sum: { frozenAmount: 2, payableAmount: 10, reservedAmount: 3, recoveryDue: 5 } }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as any;
    const service = new IndustryFundQueryService(prisma);
    const query = Object.assign(new FundQueryDto(), { search: '果园', view: 'available', page: 1, pageSize: 20 });

    const result = await service.companies(query);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'RepeatableRead' }));
    const findWhere = tx.industryFundAccount.findMany.mock.calls[0][0].where;
    const aggregateWhere = tx.industryFundAccount.aggregate.mock.calls[0][0].where;
    expect(findWhere).toBe(aggregateWhere);
    expect(findWhere).toEqual(expect.objectContaining({
      company: { name: { contains: '果园', mode: 'insensitive' } },
      payableAmount: { gt: 0 },
    }));
    expect(result.summary).toEqual({ available: 10, frozen: 2, reserved: 3, recoverable: 5, count: 1 });
    expect(result.items).toHaveLength(1);
  });

  it('searches payment id and company name for readers, and only adds bank-reference search with payment/reverse access', async () => {
    const makePrisma = () => {
      const tx = {
        industryFundPayment: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(0),
        },
      };
      return {
        tx,
        prisma: { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } as any,
      };
    };
    const query = Object.assign(new FundQueryDto(), { search: 'payment-1', view: 'pending', page: 1, pageSize: 20 });

    const readonlyDb = makePrisma();
    await new IndustryFundQueryService(readonlyDb.prisma).payments(query, false);
    const readonlyWhere = readonlyDb.tx.industryFundPayment.findMany.mock.calls[0][0].where;
    const readonlySearch = JSON.stringify(readonlyWhere);
    expect(readonlySearch).toContain('payment-1');
    expect(readonlySearch).toContain('company');
    expect(readonlySearch).not.toContain('bankReference');

    const paymentDb = makePrisma();
    await new IndustryFundQueryService(paymentDb.prisma).payments(query, true);
    const paymentWhere = paymentDb.tx.industryFundPayment.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(paymentWhere)).toContain('bankReference');
    expect(paymentWhere).toEqual(expect.objectContaining({ AND: expect.arrayContaining([
      expect.objectContaining({ status: 'RESERVED', needsReview: false }),
    ]) }));
  });

  it('requires sensitive permission for an explicit bank reference and combines it with company search', async () => {
    const tx = { industryFundPayment: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } as any;
    const service = new IndustryFundQueryService(prisma);
    const query = Object.assign(new FundQueryDto(), { bankReference: ' bank-1 ', search: '果园' });
    await expect(service.payments(query, false)).rejects.toThrow('无银行流水号查询权限');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await service.payments(query, true);
    expect(tx.industryFundPayment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      bankReference: 'bank-1', OR: expect.arrayContaining([{ company: { name: { contains: '果园', mode: 'insensitive' } } }]),
    }) }));
  });

  it('keeps company detail ledger search scoped while matching ledger id or order id', async () => {
    const tx = {
      industryFundLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } as any;
    const service = new IndustryFundQueryService(prisma);
    const query = Object.assign(new FundQueryDto(), { search: 'order-1', orderId: 'order-exact', page: 1, pageSize: 20 });

    await service.ledgers(query, 'company-1');

    expect(tx.industryFundLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        companyId: 'company-1',
        orderId: 'order-exact',
        OR: [
          { id: { contains: 'order-1', mode: 'insensitive' } },
          { orderId: { contains: 'order-1', mode: 'insensitive' } },
        ],
      }),
    }));
  });
});
