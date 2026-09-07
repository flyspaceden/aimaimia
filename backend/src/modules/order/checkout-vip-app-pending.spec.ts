import { CheckoutService } from './checkout.service';
import { OrderController } from './order.controller';

describe('App VIP pending isolation', () => {
  it.each(['ALIPAY', 'WECHAT_PAY'])('returns current-user APP VIP summary for %s without credentials', async (paymentChannel) => {
    const expiresAt = new Date(Date.now() + 60000);
    const findFirst = jest.fn().mockResolvedValue({
      id: 'vip-1', expectedTotal: 399, goodsAmount: 399, shippingFee: 0, expiresAt,
      bizType: 'VIP_PACKAGE', paymentScene: 'APP', paymentChannel, fulfillmentMode: 'PICKUP',
      itemsSnapshot: [], paymentParams: { secret: 'never-return' },
    });
    const service = new CheckoutService({ checkoutSession: { findFirst } } as any, {} as any);
    const result = await service.getPendingVipForApp('buyer-1');
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'buyer-1', status: 'ACTIVE', expiresAt: { gt: expect.any(Date) },
        bizType: 'VIP_PACKAGE', paymentScene: 'APP' }, orderBy: { createdAt: 'desc' },
    });
    expect(result).toMatchObject({ sessionId: 'vip-1', paymentChannel,
      paymentScene: 'APP', canResumeInCurrentScene: true, fulfillmentMode: 'PICKUP', expiresAt: expiresAt.toISOString() });
    expect(result).not.toHaveProperty('paymentParams');
  });
  it('returns null when no eligible session exists', async () => {
    const service = new CheckoutService({ checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) } } as any, {} as any);
    expect(await service.getPendingVipForApp('buyer-1')).toBeNull();
  });
  it('uses authenticated identity', async () => {
    const service = { getPendingVipForApp: jest.fn().mockResolvedValue(null) };
    const controller = new OrderController({} as any, service as any, {} as any, {} as any, {} as any);
    await controller.getMyPendingVipCheckout('jwt-user');
    expect(service.getPendingVipForApp).toHaveBeenCalledWith('jwt-user');
  });
});
