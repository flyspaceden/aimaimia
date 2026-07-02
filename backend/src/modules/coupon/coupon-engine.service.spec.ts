import { CouponEngineService } from './coupon-engine.service';

describe('CouponEngineService notifications', () => {
  const campaign = {
    id: 'campaign-1',
    name: '新人红包',
    status: 'ACTIVE',
    startAt: new Date('2026-01-01T00:00:00.000Z'),
    endAt: new Date('2026-12-31T00:00:00.000Z'),
    issuedCount: 0,
    totalQuota: 10,
    maxPerUser: 1,
    validDays: 7,
    discountType: 'FIXED',
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: 0,
  };

  const makeService = () => {
    const tx = {
      couponCampaign: {
        findUnique: jest.fn().mockResolvedValue(campaign),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      couponInstance: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'coupon-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      couponCampaign: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      couponInstance: {
        findMany: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const notificationService = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    return {
      tx,
      prisma,
      notificationService,
      service: new CouponEngineService(prisma as any, notificationService as any),
    };
  };

  it('emits coupon granted notification inside the issue transaction', async () => {
    const { service, tx, notificationService } = makeService();

    await expect((service as any).issueSingle('campaign-1', 'buyer-1')).resolves.toBe(true);

    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'coupon.granted',
        aggregateType: 'couponInstance',
        aggregateId: 'coupon-1',
        idempotencyKey: 'coupon:coupon-1:granted',
        payload: expect.objectContaining({ couponInstanceId: 'coupon-1', userId: 'buyer-1' }),
      }),
      tx,
    );
  });

  it('expires coupons and emits per-instance notifications inside one transaction', async () => {
    const { service, prisma, tx, notificationService } = makeService();
    prisma.couponInstance.findMany.mockResolvedValueOnce([
      { id: 'coupon-1', userId: 'buyer-1' },
      { id: 'coupon-2', userId: 'buyer-2' },
    ]);

    await service.expireCoupons();

    expect(tx.couponInstance.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['coupon-1', 'coupon-2'] }, status: 'AVAILABLE' },
      data: { status: 'EXPIRED' },
    });
    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'coupon.expired',
        aggregateId: 'coupon-1',
        idempotencyKey: 'coupon:coupon-1:expired',
        payload: { couponInstanceId: 'coupon-1', userId: 'buyer-1' },
      }),
      tx,
    );
    expect(notificationService.emit).toHaveBeenCalledTimes(2);
  });

  it('automatically issues holiday and flash coupons to configured audiences', async () => {
    const { service, prisma } = makeService();
    prisma.couponCampaign.findMany.mockResolvedValueOnce([
      {
        ...campaign,
        id: 'holiday-1',
        triggerType: 'HOLIDAY',
        distributionMode: 'AUTO',
        triggerConfig: { autoTargetMode: 'NORMAL_USERS' },
      },
    ]);
    prisma.couponCampaign.findUnique
      .mockResolvedValueOnce({ issuedCount: 0, totalQuota: 10, status: 'ACTIVE' })
      .mockResolvedValueOnce({ issuedCount: 10, totalQuota: 10, status: 'ACTIVE' });
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'buyer-1' }, { id: 'buyer-2' }]);
    const issueWithRetry = jest
      .spyOn(service as any, 'issueWithRetry')
      .mockResolvedValue(true);

    await (service as any).handleAudienceAutoCoupons();

    expect(prisma.couponCampaign.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        triggerType: { in: ['HOLIDAY', 'FLASH'] },
        distributionMode: 'AUTO',
        status: 'ACTIVE',
      }),
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          buyerNo: { not: null },
          couponInstances: { none: { campaignId: 'holiday-1' } },
          OR: [
            { memberProfile: { is: null } },
            { memberProfile: { is: { tier: 'NORMAL' } } },
          ],
        }),
      }),
    );
    expect(issueWithRetry).toHaveBeenCalledWith('holiday-1', 'buyer-1');
    expect(issueWithRetry).toHaveBeenCalledWith('holiday-1', 'buyer-2');
  });
});
