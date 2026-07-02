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
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'buyer-1' }, { id: 'buyer-2' }]),
      },
      couponInstance: {
        groupBy: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
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
    expect(tx.couponInstance.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ userId: 'buyer-1', expiresAt: expect.any(Date) }),
          expect.objectContaining({ userId: 'buyer-2', expiresAt: expect.any(Date) }),
        ],
      }),
    );
    expect(result).toEqual({ issued: 2, skipped: 0, skippedUsers: [] });
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

  it('does not allow manual issuing outside the campaign time window', async () => {
    const { service } = makeManualIssueService({
      ...activeManualCampaign,
      startAt: new Date(Date.now() + 86_400_000),
      endAt: null,
    });

    await expect(
      service.manualIssue('campaign-1', { targetMode: 'ALL_USERS' } as any, 'admin-1'),
    ).rejects.toThrow('该活动不在有效期内');
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
