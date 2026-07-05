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

  it('returns normal direct referral rate and auto VIP spend progress for app display', async () => {
    const prisma: any = {
      growthAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'ga-1',
          userId: 'normal-user',
          pointsBalance: 60,
          pointsTotalEarned: 80,
          pointsTotalSpent: 20,
          growthValue: 120,
          updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      },
      growthLevel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ tier: 'NORMAL', inviterUserId: null }),
      },
      digitalAssetAccount: {
        findUnique: jest.fn().mockResolvedValue({ cumulativeSpendAmount: 120 }),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue({
          relationStatus: 'ACTIVE',
          effectiveInviterUserId: 'inviter-1',
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inviter-1',
          buyerNo: 'AIMM00000000000001',
          profile: { nickname: '张三' },
        }),
      },
    };
    const bonusConfig = {
      getConfig: jest.fn().mockResolvedValue({
        autoVipBySpendEnabled: true,
        autoVipCumulativeSpendThreshold: 399,
        normalDirectReferralPercent: 0.01,
        vipDirectReferralPercent: 0.05,
      }),
    };
    const service = new GrowthService(prisma, undefined, bonusConfig as any);

    await expect(service.getMe('normal-user')).resolves.toMatchObject({
      directReferralStatus: 'ACTIVE',
      directReferralInviter: {
        id: 'inviter-1',
        nickname: '张三',
        buyerNo: 'AIMM00000000000001',
      },
      autoVipBySpendEnabled: true,
      autoVipCumulativeSpendThreshold: 399,
      autoVipRemainingSpend: 279,
      directReferralPercent: 0.01,
    });
  });

  it('returns VIP direct referral rate and no auto VIP remaining spend for VIP users', async () => {
    const prisma: any = {
      growthAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'ga-1',
          userId: 'vip-user',
          pointsBalance: 60,
          pointsTotalEarned: 80,
          pointsTotalSpent: 20,
          growthValue: 120,
          updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      },
      growthLevel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ tier: 'VIP', inviterUserId: 'vip-inviter' }),
      },
      digitalAssetAccount: {
        findUnique: jest.fn().mockResolvedValue({ cumulativeSpendAmount: 500 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vip-inviter',
          buyerNo: 'AIMM00000000000002',
          profile: { nickname: '李四' },
        }),
      },
    };
    const bonusConfig = {
      getConfig: jest.fn().mockResolvedValue({
        autoVipBySpendEnabled: true,
        autoVipCumulativeSpendThreshold: 399,
        normalDirectReferralPercent: 0.01,
        vipDirectReferralPercent: 0.05,
      }),
    };
    const service = new GrowthService(prisma, undefined, bonusConfig as any);

    await expect(service.getMe('vip-user')).resolves.toMatchObject({
      directReferralStatus: 'ACTIVE',
      directReferralInviter: {
        id: 'vip-inviter',
        nickname: '李四',
        buyerNo: 'AIMM00000000000002',
      },
      autoVipBySpendEnabled: true,
      autoVipCumulativeSpendThreshold: 399,
      autoVipRemainingSpend: null,
      directReferralPercent: 0.05,
    });
    expect(prisma.normalShareBinding?.findUnique).toBeUndefined();
  });

  it('does not show a stale member-profile inviter as active when normal binding is invalidated', async () => {
    const prisma: any = {
      growthAccount: {
        upsert: jest.fn().mockResolvedValue({
          id: 'ga-1',
          userId: 'vip-upgraded-user',
          pointsBalance: 60,
          pointsTotalEarned: 80,
          pointsTotalSpent: 20,
          growthValue: 120,
          updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      },
      growthLevel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          tier: 'VIP',
          inviterUserId: 'old-normal-inviter',
        }),
      },
      digitalAssetAccount: {
        findUnique: jest.fn().mockResolvedValue({ cumulativeSpendAmount: 500 }),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue({
          inviterUserId: 'old-normal-inviter',
          relationStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
          effectiveInviterUserId: null,
        }),
      },
      user: {
        findUnique: jest.fn(),
      },
    };
    const bonusConfig = {
      getConfig: jest.fn().mockResolvedValue({
        autoVipBySpendEnabled: true,
        autoVipCumulativeSpendThreshold: 399,
        normalDirectReferralPercent: 0.01,
        vipDirectReferralPercent: 0.05,
      }),
    };
    const service = new GrowthService(prisma, undefined, bonusConfig as any);

    await expect(service.getMe('vip-upgraded-user')).resolves.toMatchObject({
      directReferralStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
      directReferralInviter: null,
      directReferralPercent: 0.05,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
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
          {
            code: 'BROWSE_PRODUCTS',
            name: '浏览商品',
            categoryCode: 'DAILY',
            pointsReward: 5,
            growthReward: 5,
            grantTiming: 'IMMEDIATE',
            dailyLimit: 1,
            weeklyLimit: null,
            monthlyLimit: null,
            lifetimeLimit: null,
            enabled: true,
            sortOrder: 40,
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
