import { GrowthCouponAdapterService } from './growth-coupon-adapter.service';

describe('GrowthCouponAdapterService', () => {
  it('delegates exchange coupon issuing to CouponService without creating coupons directly', async () => {
    const couponService = {
      issueSystemCoupon: jest.fn().mockResolvedValue({ id: 'coupon-instance-1' }),
    };
    const service = new GrowthCouponAdapterService(couponService as any);
    const tx = { marker: 'transaction-client' } as any;

    await expect(
      service.issueExchangeCoupon({
        userId: 'user-1',
        campaignId: 'campaign-1',
        tx,
        source: { type: 'GROWTH_EXCHANGE', id: 'exchange-1' },
      }),
    ).resolves.toEqual({ id: 'coupon-instance-1' });

    expect(couponService.issueSystemCoupon).toHaveBeenCalledWith({
      userId: 'user-1',
      campaignId: 'campaign-1',
      tx,
      source: { type: 'GROWTH_EXCHANGE', id: 'exchange-1' },
    });
  });

  it('propagates issuing failures so the caller transaction can roll back', async () => {
    const couponService = {
      issueSystemCoupon: jest.fn().mockRejectedValue(new Error('quota exhausted')),
    };
    const service = new GrowthCouponAdapterService(couponService as any);

    await expect(
      service.issueExchangeCoupon({
        userId: 'user-1',
        campaignId: 'campaign-1',
        source: { type: 'GROWTH_EXCHANGE', id: 'exchange-1' },
      }),
    ).rejects.toThrow('quota exhausted');
  });
});
