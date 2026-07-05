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
  normalShareBindings?: any[];
  ledgers?: any[];
  summaryUsers?: any[];
  couponCampaign?: any;
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
    memberProfile: { tier: 'NORMAL', inviterUserId: null },
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
  const accountUsers = options.users ?? [baseUser];
  const summaryUsers = options.summaryUsers ?? [];
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(options.resolvedUser ?? { id: 'user-1' }),
      findMany: jest.fn((args: any) => {
        const ids = args?.where?.id?.in;
        if (Array.isArray(ids)) {
          return Promise.resolve(summaryUsers.filter((user) => ids.includes(user.id)));
        }
        return Promise.resolve(accountUsers);
      }),
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
      findMany: jest.fn().mockResolvedValue(options.ledgers ?? []),
      count: jest.fn().mockResolvedValue(options.ledgers?.length ?? 0),
    },
    growthExchangeRecord: {
      count: jest.fn().mockResolvedValue(4),
    },
    normalShareBinding: {
      findMany: jest.fn().mockResolvedValue(options.normalShareBindings ?? []),
      count: jest.fn().mockResolvedValue(options.normalShareBindings?.length ?? 0),
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
    couponCampaign: {
      findUnique: jest.fn().mockResolvedValue(options.couponCampaign ?? {
        id: 'campaign-1',
        name: '系统发放红包',
        status: 'ACTIVE',
        distributionMode: 'MANUAL',
        growthExchangeEnabled: true,
        startAt: new Date('2026-07-01T00:00:00.000Z'),
        endAt: new Date('2026-12-31T23:59:59.000Z'),
        issuedCount: 0,
        totalQuota: 100,
      }),
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

  it('rejects enabling behavior rules whose event handlers are not wired', async () => {
    const { service, prisma } = makeHarness();

    await expect(
      service.upsertBehaviorRule({
        code: 'BROWSE_PRODUCTS',
        name: '浏览商品',
        categoryCode: 'DAILY',
        pointsReward: 5,
        growthReward: 5,
        enabled: true,
      }),
    ).rejects.toThrow('该成长行为暂未接入自动发放，不能启用');
    expect(prisma.growthBehaviorRule.upsert).not.toHaveBeenCalled();
  });

  it('allows saving unwired behavior rules only while disabled', async () => {
    const { service, prisma } = makeHarness();

    await expect(
      service.upsertBehaviorRule({
        code: 'BROWSE_PRODUCTS',
        name: '浏览商品',
        categoryCode: 'DAILY',
        pointsReward: 5,
        growthReward: 5,
        enabled: false,
      }),
    ).resolves.toMatchObject({
      code: 'BROWSE_PRODUCTS',
      enabled: false,
    });
    expect(prisma.growthBehaviorRule.upsert).toHaveBeenCalled();
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

  it('rejects exchange item types without a fulfillment channel from admin API', async () => {
    const { service, prisma } = makeHarness();

    await expect(
      service.createExchangeItem({
        type: 'LOTTERY_CHANCE',
        name: '抽奖机会',
        pointsCost: 100,
      } as any),
    ).rejects.toThrow('该兑换类型暂未接入发放通道');
    expect(prisma.growthExchangeItem.create).not.toHaveBeenCalled();
  });

  it('rejects coupon exchange items backed by user-claim coupon campaigns', async () => {
    const { service, prisma } = makeHarness({
      couponCampaign: {
        id: 'campaign-claim',
        name: '领券中心红包',
        status: 'ACTIVE',
        distributionMode: 'CLAIM',
        growthExchangeEnabled: false,
        startAt: new Date('2026-07-01T00:00:00.000Z'),
        endAt: new Date('2026-12-31T23:59:59.000Z'),
        issuedCount: 0,
        totalQuota: 100,
      },
    });

    await expect(
      service.createExchangeItem({
        type: 'COUPON',
        name: '5元红包',
        pointsCost: 100,
        couponCampaignId: 'campaign-claim',
      }),
    ).rejects.toThrow('积分兑换只能绑定手动发放的积分兑换专用红包池');
    expect(prisma.growthExchangeItem.create).not.toHaveBeenCalled();
  });

  it('rejects coupon exchange items backed by regular manual coupon campaigns', async () => {
    const { service, prisma } = makeHarness({
      couponCampaign: {
        id: 'campaign-manual',
        name: '普通手动红包',
        status: 'ACTIVE',
        distributionMode: 'MANUAL',
        growthExchangeEnabled: false,
        startAt: new Date('2026-07-01T00:00:00.000Z'),
        endAt: new Date('2026-12-31T23:59:59.000Z'),
        issuedCount: 0,
        totalQuota: 100,
      },
    });

    await expect(
      service.createExchangeItem({
        type: 'COUPON',
        name: '5元红包',
        pointsCost: 100,
        couponCampaignId: 'campaign-manual',
      }),
    ).rejects.toThrow('只能绑定标记为积分兑换专用的红包活动');
    expect(prisma.growthExchangeItem.create).not.toHaveBeenCalled();
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
      settings: {
        GROWTH_ENABLED: true,
        GROWTH_POINTS_EXPIRE_DAYS: 180,
        AUTO_VIP_BY_SPEND_ENABLED: false,
        AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD: 699,
      },
    });

    await expect(service.getSettings()).resolves.toMatchObject({
      growthEnabled: true,
      pointsExpireDays: 180,
      dailyPointsCap: 300,
      autoVipBySpendEnabled: false,
      autoVipCumulativeSpendThreshold: 699,
    });

    const result = await service.updateSettings({
      growthEnabled: false,
      dailyPointsCap: 200,
      autoVipBySpendEnabled: true,
      autoVipCumulativeSpendThreshold: 399,
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
    expect(tx.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'AUTO_VIP_BY_SPEND_ENABLED' },
      create: { key: 'AUTO_VIP_BY_SPEND_ENABLED', value: true },
      update: { value: true },
    });
    expect(tx.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD' },
      create: { key: 'AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD', value: 399 },
      update: { value: 399 },
    });
    expect(prisma.ruleConfig.findMany).toHaveBeenCalled();
    expect(result).toMatchObject({
      growthEnabled: true,
      pointsExpireDays: 180,
      autoVipBySpendEnabled: false,
      autoVipCumulativeSpendThreshold: 699,
    });
  });

  it('unwraps JSON-style RuleConfig values when reading settings', async () => {
    const { service } = makeHarness({
      settings: {
        GROWTH_ENABLED: { value: true, description: '是否启用成长体系' },
        GROWTH_DAILY_POINTS_CAP: { value: 300, description: '每日积分上限' },
        AUTO_VIP_BY_SPEND_ENABLED: { value: false, description: '是否开启自动VIP' },
        AUTO_VIP_CUMULATIVE_SPEND_THRESHOLD: { value: 699, description: '累计消费门槛' },
      },
    });

    await expect(service.getSettings()).resolves.toMatchObject({
      growthEnabled: true,
      dailyPointsCap: 300,
      autoVipBySpendEnabled: false,
      autoVipCumulativeSpendThreshold: 699,
    });
  });

  it('counts active unissued normal-share rewards in the dashboard pending total', async () => {
    const { service, prisma } = makeHarness();
    prisma.normalShareBinding.count.mockResolvedValueOnce(7);

    await expect(service.getDashboard()).resolves.toMatchObject({
      pendingShareRewardCount: 7,
    });
    expect(prisma.normalShareBinding.count).toHaveBeenCalledWith({
      where: {
        relationStatus: 'ACTIVE',
        rewardStatus: { in: ['PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING'] },
      },
    });
  });

  it('adds VIP tree inviter summary to automatic VIP upgrade ledgers', async () => {
    const ledger = {
      id: 'ledger-auto-vip-1',
      userId: 'upgraded-user',
      accountId: 'growth-account-1',
      type: 'ADMIN_ADJUST',
      behaviorCode: 'AUTO_VIP_UPGRADE',
      pointsDelta: 0,
      growthDelta: 0,
      status: 'POSTED',
      idempotencyKey: 'AUTO_VIP_UPGRADE:order-1:upgraded-user',
      refType: 'ORDER',
      refId: 'order-1',
      createdAt: new Date('2026-07-05T10:00:00.000Z'),
      meta: {
        event: 'AUTO_VIP_UPGRADE',
        vipTreeInviterUserId: 'vip-inviter-1',
      },
      user: {
        id: 'upgraded-user',
        buyerNo: 'AIMM00000000000111',
        profile: { nickname: '升级用户', avatarUrl: null },
        memberProfile: { tier: 'VIP', referralCode: 'VIP111' },
        normalShareProfile: null,
        authIdentities: [{ identifier: '13800001111' }],
      },
    };
    const inviterUser = {
      id: 'vip-inviter-1',
      buyerNo: 'AIMM00000000000100',
      status: 'ACTIVE',
      profile: { nickname: 'VIP 上级', avatarUrl: null },
      memberProfile: { tier: 'VIP', referralCode: 'VIP100' },
      normalShareProfile: null,
      authIdentities: [{ identifier: '13900001000' }],
    };
    const { service, prisma } = makeHarness({
      ledgers: [ledger],
      summaryUsers: [inviterUser],
    });

    await expect(service.listLedgers({ behaviorCode: 'AUTO_VIP_UPGRADE' })).resolves.toMatchObject({
      items: [
        {
          id: 'ledger-auto-vip-1',
          autoVipTreeInviter: {
            id: 'vip-inviter-1',
            buyerNo: 'AIMM00000000000100',
            nickname: 'VIP 上级',
            phone: '139****1000',
            vipStatus: 'VIP',
            vipReferralCode: 'VIP100',
          },
        },
      ],
      total: 1,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['vip-inviter-1'] } },
      select: expect.any(Object),
    }));
    expect(prisma.growthLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        user: {
          select: expect.objectContaining({
            status: true,
            memberProfile: expect.any(Object),
            normalShareProfile: expect.any(Object),
          }),
        },
      },
    }));
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

  it('adds direct referral summary from member profile to growth account rows', async () => {
    const referredUser = {
      id: 'normal-user-with-inviter',
      buyerNo: 'AIMM00000000000101',
      status: 'ACTIVE',
      deletionExecutedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-04T08:00:00.000Z'),
      profile: { nickname: '被邀请用户', avatarUrl: null },
      memberProfile: { tier: 'NORMAL', inviterUserId: 'inviter-user-1' },
      growthAccount: null,
      normalShareProfile: null,
      normalShareBindingReceived: null,
      authIdentities: [{ identifier: '13800001010' }],
    };
    const inviterUser = {
      id: 'inviter-user-1',
      buyerNo: 'AIMM00000000000100',
      status: 'ACTIVE',
      profile: { nickname: '邀请人', avatarUrl: 'https://example.test/avatar.png' },
      memberProfile: { tier: 'VIP', referralCode: 'VIP100' },
      normalShareProfile: { code: 'S100001', status: 'ACTIVE' },
      authIdentities: [{ identifier: '13900001000' }],
    };
    const { service, prisma } = makeHarness({
      users: [referredUser],
      summaryUsers: [inviterUser],
      levels: [{ code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true }],
    });

    await expect(service.listUserAccounts({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      items: [
        {
          userId: 'normal-user-with-inviter',
          directReferralInviterUserId: 'inviter-user-1',
          directReferralStatus: 'ACTIVE',
          directReferralSource: 'MEMBER_PROFILE',
          directReferralInviter: {
            id: 'inviter-user-1',
            buyerNo: 'AIMM00000000000100',
            nickname: '邀请人',
            phone: '139****1000',
            vipStatus: 'VIP',
            vipReferralCode: 'VIP100',
          },
        },
      ],
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['inviter-user-1'] } },
      select: expect.any(Object),
    }));
  });

  it('shows invalidated normal binding status on growth account rows when no member inviter exists', async () => {
    const invalidatedAt = new Date('2026-07-05T09:00:00.000Z');
    const user = {
      id: 'vip-upgraded-user',
      buyerNo: 'AIMM00000000000102',
      status: 'ACTIVE',
      deletionExecutedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-04T08:00:00.000Z'),
      profile: { nickname: '已升级用户', avatarUrl: null },
      memberProfile: { tier: 'VIP', referralCode: 'VIP102', inviterUserId: null },
      growthAccount: null,
      normalShareProfile: null,
      normalShareBindingReceived: {
        inviterUserId: 'old-normal-inviter',
        effectiveInviterUserId: null,
        source: 'APP',
        relationStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
        relationInvalidAt: invalidatedAt,
        relationInvalidReason: 'INVITER_NOT_VIP_AT_INVITEE_UPGRADE',
      },
      authIdentities: [{ identifier: '13800001020' }],
    };
    const { service } = makeHarness({
      users: [user],
      levels: [{ code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true }],
    });

    await expect(service.listUserAccounts({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      items: [
        {
          userId: 'vip-upgraded-user',
          directReferralInviterUserId: null,
          directReferralStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
          directReferralSource: 'APP',
          directReferralInvalidAt: invalidatedAt,
          directReferralInvalidReason: 'INVITER_NOT_VIP_AT_INVITEE_UPGRADE',
          directReferralInviter: null,
        },
      ],
    });
  });

  it('uses invalidated normal binding status instead of stale member-profile inviter on growth account rows', async () => {
    const invalidatedAt = new Date('2026-07-05T10:00:00.000Z');
    const user = {
      id: 'stale-member-inviter-user',
      buyerNo: 'AIMM00000000000103',
      status: 'ACTIVE',
      deletionExecutedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-04T08:00:00.000Z'),
      profile: { nickname: '历史异常用户', avatarUrl: null },
      memberProfile: {
        tier: 'VIP',
        referralCode: 'VIP103',
        inviterUserId: 'old-normal-inviter',
      },
      growthAccount: null,
      normalShareProfile: null,
      normalShareBindingReceived: {
        inviterUserId: 'old-normal-inviter',
        effectiveInviterUserId: null,
        source: 'APP',
        relationStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
        relationInvalidAt: invalidatedAt,
        relationInvalidReason: 'INVITER_NOT_VIP_AT_INVITEE_UPGRADE',
      },
      authIdentities: [{ identifier: '13800001030' }],
    };
    const { service, prisma } = makeHarness({
      users: [user],
      levels: [{ code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true }],
    });

    await expect(service.listUserAccounts({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      items: [
        {
          userId: 'stale-member-inviter-user',
          directReferralInviterUserId: null,
          directReferralStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
          directReferralSource: 'APP',
          directReferralInvalidAt: invalidatedAt,
          directReferralInvalidReason: 'INVITER_NOT_VIP_AT_INVITEE_UPGRADE',
          directReferralInviter: null,
        },
      ],
    });
    expect(prisma.user.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['old-normal-inviter'] } },
    }));
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
        memberProfile: { select: expect.objectContaining({ tier: true, referralCode: true, inviterUserId: true }) },
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

  it('lists normal share bindings with relation audit fields and effective inviter summary', async () => {
    const invalidatedAt = new Date('2026-07-05T09:00:00.000Z');
    const binding = {
      id: 'binding-1',
      inviterUserId: 'original-inviter',
      inviteeUserId: 'invitee-1',
      code: 'S123456',
      source: 'APP',
      relationStatus: 'SUPERSEDED_BY_VIP_TREE',
      relationInvalidAt: invalidatedAt,
      relationInvalidReason: 'INVITER_UPGRADED_BEFORE_INVITEE',
      effectiveInviterUserId: 'effective-vip-inviter',
      rewardStatus: 'REGISTER_REWARDED',
      createdAt: new Date('2026-07-04T08:00:00.000Z'),
      updatedAt: new Date('2026-07-05T09:00:00.000Z'),
      inviter: {
        id: 'original-inviter',
        buyerNo: 'AIMM00000000000111',
        status: 'ACTIVE',
        profile: { nickname: '原普通邀请人', avatarUrl: null },
        memberProfile: { tier: 'NORMAL' },
        normalShareProfile: { code: 'S111111', status: 'ACTIVE' },
        authIdentities: [{ identifier: '13800001111' }],
      },
      invitee: {
        id: 'invitee-1',
        buyerNo: 'AIMM00000000000112',
        status: 'ACTIVE',
        profile: { nickname: '被邀请人', avatarUrl: null },
        memberProfile: { tier: 'VIP', referralCode: 'VIP112' },
        normalShareProfile: null,
        authIdentities: [{ identifier: '13800001112' }],
      },
    };
    const effectiveInviter = {
      id: 'effective-vip-inviter',
      buyerNo: 'AIMM00000000000113',
      status: 'ACTIVE',
      profile: { nickname: '有效VIP邀请人', avatarUrl: null },
      memberProfile: { tier: 'VIP', referralCode: 'VIP113' },
      normalShareProfile: null,
      authIdentities: [{ identifier: '13800001113' }],
    };
    const { service } = makeHarness({
      normalShareBindings: [binding],
      summaryUsers: [effectiveInviter],
    });

    await expect(service.listNormalShareBindings({ page: 1, pageSize: 20 })).resolves.toMatchObject({
      total: 1,
      items: [
        {
          id: 'binding-1',
          relationStatus: 'SUPERSEDED_BY_VIP_TREE',
          relationInvalidAt: invalidatedAt,
          relationInvalidReason: 'INVITER_UPGRADED_BEFORE_INVITEE',
          effectiveInviterUserId: 'effective-vip-inviter',
          inviter: { nickname: '原普通邀请人', phone: '138****1111' },
          invitee: { nickname: '被邀请人', phone: '138****1112' },
          effectiveInviter: {
            id: 'effective-vip-inviter',
            nickname: '有效VIP邀请人',
            phone: '138****1113',
            vipStatus: 'VIP',
            vipReferralCode: 'VIP113',
          },
        },
      ],
    });
  });
});
