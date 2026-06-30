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
      couponInstance: {
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
});
