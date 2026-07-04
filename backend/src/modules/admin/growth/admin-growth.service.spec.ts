import { BadRequestException } from '@nestjs/common';
import { AdminGrowthService } from './admin-growth.service';

const makeHarness = (options: {
  account?: any;
  resolvedUser?: any;
  levelCode?: string | null;
  settings?: Record<string, unknown>;
  normalShareProfile?: any;
} = {}) => {
  const baseAccount = options.account ?? {
    id: 'account-1',
    userId: 'user-1',
    pointsBalance: 100,
    growthValue: 200,
    currentLevelCode: null,
  };
  const tx: any = {
    growthAccount: {
      findUnique: jest.fn().mockResolvedValue(baseAccount),
      upsert: jest.fn(({ create, update }: any) => ({
        id: 'account-1',
        userId: create?.userId ?? baseAccount.userId,
        pointsBalance: create?.pointsBalance ?? baseAccount.pointsBalance + (update?.pointsBalance?.increment ?? 0),
        growthValue: create?.growthValue ?? baseAccount.growthValue + (update?.growthValue?.increment ?? 0),
        currentLevelCode: baseAccount.currentLevelCode ?? null,
      })),
      update: jest.fn(({ data }: any) => ({ id: 'account-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    growthLedger: {
      create: jest.fn(({ data }: any) => ({ id: 'ledger-1', ...data })),
    },
    growthLevel: {
      findFirst: jest.fn().mockResolvedValue(options.levelCode ? { code: options.levelCode } : null),
    },
    userProfile: {
      upsert: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    },
    ruleConfig: {
      upsert: jest.fn(({ create, update }: any) => ({ ...create, ...update })),
    },
  };
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(options.resolvedUser ?? { id: 'user-1' }),
    },
    ruleConfig: {
      findMany: jest.fn().mockResolvedValue(
        Object.entries(options.settings ?? {}).map(([key, value]) => ({ key, value })),
      ),
    },
    growthBehaviorRule: {
      count: jest.fn().mockResolvedValue(6),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(({ create, update }: any) => ({ ...create, ...update })),
    },
    growthLevel: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    growthExchangeItem: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: any) => ({ id: 'exchange-1', ...data })),
      update: jest.fn(({ data }: any) => ({ id: 'exchange-1', ...data })),
    },
    growthAccount: {
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 1 },
        _sum: {
          pointsBalance: 100,
          pointsTotalEarned: 150,
          pointsTotalSpent: 50,
          growthValue: 200,
        },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    growthLedger: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: {
          pointsDelta: 10,
          growthDelta: 20,
        },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    growthExchangeRecord: {
      count: jest.fn().mockResolvedValue(4),
    },
    normalShareBinding: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    normalShareProfile: {
      findUnique: jest.fn().mockResolvedValue(options.normalShareProfile ?? {
        id: 'share-profile-1',
        userId: 'user-1',
        code: 'S123456',
        status: 'ACTIVE',
      }),
      update: jest.fn(({ data }: any) => ({ id: 'share-profile-1', userId: 'user-1', ...data })),
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
    const { service, tx } = makeHarness({ levelCode: 'SPROUT' });

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
    expect(tx.growthAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { currentLevelCode: 'SPROUT' },
    });
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

  it('reads and saves configurable growth settings through RuleConfig', async () => {
    const { service, prisma, tx } = makeHarness({
      settings: { GROWTH_ENABLED: true, GROWTH_POINTS_EXPIRE_DAYS: 180 },
    });

    await expect(service.getSettings()).resolves.toMatchObject({
      growthEnabled: true,
      pointsExpireDays: 180,
      dailyPointsCap: 300,
    });

    const result = await service.updateSettings({
      growthEnabled: false,
      dailyPointsCap: 200,
    }) as any;

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(tx.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'GROWTH_ENABLED' },
      create: { key: 'GROWTH_ENABLED', value: false },
      update: { value: false },
    });
    expect(tx.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'GROWTH_DAILY_POINTS_CAP' },
      create: { key: 'GROWTH_DAILY_POINTS_CAP', value: 200 },
      update: { value: 200 },
    });
    expect(prisma.ruleConfig.findMany).toHaveBeenCalled();
    expect(result).toMatchObject({
      growthEnabled: true,
      pointsExpireDays: 180,
    });
  });

  it('counts all unissued normal-share rewards in the dashboard pending total', async () => {
    const { service, prisma } = makeHarness();
    prisma.normalShareBinding.count.mockResolvedValueOnce(7);

    await expect(service.getDashboard()).resolves.toMatchObject({
      pendingShareRewardCount: 7,
    });
    expect(prisma.normalShareBinding.count).toHaveBeenCalledWith({
      where: {
        rewardStatus: { in: ['PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING'] },
      },
    });
  });

  it('disables and re-enables a normal share profile without deleting bindings', async () => {
    const { service, prisma } = makeHarness();

    await expect(service.setNormalShareProfileStatus('user-1', 'DISABLED', '风控')).resolves.toMatchObject({
      status: 'DISABLED',
      disabledReason: '风控',
    });
    expect(prisma.normalShareProfile.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: {
        status: 'DISABLED',
        disabledReason: '风控',
      },
    });

    await service.setNormalShareProfileStatus('user-1', 'ACTIVE');
    expect(prisma.normalShareProfile.update).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      data: {
        status: 'ACTIVE',
        disabledReason: null,
      },
    });
  });
});
