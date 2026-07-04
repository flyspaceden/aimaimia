import { Prisma } from '@prisma/client';
import { GrowthExpireService } from './growth-expire.service';

const makeHarness = (options: {
  expiredLedgers?: any[];
  existingExpiration?: any;
  account?: any;
} = {}) => {
  const tx: any = {
    growthLedger: {
      findMany: jest.fn().mockResolvedValue(options.expiredLedgers ?? []),
      findUnique: jest.fn().mockResolvedValue(options.existingExpiration ?? null),
      create: jest.fn(({ data }: any) => ({ id: 'expire-ledger-1', ...data })),
    },
    growthAccount: {
      findUnique: jest.fn().mockResolvedValue(options.account ?? {
        id: 'account-1',
        pointsBalance: 100,
      }),
      update: jest.fn().mockResolvedValue({ id: 'account-1' }),
    },
    userProfile: {
      upsert: jest.fn().mockResolvedValue({ userId: 'u1' }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn((callback: any, transactionOptions: any) =>
      callback(tx).then((result: any) => ({ result, transactionOptions })),
    ),
  };

  return { tx, prisma, service: new GrowthExpireService(prisma) };
};

describe('GrowthExpireService', () => {
  it('expires ordinary points without changing growth value', async () => {
    const { tx, service } = makeHarness({
      expiredLedgers: [
        {
          id: 'ledger-earn-1',
          userId: 'u1',
          accountId: 'account-1',
          pointsDelta: 80,
          growthDelta: 200,
          refType: 'CHECK_IN',
          refId: '2026-01-01',
        },
      ],
      account: { id: 'account-1', pointsBalance: 50 },
    });

    const { result, transactionOptions } = await service.expirePoints(new Date('2026-07-03T00:00:00.000Z')) as any;

    expect(transactionOptions).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(result).toMatchObject({
      expiredCount: 1,
      expiredPoints: 50,
    });
    expect(tx.growthLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        pointsDelta: { gt: 0 },
        status: 'POSTED',
      }),
    }));
    expect(tx.growthAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: {
        pointsBalance: { decrement: 50 },
        pointsTotalSpent: { increment: 50 },
      },
    });
    expect(tx.growthLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'POINTS_EXPIRE',
        pointsDelta: -50,
        growthDelta: 0,
        idempotencyKey: 'GROWTH_EXPIRE:ledger-earn-1',
      }),
    }));
    expect(tx.userProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { points: { decrement: 50 } },
    }));
  });

  it('does not expire the same earning ledger twice', async () => {
    const { tx, service } = makeHarness({
      existingExpiration: { id: 'already-expired' },
      expiredLedgers: [
        {
          id: 'ledger-earn-1',
          userId: 'u1',
          accountId: 'account-1',
          pointsDelta: 80,
          growthDelta: 0,
        },
      ],
    });

    const { result } = await service.expirePoints(new Date('2026-07-03T00:00:00.000Z')) as any;

    expect(result).toMatchObject({
      expiredCount: 0,
      expiredPoints: 0,
    });
    expect(tx.growthAccount.update).not.toHaveBeenCalled();
    expect(tx.growthLedger.create).not.toHaveBeenCalled();
  });
});
