import { IndustryFundQueryService } from './industry-fund-query.service';

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
