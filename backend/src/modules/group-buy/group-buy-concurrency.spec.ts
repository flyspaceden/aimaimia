import { Prisma } from '@prisma/client';

import { GroupBuyRebateService } from './group-buy-rebate.service';

describe('GroupBuyRebateService concurrency safeguards', () => {
  const now = new Date('2026-06-22T12:00:00.000Z');

  const buildTx = () => ({
    groupBuyReferral: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'referral_1',
        status: 'CANDIDATE',
        instanceId: 'instance_1',
        referredOrderId: 'order_1',
        referredOrder: {
          id: 'order_1',
          status: 'RECEIVED',
          returnWindowExpiresAt: new Date('2026-06-20T00:00:00.000Z'),
          afterSaleRequests: [],
          refunds: [],
        },
        instance: {
          id: 'instance_1',
          userId: 'initiator_1',
          status: 'SHARING',
          priceSnapshot: 1000,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000 },
            { sequence: 2, basisPoints: 2000 },
            { sequence: 3, basisPoints: 7000 },
          ],
          code: { id: 'code_1', status: 'ACTIVE' },
        },
      }),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ id: 'referral_1' }),
    },
    groupBuyRebateAccount: {
      findUnique: jest.fn().mockResolvedValue({ id: 'account_1', balance: 0 }),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'account_1' }),
    },
    groupBuyRebateLedger: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'ledger_1' }),
    },
    groupBuyInstance: {
      update: jest.fn().mockResolvedValue({ id: 'instance_1' }),
    },
    groupBuyCode: {
      update: jest.fn().mockResolvedValue({ id: 'code_1' }),
    },
  });

  it('retries a Serializable conflict and allocates the tier inside the retried transaction', async () => {
    const firstTx = buildTx();
    const secondTx = buildTx();
    secondTx.groupBuyReferral.count.mockResolvedValueOnce(1);

    const prisma = {
      $transaction: jest.fn()
        .mockRejectedValueOnce({ code: 'P2034' })
        .mockImplementationOnce((fn) => fn(secondTx)),
    };
    const service = new (GroupBuyRebateService as any)(prisma) as GroupBuyRebateService;

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(firstTx.groupBuyReferral.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'RELEASED',
      effectiveSequence: 2,
      amount: 200,
    });
    expect(secondTx.groupBuyReferral.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        effectiveSequence: 2,
        amountSnapshot: 200,
      }),
    }));
  });
});
