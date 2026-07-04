import { GrowthService } from './growth.service';

describe('GrowthService', () => {
  it('creates and returns an empty account when user has no growth account', async () => {
    const prisma: any = {
      growthAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: 'ga-created',
          userId: 'u1',
          pointsBalance: 0,
          pointsTotalEarned: 0,
          pointsTotalSpent: 0,
          growthValue: 0,
          currentLevelCode: null,
          createdAt: new Date('2026-07-04T00:00:00.000Z'),
          updatedAt: new Date('2026-07-04T00:00:00.000Z'),
        }),
      },
      growthLevel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new GrowthService(prisma);

    await expect(service.getMe('u1')).resolves.toMatchObject({
      pointsBalance: 0,
      growthValue: 0,
      level: null,
      nextLevel: null,
    });
    expect(prisma.growthAccount.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: {
        userId: 'u1',
        pointsBalance: 0,
        pointsTotalEarned: 0,
        pointsTotalSpent: 0,
        growthValue: 0,
      },
      update: {},
    });
  });

  it('returns level progress from configured levels', async () => {
    const prisma: any = {
      growthAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'ga-1',
          userId: 'u1',
          pointsBalance: 120,
          pointsTotalEarned: 200,
          pointsTotalSpent: 80,
          growthValue: 450,
          currentLevelCode: 'SEEDLING',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      },
      growthLevel: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true },
          { code: 'SEEDLING', name: '青苗会员', threshold: 300, enabled: true },
          { code: 'EAR', name: '青穗会员', threshold: 1000, enabled: true },
        ]),
      },
    };
    const service = new GrowthService(prisma);

    await expect(service.getMe('u1')).resolves.toMatchObject({
      pointsBalance: 120,
      growthValue: 450,
      level: { code: 'SEEDLING', name: '青苗会员', threshold: 300 },
      nextLevel: { code: 'EAR', name: '青穗会员', threshold: 1000 },
      levelProgress: {
        current: 150,
        required: 700,
        ratio: 0.2143,
      },
    });
  });

  it('returns buyer-visible earning rules and levels from admin configuration', async () => {
    const prisma: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ tier: 'NORMAL' }),
      },
      growthBehaviorRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            code: 'NORMAL_INVITE_REGISTER',
            name: '邀请好友注册',
            categoryCode: 'INVITE',
            pointsReward: 20,
            growthReward: 20,
            grantTiming: 'IMMEDIATE',
            dailyLimit: 5,
            weeklyLimit: null,
            monthlyLimit: null,
            lifetimeLimit: null,
            enabled: true,
            sortOrder: 10,
          },
          {
            code: 'NORMAL_INVITE_FIRST_ORDER',
            name: '好友首单确认收货',
            categoryCode: 'INVITE',
            pointsReward: 200,
            growthReward: 300,
            grantTiming: 'CONFIRMED_RECEIPT',
            dailyLimit: null,
            weeklyLimit: null,
            monthlyLimit: 20,
            lifetimeLimit: null,
            enabled: true,
            sortOrder: 20,
          },
          {
            code: 'CHECK_IN',
            name: '每日签到',
            categoryCode: 'DAILY',
            pointsReward: 5,
            growthReward: 0,
            grantTiming: 'IMMEDIATE',
            dailyLimit: 1,
            weeklyLimit: null,
            monthlyLimit: null,
            lifetimeLimit: null,
            enabled: true,
            sortOrder: 30,
          },
        ]),
      },
      growthLevel: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true },
          { code: 'SEEDLING', name: '青苗会员', threshold: 300, enabled: true },
        ]),
      },
    };
    const service = new GrowthService(prisma);

    await expect(service.getGuide('u1')).resolves.toMatchObject({
      inviteRules: [
        { code: 'NORMAL_INVITE_REGISTER', pointsReward: 20, growthReward: 20 },
        { code: 'NORMAL_INVITE_FIRST_ORDER', pointsReward: 200, growthReward: 300 },
      ],
      earningRules: [
        { code: 'CHECK_IN', name: '每日签到', pointsReward: 5, growthReward: 0 },
      ],
      levels: [
        { code: 'SPROUT', name: '新芽会员', threshold: 0 },
        { code: 'SEEDLING', name: '青苗会员', threshold: 300 },
      ],
      pointsNote: '普通积分用于兑换红包和权益，兑换时会消耗。',
      growthNote: '成长值用于升级，不会因为积分兑换而减少。',
    });
    expect(prisma.growthBehaviorRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        enabled: true,
        OR: expect.arrayContaining([
          { applicableUserType: 'ALL' },
          { applicableUserType: 'NORMAL' },
        ]),
      }),
    }));
  });
});
