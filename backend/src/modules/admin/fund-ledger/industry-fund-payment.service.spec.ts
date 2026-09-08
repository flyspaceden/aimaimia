import { Prisma } from '@prisma/client';
import { IndustryFundPaymentService } from './industry-fund-payment.service';

describe('IndustryFundPaymentService request idempotency', () => {
  const payment = { id: 'payment-1', items: [] };
  let tx: any;
  let prisma: any;
  let core: any;
  let service: IndustryFundPaymentService;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      industryFundPayment: {
        findUnique: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(payment),
      },
      industryFundRecovery: {
        findUnique: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (transaction: any) => Promise<unknown>) => callback(tx)),
    };
    core = {
      reconcileAccount: jest.fn().mockResolvedValue({ ok: true }),
      reservePayment: jest.fn().mockResolvedValue(payment),
      confirmPayment: jest.fn().mockResolvedValue(payment),
      cancelPayment: jest.fn().mockResolvedValue(payment),
      reversePayment: jest.fn().mockResolvedValue(payment),
      recordRecovery: jest.fn().mockResolvedValue({ amountCents: 100, recoveryId: 'recovery-1', ledgerIds: ['ledger-1'] }),
    };
    service = new IndustryFundPaymentService(prisma, core);
  });

  it('uses one Serializable transaction and persists only a fingerprint plus result id', async () => {
    await service.createPayment({
      companyId: 'company-1', amount: 10, payeeName: '公司一', bankAccount: 'account-ref', bankName: '开户行',
      reason: '第一笔付款', idempotencyKey: 'create-key-1',
    }, 'admin-1');

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const rawCall = tx.$executeRaw.mock.calls[0] as unknown[];
    expect(JSON.stringify(rawCall)).not.toContain('account-ref');
    expect(JSON.stringify(rawCall)).not.toContain('第一笔付款');
    expect(core.reservePayment).toHaveBeenCalledTimes(1);
  });

  it('replays the saved payment result without running the core mutation twice', async () => {
    const body = {
      companyId: 'company-1', amount: 10, payeeName: '公司一', bankAccount: 'account-ref', bankName: '开户行',
      reason: '第一笔付款', idempotencyKey: 'create-key-2',
    };
    await service.createPayment(body, 'admin-1');
    tx.$queryRaw.mockResolvedValue([{
      requestKey: body.idempotencyKey,
      operation: 'CREATE_PAYMENT',
      targetId: body.companyId,
      actorId: 'admin-1',
      fingerprint: (tx.$executeRaw.mock.calls[0] as unknown[]).find((value) => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)),
      resultType: 'PAYMENT',
      resultId: payment.id,
    }]);
    core.reservePayment.mockClear();

    await expect(service.createPayment(body, 'admin-1')).resolves.toBe(payment);
    expect(core.reservePayment).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.industryFundPayment.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: payment.id } }));
  });

  it('rejects the same request key when the normalized payload, target, operation, or actor differs', async () => {
    const body = {
      companyId: 'company-1', amount: 10, payeeName: '公司一', bankAccount: 'account-ref', bankName: '开户行',
      reason: '第一笔付款', idempotencyKey: 'conflict-key',
    };
    await service.createPayment(body, 'admin-1');
    const fingerprint = (tx.$executeRaw.mock.calls[0] as unknown[]).find((value) => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value));
    tx.$queryRaw.mockResolvedValue([{
      requestKey: body.idempotencyKey,
      operation: 'CREATE_PAYMENT',
      targetId: body.companyId,
      actorId: 'admin-1',
      fingerprint,
      resultType: 'PAYMENT',
      resultId: payment.id,
    }]);

    await expect(service.createPayment({ ...body, amount: 11 }, 'admin-1')).rejects.toThrow('同一请求编号已用于其他内容');
    expect(core.reservePayment).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['confirm', () => service.confirmPayment('payment-1', {
      actualAmount: 10, paidAt: '2026-01-08T12:00:00.000Z', sourceAccountRef: 'source-ref', bankReference: 'bank-ref', proofKey: '11111111-1111-4111-8111-111111111111', idempotencyKey: 'confirm-key',
    }, 'admin-1')],
    ['cancel', () => service.cancelPayment('payment-1', { reason: '核实未付款', idempotencyKey: 'cancel-key' }, 'admin-1')],
    ['reverse', () => service.reversePayment('payment-1', { reason: '登记错误', idempotencyKey: 'reverse-key' }, 'admin-1')],
    ['recovery', () => service.recordRecovery('payment-1', {
      amount: 1, recoveredAt: '2026-01-08T12:00:00.000Z', bankReference: 'recovery-ref', proofKey: '22222222-2222-4222-8222-222222222222', reason: '实际回款', idempotencyKey: 'recovery-key',
    }, 'admin-1')],
  ])('wraps the %s mutation in the request idempotency boundary', async (_operation, run) => {
    await run();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
