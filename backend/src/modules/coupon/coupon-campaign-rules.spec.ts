import { BadRequestException } from '@nestjs/common';
import { CouponEngineService } from './coupon-engine.service';
import { CouponService } from './coupon.service';

const baseCreateDto = {
  name: '新人长期红包',
  triggerType: 'REGISTER',
  distributionMode: 'AUTO',
  discountType: 'FIXED',
  discountValue: 8,
  minOrderAmount: 8,
  totalQuota: 100,
  maxPerUser: 1,
  validDays: 7,
  startAt: '2026-07-01T00:00:00.000Z',
};

describe('Coupon campaign rule validation', () => {
  const makeService = () => {
    const prisma = {
      couponCampaign: {
        create: jest.fn().mockResolvedValue({ id: 'campaign-1' }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      couponInstance: {
        groupBy: jest.fn(),
      },
    };
    return {
      prisma,
      service: new CouponService(prisma as any, {} as any),
    };
  };

  it('allows evergreen automatic campaigns to omit endAt', async () => {
    const { service, prisma } = makeService();

    await service.createCampaign({ ...baseCreateDto, endAt: null } as any, 'admin-1');

    expect(prisma.couponCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerType: 'REGISTER',
          distributionMode: 'AUTO',
          endAt: null,
        }),
      }),
    );
  });

  it('defaults new campaigns to non-stackable when omitted', async () => {
    const { service, prisma } = makeService();

    await service.createCampaign({ ...baseCreateDto, endAt: null } as any, 'admin-1');

    expect(prisma.couponCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stackable: false,
        }),
      }),
    );
  });

  it('rejects time-bound claim campaigns without endAt', async () => {
    const { service } = makeService();

    await expect(
      service.createCampaign(
        {
          ...baseCreateDto,
          name: '节日红包',
          triggerType: 'HOLIDAY',
          distributionMode: 'CLAIM',
          endAt: null,
        } as any,
        'admin-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects cumulative spend campaigns without spendThreshold', async () => {
    const { service } = makeService();

    await expect(
      service.createCampaign(
        {
          ...baseCreateDto,
          name: '累计消费红包',
          triggerType: 'CUMULATIVE_SPEND',
          distributionMode: 'AUTO',
          endAt: null,
          triggerConfig: {},
        } as any,
        'admin-1',
      ),
    ).rejects.toThrow('累计消费红包必须填写消费门槛');
  });

  it('allows cumulative spend campaigns to use claim distribution with threshold eligibility', async () => {
    const { service, prisma } = makeService();

    await service.createCampaign(
      {
        ...baseCreateDto,
        name: '累计消费领取红包',
        triggerType: 'CUMULATIVE_SPEND',
        distributionMode: 'CLAIM',
        triggerConfig: { spendThreshold: 100 },
        endAt: null,
      } as any,
      'admin-1',
    );

    expect(prisma.couponCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerType: 'CUMULATIVE_SPEND',
          distributionMode: 'CLAIM',
          triggerConfig: { spendThreshold: 100 },
          endAt: null,
        }),
      }),
    );
  });

  it('requires an automatic audience for auto holiday and flash campaigns', async () => {
    const { service } = makeService();

    await expect(
      service.createCampaign(
        {
          ...baseCreateDto,
          name: '自动节日红包',
          triggerType: 'HOLIDAY',
          distributionMode: 'AUTO',
          triggerConfig: {},
          endAt: '2026-07-08T00:00:00.000Z',
        } as any,
        'admin-1',
      ),
    ).rejects.toThrow('自动发放活动必须选择发放对象');
  });

  it('allows auto holiday campaigns when an automatic audience is configured', async () => {
    const { service, prisma } = makeService();

    await service.createCampaign(
      {
        ...baseCreateDto,
        name: '自动节日红包',
        triggerType: 'HOLIDAY',
        distributionMode: 'AUTO',
        triggerConfig: { autoTargetMode: 'ALL_USERS' },
        endAt: '2026-07-08T00:00:00.000Z',
      } as any,
      'admin-1',
    );

    expect(prisma.couponCampaign.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerType: 'HOLIDAY',
          distributionMode: 'AUTO',
          triggerConfig: { autoTargetMode: 'ALL_USERS' },
        }),
      }),
    );
  });

  it('rejects unsupported check-in campaign creation', async () => {
    const { service } = makeService();

    await expect(
      service.createCampaign(
        {
          ...baseCreateDto,
          name: '签到红包',
          triggerType: 'CHECK_IN',
          distributionMode: 'AUTO',
          endAt: null,
          triggerConfig: { requiredDays: 7 },
        } as any,
        'admin-1',
      ),
    ).rejects.toThrow('签到红包暂未开放创建');
  });

  it('rejects fixed discount campaigns whose minimum order is lower than discount amount', async () => {
    const { service } = makeService();

    await expect(
      service.createCampaign(
        {
          ...baseCreateDto,
          discountType: 'FIXED',
          discountValue: 10,
          minOrderAmount: 5,
          endAt: null,
        } as any,
        'admin-1',
      ),
    ).rejects.toThrow('最低消费门槛不能低于抵扣金额');
  });

  it('rejects fixed discount campaign updates whose minimum order is lower than discount amount', async () => {
    const { service, prisma } = makeService();
    prisma.couponCampaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'DRAFT',
      triggerType: 'REGISTER',
      distributionMode: 'AUTO',
      triggerConfig: null,
      discountType: 'FIXED',
      discountValue: 8,
      minOrderAmount: 8,
      validDays: 7,
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: null,
    });

    await expect(
      service.updateCampaign('campaign-1', { discountValue: 20, minOrderAmount: 10 } as any),
    ).rejects.toThrow('最低消费门槛不能低于抵扣金额');
  });

  it('rejects changing growth exchange purpose while a campaign is active', async () => {
    const { service, prisma } = makeService();
    prisma.couponCampaign.findUnique.mockResolvedValue({
      id: 'campaign-1',
      status: 'ACTIVE',
      triggerType: 'MANUAL',
      distributionMode: 'MANUAL',
      triggerConfig: null,
      discountType: 'FIXED',
      discountValue: 8,
      minOrderAmount: 8,
      issuedCount: 0,
      totalQuota: 100,
      growthExchangeEnabled: false,
      validDays: 7,
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: null,
    });

    await expect(
      service.updateCampaign('campaign-1', { growthExchangeEnabled: true } as any),
    ).rejects.toThrow('活动进行中不允许修改 growthExchangeEnabled，请先暂停活动');
    expect(prisma.couponCampaign.update).not.toHaveBeenCalled();
  });
});

describe('CouponService admin campaign list lifecycle', () => {
  const activeOpenCampaign = {
    id: 'open-1',
    name: '仍可发放活动',
    status: 'ACTIVE',
    triggerType: 'MANUAL',
    distributionMode: 'MANUAL',
    discountType: 'FIXED',
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: 10,
    totalQuota: 2,
    issuedCount: 0,
    maxPerUser: 1,
    validDays: 7,
    startAt: new Date('2026-07-01T00:00:00.000Z'),
    endAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };

  const makeService = () => {
    const prisma = {
      couponCampaign: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    return {
      prisma,
      service: new CouponService(prisma as any, {} as any),
    };
  };

  it('ends sold-out active campaigns before listing the active tab', async () => {
    const { service, prisma } = makeService();
    prisma.couponCampaign.findMany
      .mockResolvedValueOnce([
        { id: 'sold-out-1', issuedCount: 1, totalQuota: 1 },
        { id: 'still-open', issuedCount: 1, totalQuota: 2 },
      ])
      .mockResolvedValueOnce([activeOpenCampaign]);

    const result = await service.getCampaigns({ status: 'ACTIVE' });

    expect(prisma.couponCampaign.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['sold-out-1'] },
        status: 'ACTIVE',
      },
      data: { status: 'ENDED' },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('open-1');
  });
});

describe('CouponService claim eligibility rules', () => {
  const activeClaimCampaign = {
    id: 'campaign-1',
    name: '累计消费领取红包',
    status: 'ACTIVE',
    issuedCount: 0,
    totalQuota: 10,
    maxPerUser: 1,
    validDays: 7,
    distributionMode: 'CLAIM',
    triggerType: 'CUMULATIVE_SPEND',
    triggerConfig: { spendThreshold: 500 },
    startAt: new Date('2026-01-01T00:00:00.000Z'),
    endAt: null,
    discountType: 'FIXED',
    discountValue: 8,
    maxDiscountAmount: null,
    minOrderAmount: 8,
  };

  const makeClaimService = (campaign = activeClaimCampaign, totalSpent = 100) => {
    const tx = {
      couponCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      couponInstance: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({
          id: 'coupon-1',
          discountType: campaign.discountType,
          discountValue: campaign.discountValue,
          maxDiscountAmount: campaign.maxDiscountAmount,
          minOrderAmount: campaign.minOrderAmount,
          expiresAt: new Date('2026-07-09T00:00:00.000Z'),
        }),
      },
      order: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: totalSpent } }),
        findFirst: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    return {
      tx,
      prisma,
      service: new CouponService(prisma as any, {} as any),
    };
  };

  it('rejects user claim when cumulative spend threshold is not met', async () => {
    const { service, tx } = makeClaimService(activeClaimCampaign, 100);

    await expect(
      (service as any)._claimCouponTx('buyer-1', 'campaign-1'),
    ).rejects.toThrow('未达到累计消费门槛');

    expect(tx.couponCampaign.updateMany).not.toHaveBeenCalled();
    expect(tx.couponInstance.create).not.toHaveBeenCalled();
  });

  it('ends a claim campaign when the final coupon is claimed', async () => {
    const finalCouponCampaign = {
      ...activeClaimCampaign,
      issuedCount: 9,
      totalQuota: 10,
    };
    const { service, tx } = makeClaimService(finalCouponCampaign, 1000);

    await (service as any)._claimCouponTx('buyer-1', 'campaign-1');

    expect(tx.couponCampaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'campaign-1',
          issuedCount: 9,
        }),
        data: expect.objectContaining({
          issuedCount: { increment: 1 },
          status: 'ENDED',
        }),
      }),
    );
  });
});

describe('CouponService claimable coupon alerts', () => {
  const claimCampaign = {
    id: 'claim-1',
    name: '节日领取红包',
    description: null,
    status: 'ACTIVE',
    issuedCount: 0,
    totalQuota: 10,
    maxPerUser: 1,
    validDays: 7,
    distributionMode: 'CLAIM',
    triggerType: 'HOLIDAY',
    triggerConfig: null,
    startAt: new Date('2026-07-01T00:00:00.000Z'),
    endAt: null,
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    discountType: 'FIXED',
    discountValue: 8,
    maxDiscountAmount: null,
    minOrderAmount: 8,
  };

  const makeAlertService = (
    lastSeenAt: Date | null = null,
    campaigns = [claimCampaign],
  ) => {
    const prisma = {
      couponCampaign: {
        findMany: jest.fn().mockImplementation(({ where } = {}) => {
          let rows = [...campaigns];
          if (where?.status) {
            rows = rows.filter((campaign) => campaign.status === where.status);
          }
          if (where?.distributionMode) {
            rows = rows.filter((campaign) => campaign.distributionMode === where.distributionMode);
          }
          if (where?.startAt?.lte) {
            rows = rows.filter((campaign) => campaign.startAt <= where.startAt.lte);
          }
          if (where?.OR) {
            const endAtFilter = where.OR.find((entry: any) => entry.endAt?.gte);
            const now = endAtFilter?.endAt?.gte;
            rows = rows.filter((campaign) => campaign.endAt === null || !now || campaign.endAt >= now);
          }
          rows.sort((a, b) => {
            const createdDelta = b.createdAt.getTime() - a.createdAt.getTime();
            if (createdDelta !== 0) return createdDelta;
            return a.id.localeCompare(b.id);
          });
          return Promise.resolve(rows);
        }),
      },
      couponInstance: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      couponClaimableSeenState: {
        findUnique: jest.fn().mockResolvedValue(lastSeenAt ? { userId: 'buyer-1', lastSeenAt } : null),
        upsert: jest.fn().mockResolvedValue({ userId: 'buyer-1', lastSeenAt: new Date() }),
      },
      order: {
        aggregate: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    const notificationService = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    return {
      prisma,
      notificationService,
      service: new (CouponService as any)(prisma, {}, notificationService),
    };
  };

  it('returns new claimable coupon count and emits an inbox notification', async () => {
    const { service, notificationService } = makeAlertService();

    const result = await service.getClaimableAlert('buyer-1');

    expect(result).toEqual({
      count: 1,
      campaignIds: ['claim-1'],
    });
    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'coupon.claimableAvailable',
        aggregateType: 'couponCampaign',
        aggregateId: 'claim-1',
        idempotencyKey: expect.stringContaining('coupon-claimable:buyer-1:'),
        payload: expect.objectContaining({
          userId: 'buyer-1',
          campaignIds: ['claim-1'],
          count: 1,
        }),
      }),
    );
  });

  it('treats future-start campaigns as new when they become claimable after last seen', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
    try {
      const futureStartCampaign = {
        ...claimCampaign,
        id: 'claim-future',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        startAt: new Date('2026-07-05T00:00:00.000Z'),
      };
      const { service, notificationService, prisma } = makeAlertService(
        new Date('2026-07-02T00:00:00.000Z'),
        [futureStartCampaign],
      );

      const result = await service.getClaimableAlert('buyer-1');

      expect(prisma.couponCampaign.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        }),
      );
      expect(result).toEqual({
        count: 1,
        campaignIds: ['claim-future'],
      });
      expect(notificationService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateId: 'claim-future',
          payload: expect.objectContaining({
            campaignIds: ['claim-future'],
            count: 1,
          }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks claimable coupon alerts as read by updating seen state', async () => {
    const { service, prisma } = makeAlertService(new Date('2026-07-03T00:00:00.000Z'));

    await service.markClaimableAlertRead('buyer-1');
    const result = await service.getClaimableAlert('buyer-1');

    expect(prisma.couponClaimableSeenState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'buyer-1' },
        update: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
        create: expect.objectContaining({ userId: 'buyer-1', lastSeenAt: expect.any(Date) }),
      }),
    );
    expect(result).toEqual({
      count: 0,
      campaignIds: [],
    });
  });
});

describe('CouponService coupon center views', () => {
  const now = new Date('2026-07-10T12:00:00.000Z');
  const baseClaimCampaign = {
    name: '领取活动',
    description: null,
    status: 'ACTIVE',
    issuedCount: 0,
    totalQuota: 10,
    maxPerUser: 1,
    validDays: 7,
    distributionMode: 'CLAIM',
    triggerType: 'HOLIDAY',
    triggerConfig: null,
    startAt: new Date('2026-07-01T00:00:00.000Z'),
    endAt: new Date('2026-07-31T00:00:00.000Z'),
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    discountType: 'FIXED',
    discountValue: 8,
    maxDiscountAmount: null,
    minOrderAmount: 8,
  };

  const campaigns = [
    {
      ...baseClaimCampaign,
      id: 'claim-new',
      name: '新可领活动',
      createdAt: new Date('2026-07-04T00:00:00.000Z'),
    },
    {
      ...baseClaimCampaign,
      id: 'claim-old',
      name: '旧可领活动',
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
    },
    {
      ...baseClaimCampaign,
      id: 'sold-out',
      name: '已领完活动',
      issuedCount: 10,
      totalQuota: 10,
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    },
    {
      ...baseClaimCampaign,
      id: 'claimed-limit',
      name: '已领满活动',
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
    },
    {
      ...baseClaimCampaign,
      id: 'partial-claimed',
      name: '可继续领取活动',
      maxPerUser: 2,
      createdAt: new Date('2026-07-05T00:00:00.000Z'),
    },
    {
      ...baseClaimCampaign,
      id: 'not-eligible',
      name: '暂不满足活动',
      triggerType: 'CUMULATIVE_SPEND',
      triggerConfig: { spendThreshold: 1000 },
      createdAt: new Date('2026-07-07T00:00:00.000Z'),
    },
    {
      ...baseClaimCampaign,
      id: 'paused-claimed',
      name: '已暂停历史活动',
      status: 'PAUSED',
      createdAt: new Date('2026-07-08T00:00:00.000Z'),
    },
    {
      ...baseClaimCampaign,
      id: 'ended-claimed',
      name: '已结束历史活动',
      status: 'ENDED',
      endAt: new Date('2026-07-09T00:00:00.000Z'),
      createdAt: new Date('2026-07-09T00:00:00.000Z'),
    },
    {
      ...baseClaimCampaign,
      id: 'auto-campaign',
      distributionMode: 'AUTO',
    },
    {
      ...baseClaimCampaign,
      id: 'manual-campaign',
      distributionMode: 'MANUAL',
    },
    {
      ...baseClaimCampaign,
      id: 'draft-campaign',
      status: 'DRAFT',
    },
  ];

  const userInstances = [
    {
      id: 'ci-claimed-limit-available',
      campaignId: 'claimed-limit',
      userId: 'buyer-1',
      status: 'AVAILABLE',
      issuedAt: new Date('2026-07-04T10:00:00.000Z'),
      expiresAt: new Date('2026-07-12T00:00:00.000Z'),
    },
    {
      id: 'ci-partial-available',
      campaignId: 'partial-claimed',
      userId: 'buyer-1',
      status: 'AVAILABLE',
      issuedAt: new Date('2026-07-05T10:00:00.000Z'),
      expiresAt: new Date('2026-07-13T00:00:00.000Z'),
    },
    {
      id: 'ci-paused-used',
      campaignId: 'paused-claimed',
      userId: 'buyer-1',
      status: 'USED',
      issuedAt: new Date('2026-07-07T10:00:00.000Z'),
      expiresAt: new Date('2026-07-11T00:00:00.000Z'),
    },
    {
      id: 'ci-ended-expired',
      campaignId: 'ended-claimed',
      userId: 'buyer-1',
      status: 'EXPIRED',
      issuedAt: new Date('2026-07-08T10:00:00.000Z'),
      expiresAt: new Date('2026-07-09T00:00:00.000Z'),
    },
    {
      id: 'ci-summary-reserved',
      campaignId: 'claimed-limit',
      userId: 'buyer-1',
      status: 'RESERVED',
      issuedAt: new Date('2026-07-04T11:00:00.000Z'),
      expiresAt: new Date('2026-07-14T00:00:00.000Z'),
    },
    {
      id: 'ci-summary-used',
      campaignId: 'claimed-limit',
      userId: 'buyer-1',
      status: 'USED',
      issuedAt: new Date('2026-07-04T12:00:00.000Z'),
      expiresAt: new Date('2026-07-15T00:00:00.000Z'),
    },
    {
      id: 'ci-summary-expired',
      campaignId: 'claimed-limit',
      userId: 'buyer-1',
      status: 'EXPIRED',
      issuedAt: new Date('2026-07-04T13:00:00.000Z'),
      expiresAt: new Date('2026-07-09T00:00:00.000Z'),
    },
    {
      id: 'ci-summary-revoked',
      campaignId: 'claimed-limit',
      userId: 'buyer-1',
      status: 'REVOKED',
      issuedAt: new Date('2026-07-04T14:00:00.000Z'),
      expiresAt: new Date('2026-07-16T00:00:00.000Z'),
    },
  ];

  const makeCenterService = () => {
    const findCampaign = (campaignId: string) => campaigns.find((campaign) => campaign.id === campaignId);
    const prisma = {
      couponCampaign: {
        findMany: jest.fn().mockImplementation(({ where } = {}) => {
          let rows = [...campaigns];
          if (where?.distributionMode) {
            rows = rows.filter((campaign) => campaign.distributionMode === where.distributionMode);
          }
          if (where?.status) {
            rows = rows.filter((campaign) => campaign.status === where.status);
          }
          if (where?.startAt?.lte) {
            rows = rows.filter((campaign) => campaign.startAt <= where.startAt.lte);
          }
          if (where?.OR) {
            rows = rows.filter((campaign) => campaign.endAt === null || campaign.endAt >= now);
          }
          if (where?.id?.in) {
            rows = rows.filter((campaign) => where.id.in.includes(campaign.id));
          }
          return Promise.resolve(rows);
        }),
      },
      couponInstance: {
        findMany: jest.fn().mockImplementation(({ where, include, orderBy } = {}) => {
          let rows = [...userInstances];
          if (where?.userId) {
            rows = rows.filter((instance) => instance.userId === where.userId);
          }
          if (where?.campaignId?.in) {
            rows = rows.filter((instance) => where.campaignId.in.includes(instance.campaignId));
          }
          if (where?.campaign) {
            rows = rows.filter((instance) => {
              const campaign = findCampaign(instance.campaignId);
              if (!campaign) return false;
              if (where.campaign.distributionMode && campaign.distributionMode !== where.campaign.distributionMode) {
                return false;
              }
              if (where.campaign.status?.not && campaign.status === where.campaign.status.not) {
                return false;
              }
              return true;
            });
          }
          if (orderBy?.issuedAt === 'desc') {
            rows.sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
          }
          if (include?.campaign) {
            return Promise.resolve(rows.map((instance) => ({
              ...instance,
              campaign: findCampaign(instance.campaignId),
            })));
          }
          return Promise.resolve(rows);
        }),
      },
      order: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 100 } }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    return {
      prisma,
      service: new CouponService(prisma as any, {} as any),
    };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns only currently claimable campaigns in the default claimable view', async () => {
    const { service } = makeCenterService();

    const result = await (service as any).getCouponCenterCampaigns('buyer-1');

    expect(result.map((item: any) => item.id)).toEqual([
      'partial-claimed',
      'claim-new',
      'claim-old',
    ]);
    expect(result.every((item: any) => item.displayStatus === 'CLAIMABLE')).toBe(true);
  });

  it('keeps sold out, claimed, and not eligible campaigns visible in the active view with clear statuses', async () => {
    const { service } = makeCenterService();

    const result = await (service as any).getCouponCenterCampaigns('buyer-1', 'active');

    expect(result.map((item: any) => item.id)).toEqual([
      'partial-claimed',
      'claim-new',
      'claim-old',
      'claimed-limit',
      'not-eligible',
      'sold-out',
    ]);
    expect(result.find((item: any) => item.id === 'sold-out')).toEqual(
      expect.objectContaining({ displayStatus: 'SOLD_OUT', canClaim: false, statusLabel: '已领完' }),
    );
    expect(result.find((item: any) => item.id === 'claimed-limit')).toEqual(
      expect.objectContaining({ displayStatus: 'CLAIMED', canClaim: false, statusLabel: '已领取' }),
    );
    expect(result.find((item: any) => item.id === 'not-eligible')).toEqual(
      expect.objectContaining({
        displayStatus: 'NOT_ELIGIBLE',
        canClaim: false,
        ineligibleReason: '暂不满足累计消费领取条件',
      }),
    );
  });

  it('returns claimed campaign history with status summaries and latest claim ordering', async () => {
    const { service } = makeCenterService();

    const result = await (service as any).getCouponCenterCampaigns('buyer-1', 'claimed');

    expect(result.map((item: any) => item.id)).toEqual([
      'ended-claimed',
      'paused-claimed',
      'partial-claimed',
      'claimed-limit',
    ]);
    expect(result.find((item: any) => item.id === 'ended-claimed')).toEqual(
      expect.objectContaining({ displayStatus: 'ENDED', statusLabel: '已结束' }),
    );
    expect(result.find((item: any) => item.id === 'paused-claimed')).toEqual(
      expect.objectContaining({ displayStatus: 'CLAIMED', statusLabel: '已领取' }),
    );
    expect(result.find((item: any) => item.id === 'claimed-limit')?.claimedSummary).toEqual({
      total: 5,
      available: 1,
      reserved: 1,
      used: 1,
      expired: 1,
      revoked: 1,
      nearestExpiresAt: '2026-07-12T00:00:00.000Z',
    });
  });

  it('rejects invalid coupon center views', async () => {
    const { service } = makeCenterService();

    await expect(
      (service as any).getCouponCenterCampaigns('buyer-1', 'unknown'),
    ).rejects.toThrow('领券中心分类无效');
  });
});

describe('CouponService manual issue rules', () => {
  const activeManualCampaign = {
    id: 'campaign-1',
    status: 'ACTIVE',
    issuedCount: 0,
    totalQuota: 10,
    maxPerUser: 1,
    validDays: 7,
    distributionMode: 'MANUAL',
    startAt: new Date('2026-01-01T00:00:00.000Z'),
    endAt: null,
    discountType: 'FIXED',
    discountValue: 8,
    maxDiscountAmount: null,
    minOrderAmount: 8,
  };

  const makeManualIssueService = (campaign = activeManualCampaign) => {
    const tx = {
      couponCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      couponManualIssueJob: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: 'job-1',
          scheduledAt: data.scheduledAt,
        })),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'buyer-1' }, { id: 'buyer-2' }]),
      },
      couponInstance: {
        groupBy: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        createManyAndReturn: jest.fn().mockResolvedValue([
          { id: 'coupon-1', userId: 'buyer-1' },
          { id: 'coupon-2', userId: 'buyer-2' },
        ]),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const notificationService = {
      emit: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };
    return {
      tx,
      prisma,
      notificationService,
      service: new CouponService(prisma as any, {} as any, notificationService as any),
    };
  };

  it('issues to all active buyer users from the backend when requested', async () => {
    const { service, tx } = makeManualIssueService();

    const result = await service.manualIssue(
      'campaign-1',
      { targetMode: 'ALL_USERS' } as any,
      'admin-1',
    );

    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', buyerNo: { not: null } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(tx.couponInstance.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ userId: 'buyer-1', expiresAt: expect.any(Date) }),
          expect.objectContaining({ userId: 'buyer-2', expiresAt: expect.any(Date) }),
        ],
        select: { id: true, userId: true },
      }),
    );
    expect(result).toEqual({ issued: 2, skipped: 0, skippedUsers: [] });
  });

  it('emits granted notifications for users who receive manually issued coupons', async () => {
    const { service, notificationService, tx } = makeManualIssueService();

    await service.manualIssue(
      'campaign-1',
      { targetMode: 'ALL_USERS' } as any,
      'admin-1',
    );

    expect(notificationService.emit).toHaveBeenCalledTimes(2);
    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'coupon.granted',
        aggregateType: 'couponInstance',
        aggregateId: 'coupon-1',
        idempotencyKey: 'coupon:coupon-1:granted',
        payload: expect.objectContaining({
          couponInstanceId: 'coupon-1',
          userId: 'buyer-1',
          amount: 8,
        }),
      }),
      tx,
    );
    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: 'coupon-2',
        payload: expect.objectContaining({
          couponInstanceId: 'coupon-2',
          userId: 'buyer-2',
        }),
      }),
      tx,
    );
  });

  it('ends a manual campaign when manual issue fills the quota', async () => {
    const { service, tx } = makeManualIssueService({
      ...activeManualCampaign,
      issuedCount: 8,
      totalQuota: 10,
    });

    await service.manualIssue(
      'campaign-1',
      { targetMode: 'ALL_USERS' } as any,
      'admin-1',
    );

    expect(tx.couponCampaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'campaign-1',
          issuedCount: 8,
        }),
        data: expect.objectContaining({
          issuedCount: { increment: 2 },
          status: 'ENDED',
        }),
      }),
    );
  });

  it('issues immediately to active VIP buyer users when requested', async () => {
    const { service, tx } = makeManualIssueService();

    await service.manualIssue(
      'campaign-1',
      { targetMode: 'VIP_USERS' } as any,
      'admin-1',
    );

    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        buyerNo: { not: null },
        memberProfile: { is: { tier: 'VIP' } },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('issues immediately to active normal buyer users when requested', async () => {
    const { service, tx } = makeManualIssueService();

    await service.manualIssue(
      'campaign-1',
      { targetMode: 'NORMAL_USERS' } as any,
      'admin-1',
    );

    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        buyerNo: { not: null },
        OR: [
          { memberProfile: { is: null } },
          { memberProfile: { is: { tier: 'NORMAL' } } },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('schedules manual issue without creating coupon instances immediately', async () => {
    const { service, tx } = makeManualIssueService();
    const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const result = await service.manualIssue(
      'campaign-1',
      {
        targetMode: 'VIP_USERS',
        scheduleMode: 'SCHEDULED',
        scheduledAt,
      } as any,
      'admin-1',
    );

    expect(tx.couponManualIssueJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'campaign-1',
        targetMode: 'VIP_USERS',
        userIds: [],
        scheduledAt: new Date(scheduledAt),
        status: 'PENDING',
        createdBy: 'admin-1',
      }),
    });
    expect(tx.couponInstance.createMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      scheduled: true,
      jobId: 'job-1',
      scheduledAt,
    });
  });

  it('rejects scheduled manual issue when scheduledAt is not in the future', async () => {
    const { service } = makeManualIssueService();

    await expect(
      service.manualIssue(
        'campaign-1',
        {
          targetMode: 'ALL_USERS',
          scheduleMode: 'SCHEDULED',
          scheduledAt: '2020-01-01T00:00:00.000Z',
        } as any,
        'admin-1',
      ),
    ).rejects.toThrow('定时发放时间必须晚于当前时间');
  });

  it('does not allow manual issuing from draft campaigns', async () => {
    const { service } = makeManualIssueService({
      ...activeManualCampaign,
      status: 'DRAFT',
    });

    await expect(
      service.manualIssue('campaign-1', { targetMode: 'ALL_USERS' } as any, 'admin-1'),
    ).rejects.toThrow('只有进行中的活动可以手动发放');
  });

  it('does not allow manual issuing from non-manual campaigns', async () => {
    const { service } = makeManualIssueService({
      ...activeManualCampaign,
      distributionMode: 'AUTO',
    });

    await expect(
      service.manualIssue('campaign-1', { targetMode: 'ALL_USERS' } as any, 'admin-1'),
    ).rejects.toThrow('只有手动发放类型活动可以手动发放');
  });

  it('does not block manual issuing by campaign start time', async () => {
    const { service } = makeManualIssueService({
      ...activeManualCampaign,
      startAt: new Date(Date.now() + 86_400_000),
      endAt: null,
    });

    await expect(
      service.manualIssue('campaign-1', { targetMode: 'ALL_USERS' } as any, 'admin-1'),
    ).resolves.toEqual({ issued: 2, skipped: 0, skippedUsers: [] });
  });
});

describe('CouponEngineService nullable activity end time', () => {
  it('treats null endAt as an evergreen active campaign when issuing', async () => {
    const campaign = {
      id: 'campaign-1',
      name: '长期新人红包',
      status: 'ACTIVE',
      startAt: new Date('2026-01-01T00:00:00.000Z'),
      endAt: null,
      issuedCount: 0,
      totalQuota: 10,
      maxPerUser: 1,
      validDays: 7,
      discountType: 'FIXED',
      discountValue: 10,
      maxDiscountAmount: null,
      minOrderAmount: 0,
    };
    const tx = {
      couponCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      couponInstance: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'coupon-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const notificationService = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new CouponEngineService(prisma as any, notificationService as any);

    await expect((service as any).issueSingle('campaign-1', 'buyer-1')).resolves.toBe(true);

    expect(tx.couponInstance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ campaignId: 'campaign-1', userId: 'buyer-1' }),
      }),
    );
  });
});
