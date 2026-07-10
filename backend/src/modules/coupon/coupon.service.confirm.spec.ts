import { CouponService } from './coupon.service';

describe('CouponService.confirmCouponUsage', () => {
  it('uses positive coupons and releases zero-value coupons without usage records', async () => {
    const tx = {
      couponInstance: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      couponUsageRecord: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const service = new CouponService(prisma as any, {} as any);

    await service.confirmCouponUsage(
      ['coupon-positive', 'coupon-zero'],
      'order-1',
      [
        { couponInstanceId: 'coupon-positive', discountAmount: 12.5 },
        { couponInstanceId: 'coupon-zero', discountAmount: 0 },
      ],
    );

    expect(tx.couponInstance.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'coupon-positive', status: 'RESERVED' },
      data: {
        status: 'USED',
        usedAt: expect.any(Date),
        usedOrderId: 'order-1',
        usedAmount: 12.5,
      },
    });
    expect(tx.couponInstance.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'coupon-zero', status: 'RESERVED' },
      data: {
        status: 'AVAILABLE',
        usedAt: null,
        usedOrderId: null,
        usedAmount: null,
      },
    });
    expect(tx.couponUsageRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.couponUsageRecord.create).toHaveBeenCalledWith({
      data: {
        couponInstanceId: 'coupon-positive',
        orderId: 'order-1',
        discountAmount: 12.5,
      },
    });
  });
});
