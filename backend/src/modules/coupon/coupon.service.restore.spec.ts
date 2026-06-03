import { CouponService } from './coupon.service';

describe('CouponService.restoreCouponsForOrder', () => {
  const makeService = () => new CouponService({} as any, {} as any);

  it('订单取消时将未过期 USED 红包恢复为 AVAILABLE 并清理使用快照', async () => {
    const service = makeService();
    const tx = {
      couponUsageRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            couponInstanceId: 'ci1',
            couponInstance: {
              id: 'ci1',
              status: 'USED',
              expiresAt: new Date(Date.now() + 86_400_000),
            },
          },
        ]),
        deleteMany: jest.fn(),
      },
      couponInstance: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await service.restoreCouponsForOrder('o1', tx as any);

    expect(tx.couponInstance.updateMany).toHaveBeenCalledWith({
      where: { id: 'ci1', status: 'USED' },
      data: {
        status: 'AVAILABLE',
        usedAt: null,
        usedOrderId: null,
        usedAmount: null,
      },
    });
    expect(tx.couponUsageRecord.deleteMany).toHaveBeenCalledWith({ where: { orderId: 'o1' } });
  });

  it('订单取消时将已过期 USED 红包恢复为 EXPIRED', async () => {
    const service = makeService();
    const tx = {
      couponUsageRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            couponInstanceId: 'ci1',
            couponInstance: {
              id: 'ci1',
              status: 'USED',
              expiresAt: new Date(Date.now() - 86_400_000),
            },
          },
        ]),
        deleteMany: jest.fn(),
      },
      couponInstance: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await service.restoreCouponsForOrder('o1', tx as any);

    expect(tx.couponInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'EXPIRED' }),
      }),
    );
  });
});
