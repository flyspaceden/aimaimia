import { BadRequestException } from '@nestjs/common';
import { AdminGrowthService } from './admin-growth.service';

const makeHarness = (options: {
  account?: any;
  resolvedUser?: any;
} = {}) => {
  const tx: any = {
    growthAccount: {
      findUnique: jest.fn().mockResolvedValue(options.account ?? {
        id: 'account-1',
        userId: 'user-1',
        pointsBalance: 100,
        growthValue: 200,
      }),
      upsert: jest.fn(({ create, update }: any) => ({
        id: 'account-1',
        ...create,
        ...update,
      })),
    },
    growthLedger: {
      create: jest.fn(({ data }: any) => ({ id: 'ledger-1', ...data })),
    },
    userProfile: {
      upsert: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    },
  };
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(options.resolvedUser ?? { id: 'user-1' }),
    },
    growthBehaviorRule: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(({ create, update }: any) => ({ ...create, ...update })),
    },
    growthLevel: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    growthExchangeItem: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: any) => ({ id: 'exchange-1', ...data })),
      update: jest.fn(({ data }: any) => ({ id: 'exchange-1', ...data })),
    },
    growthAccount: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    growthLedger: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    normalShareBinding: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((callback: any, transactionOptions: any) =>
      callback(tx).then((result: any) => ({ result, transactionOptions })),
    ),
  };

  return {
    tx,
    prisma,
    service: new AdminGrowthService(prisma),
  };
};

describe('AdminGrowthService', () => {
  it('rejects behavior rules outside the registered allowlist', async () => {
    const { service } = makeHarness();

    await expect(
      service.upsertBehaviorRule({
        code: 'UNKNOWN_BEHAVIOR',
        name: '未知行为',
        categoryCode: 'DAILY',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires growth levels to include threshold 0 and increase strictly', async () => {
    const { service } = makeHarness();

    await expect(
      service.replaceLevels([
        { code: 'L1', name: '一级', threshold: 10 },
        { code: 'L2', name: '二级', threshold: 5 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects coupon exchange items without couponCampaignId', async () => {
    const { service } = makeHarness();

    await expect(
      service.createExchangeItem({
        type: 'COUPON',
        name: '5元红包',
        pointsCost: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires reason for manual adjustment', async () => {
    const { service } = makeHarness();

    await expect(
      service.adjustUser('user-1', {
        pointsDelta: 10,
        growthDelta: 0,
        reason: '',
      }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes account, profile cache, and ledger for manual adjustment', async () => {
    const { service, tx } = makeHarness();

    const { result, transactionOptions } = await service.adjustUser('user-1', {
      pointsDelta: 10,
      growthDelta: 20,
      reason: '客服补偿',
    }, 'admin-1') as any;

    expect(transactionOptions).toMatchObject({ isolationLevel: 'Serializable' });
    expect(tx.growthAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      update: {
        pointsBalance: { increment: 10 },
        pointsTotalEarned: { increment: 10 },
        growthValue: { increment: 20 },
      },
    }));
    expect(tx.growthLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        accountId: 'account-1',
        type: 'ADMIN_ADJUST',
        pointsDelta: 10,
        growthDelta: 20,
        behaviorCode: 'ADMIN_ADJUST',
        idempotencyKey: expect.stringContaining('ADMIN_ADJUST:admin-1:user-1:'),
        meta: { adminId: 'admin-1', reason: '客服补偿' },
      }),
    });
    expect(result).toMatchObject({ id: 'ledger-1', pointsDelta: 10, growthDelta: 20 });
  });
});
