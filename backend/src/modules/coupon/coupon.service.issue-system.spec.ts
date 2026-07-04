import { BadRequestException } from '@nestjs/common';
import { CouponService } from './coupon.service';

const activeCampaign = (overrides: Record<string, unknown> = {}) => ({
  id: 'campaign-1',
  name: '积分兑换红包',
  status: 'ACTIVE',
  distributionMode: 'MANUAL',
  discountType: 'FIXED',
  discountValue: 5,
  maxDiscountAmount: null,
  minOrderAmount: 20,
  issuedCount: 3,
  totalQuota: 100,
  maxPerUser: 2,
  validDays: 7,
  startAt: new Date('2026-07-01T00:00:00.000Z'),
  endAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

const makeHarness = (options: {
  campaign?: any;
  userCount?: number;
  updateCount?: number;
} = {}) => {
  const tx: any = {
    couponCampaign: {
      findUnique: jest.fn().mockResolvedValue(options.campaign ?? activeCampaign()),
      updateMany: jest.fn().mockResolvedValue({ count: options.updateCount ?? 1 }),
    },
    couponInstance: {
      count: jest.fn().mockResolvedValue(options.userCount ?? 0),
      create: jest.fn(({ data }: any) => ({
        id: 'coupon-instance-1',
        ...data,
      })),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((callback: any, transactionOptions: any) =>
      callback(tx).then((result: any) => ({ result, transactionOptions })),
    ),
  };

  return {
    tx,
    prisma,
    service: new CouponService(prisma, {} as any),
  };
};

describe('CouponService.issueSystemCoupon', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('issues an active non-claim coupon campaign inside a Serializable transaction', async () => {
    const { service, tx, prisma } = makeHarness();

    const { result, transactionOptions } = await service.issueSystemCoupon({
      userId: 'user-1',
      campaignId: 'campaign-1',
      source: { type: 'GROWTH_EXCHANGE', id: 'exchange-1' },
    }) as any;

    expect(transactionOptions).toMatchObject({ isolationLevel: 'Serializable' });
    expect(tx.couponCampaign.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'campaign-1',
        issuedCount: 3,
      },
      data: {
        issuedCount: { increment: 1 },
      },
    });
    expect(tx.couponInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: 'campaign-1',
        userId: 'user-1',
        status: 'AVAILABLE',
        discountType: 'FIXED',
        discountValue: 5,
        minOrderAmount: 20,
        issuedAt: new Date('2026-07-03T00:00:00.000Z'),
      }),
    });
    expect(result).toMatchObject({
      id: 'coupon-instance-1',
      campaignName: '积分兑换红包',
      discountType: 'FIXED',
      discountValue: 5,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects claim-only campaigns for system issuing', async () => {
    const { service } = makeHarness({
      campaign: activeCampaign({ distributionMode: 'CLAIM' }),
    });

    await expect(
      service.issueSystemCoupon({
        userId: 'user-1',
        campaignId: 'campaign-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
