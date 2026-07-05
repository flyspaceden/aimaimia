import { BadRequestException } from '@nestjs/common';
import { AdminGrowthService } from './admin-growth.service';

const makeHarness = (options: {
  account?: any;
  accounts?: any[];
  resolvedUser?: any;
  users?: any[];
  userCount?: number;
  levels?: any[];
  levelCode?: string | null;
  settings?: Record<string, unknown>;
  normalShareProfile?: any;
} = {}) => {
  const userUpdatedAt = new Date('2026-07-04T08:00:00.000Z');
  const baseAccount = options.account ?? {
    id: 'account-1',
    userId: 'user-1',
    pointsBalance: 100,
    pointsTotalEarned: 150,
    pointsTotalSpent: 50,
    growthValue: 200,
    currentLevelCode: null,
    createdAt: new Date('2026-07-03T08:00:00.000Z'),
    updatedAt: new Date('2026-07-04T08:00:00.000Z'),
  };
  const baseUser = {
    id: 'user-1',
    buyerNo: 'AIMM00000000000001',
    status: 'ACTIVE',
    deletionExecutedAt: null,
    createdAt: new Date('2026-07-03T08:00:00.000Z'),
    updatedAt: userUpdatedAt,
    profile: { nickname: '普通用户', avatarUrl: null },
    memberProfile: { tier: 'NORMAL' },
    growthAccount: baseAccount,
    normalShareProfile: {
      code: 'S123456',
      status: 'ACTIVE',
    },
    authIdentities: [{ identifier: '13800001234' }],
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
      findMany: jest.fn().mockResolvedValue(options.users ?? [baseUser]),
      count: jest.fn().mockResolvedValue(options.userCount ?? options.users?.length ?? 1),
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
      findMany: jest.fn().mockResolvedValue(options.levels ?? []),
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
      findMany: jest.fn().mockResolvedValue(options.accounts ?? []),
      count: jest.fn().mockResolvedValue(options.accounts?.length ?? 0),
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

  it('uses a unified points balance error for manual deduction', async () => {
    const { service } = makeHarness();

    await expect(
      service.adjustUser('user-1', {
        pointsDelta: -101,
        growthDelta: 0,
        reason: '异常扣减',
      }, 'admin-1'),
    ).rejects.toThrow('积分余额不足，不能扣减');
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

  it('uses active ordinary buyer users, not only growth account rows, for dashboard account count', async () => {
    const { service, prisma } = makeHarness({ userCount: 9 });

    await expect(service.getDashboard()).resolves.toMatchObject({
      accountCount: 9,
      totalPointsBalance: 100,
      totalGrowthValue: 200,
    });

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        buyerNo: { not: null },
        status: 'ACTIVE',
        deletionExecutedAt: null,
      }),
    });
    expect(prisma.growthAccount.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        user: {
          is: expect.objectContaining({
            buyerNo: { not: null },
            status: 'ACTIVE',
            deletionExecutedAt: null,
          }),
        },
      },
    }));
    expect(prisma.growthLedger.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        user: {
          is: expect.objectContaining({
            buyerNo: { not: null },
            status: 'ACTIVE',
            deletionExecutedAt: null,
          }),
        },
      }),
    }));
    expect(prisma.growthExchangeRecord.count).toHaveBeenCalledWith({
      where: {
        user: {
          is: expect.objectContaining({
            buyerNo: { not: null },
            status: 'ACTIVE',
            deletionExecutedAt: null,
          }),
        },
        status: 'SUCCESS',
      },
    });
  });

  it('lists active ordinary buyers even before a GrowthAccount row exists', async () => {
    const missingAccountUser = {
      id: 'normal-user-without-account',
      buyerNo: 'AIMM00000000000088',
      status: 'ACTIVE',
      deletionExecutedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-04T08:00:00.000Z'),
      profile: { nickname: '还没进成长页的普通用户', avatarUrl: null },
      memberProfile: { tier: 'NORMAL' },
      growthAccount: null,
      normalShareProfile: null,
      authIdentities: [{ identifier: '13800008888' }],
    };
    const { service, prisma } = makeHarness({
      users: [missingAccountUser],
      levels: [
        { code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true },
        { code: 'SEEDLING', name: '青苗会员', threshold: 300, enabled: true },
      ],
    });

    await expect(service.listUserAccounts({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      total: 1,
      items: [
        {
          id: 'virtual-growth-account:normal-user-without-account',
          userId: 'normal-user-without-account',
          pointsBalance: 0,
          pointsTotalEarned: 0,
          pointsTotalSpent: 0,
          growthValue: 0,
          currentLevelCode: 'SPROUT',
          currentLevel: { code: 'SPROUT', name: '新芽会员', threshold: 0 },
          user: {
            buyerNo: 'AIMM00000000000088',
            nickname: '还没进成长页的普通用户',
            phone: '138****8888',
            vipStatus: 'NORMAL',
            normalShareCode: null,
          },
        },
      ],
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        buyerNo: { not: null },
        status: 'ACTIVE',
        deletionExecutedAt: null,
      }),
      include: expect.objectContaining({
        growthAccount: expect.any(Object),
        normalShareProfile: expect.any(Object),
      }),
    }));
    expect(prisma.growthAccount.findMany).not.toHaveBeenCalled();
  });

  it('can list VIP growth accounts without mixing VIP referral management into normal share', async () => {
    const vipUser = {
      id: 'vip-user-1',
      buyerNo: 'AIMM00000000000090',
      status: 'ACTIVE',
      deletionExecutedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-04T08:00:00.000Z'),
      profile: { nickname: 'VIP 用户', avatarUrl: null },
      memberProfile: { tier: 'VIP', referralCode: 'VIPCODE1' },
      growthAccount: {
        id: 'growth-vip',
        userId: 'vip-user-1',
        pointsBalance: 260,
        pointsTotalEarned: 300,
        pointsTotalSpent: 40,
        growthValue: 800,
        currentLevelCode: 'SEEDLING',
        currentLevel: { code: 'SEEDLING', name: '青苗会员', threshold: 300 },
        createdAt: new Date('2026-07-04T08:00:00.000Z'),
        updatedAt: new Date('2026-07-04T08:00:00.000Z'),
      },
      normalShareProfile: { code: 'SLEGACY1', status: 'ACTIVE' },
      authIdentities: [{ identifier: '13900009999' }],
    };
    const { service, prisma } = makeHarness({
      users: [vipUser],
      levels: [
        { code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true },
        { code: 'SEEDLING', name: '青苗会员', threshold: 300, enabled: true },
      ],
    });

    await expect(service.listUserAccounts({ page: 1, pageSize: 20, userType: 'VIP' } as any)).resolves.toMatchObject({
      total: 1,
      items: [
        {
          id: 'growth-vip',
          userId: 'vip-user-1',
          pointsBalance: 260,
          growthValue: 800,
          currentLevelCode: 'SEEDLING',
          user: {
            buyerNo: 'AIMM00000000000090',
            nickname: 'VIP 用户',
            vipStatus: 'VIP',
            vipReferralCode: 'VIPCODE1',
            normalShareCode: null,
          },
        },
      ],
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        memberProfile: { is: { tier: 'VIP' } },
      }),
      include: expect.objectContaining({
        memberProfile: { select: { tier: true, referralCode: true } },
        normalShareProfile: expect.any(Object),
      }),
    }));
  });

  it('matches migrated zero-value accounts when filtering by the threshold-zero level', async () => {
    const migratedAccountUser = {
      id: 'normal-user-with-null-level',
      buyerNo: 'AIMM00000000000089',
      status: 'ACTIVE',
      deletionExecutedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-04T08:00:00.000Z'),
      profile: { nickname: '已迁移普通用户', avatarUrl: null },
      memberProfile: { tier: 'NORMAL' },
      growthAccount: {
        id: 'growth-null-level',
        userId: 'normal-user-with-null-level',
        pointsBalance: 0,
        pointsTotalEarned: 0,
        pointsTotalSpent: 0,
        growthValue: 0,
        currentLevelCode: null,
        currentLevel: null,
        createdAt: new Date('2026-07-04T08:00:00.000Z'),
        updatedAt: new Date('2026-07-04T08:00:00.000Z'),
      },
      normalShareProfile: { code: 'S2233445', status: 'ACTIVE' },
      authIdentities: [{ identifier: '13800008889' }],
    };
    const { service, prisma } = makeHarness({
      users: [migratedAccountUser],
      levels: [
        { code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true },
        { code: 'SEEDLING', name: '青苗会员', threshold: 300, enabled: true },
      ],
    });

    await expect(service.listUserAccounts({ page: 1, pageSize: 20, levelCode: 'SPROUT' })).resolves.toMatchObject({
      items: [
        {
          id: 'growth-null-level',
          currentLevelCode: 'SPROUT',
          currentLevel: { code: 'SPROUT', name: '新芽会员', threshold: 0 },
        },
      ],
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          {
            OR: expect.arrayContaining([
              { growthAccount: { is: null } },
              {
                growthAccount: {
                  is: {
                    currentLevelCode: null,
                    growthValue: { gte: 0, lt: 300 },
                  },
                },
              },
            ]),
          },
        ]),
      }),
    }));
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
