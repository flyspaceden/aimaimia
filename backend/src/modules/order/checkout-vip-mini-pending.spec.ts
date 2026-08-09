import { CheckoutService } from './checkout.service';
import { OrderController } from './order.controller';

describe('CheckoutService.getPendingVipForMiniProgram', () => {
  it('returns only the current user active WeChat MINI_PROGRAM VIP session', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const findFirst = jest.fn().mockResolvedValue({
      id: 'vip-session-1',
      merchantOrderNo: 'VIP-MINI-1',
      expectedTotal: 399,
      expiresAt,
      bizType: 'VIP_PACKAGE',
      paymentScene: 'MINI_PROGRAM',
    });
    const service = new CheckoutService({ checkoutSession: { findFirst } } as any, {} as any);

    await expect(service.getPendingVipForMiniProgram('user-1')).resolves.toEqual({
      sessionId: 'vip-session-1',
      merchantOrderNo: 'VIP-MINI-1',
      expectedTotal: 399,
      expiresAt: expiresAt.toISOString(),
      bizType: 'VIP_PACKAGE',
      paymentScene: 'MINI_PROGRAM',
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: 'ACTIVE',
        expiresAt: { gt: expect.any(Date) },
        bizType: 'VIP_PACKAGE',
        paymentScene: 'MINI_PROGRAM',
        paymentChannel: 'WECHAT_PAY',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        merchantOrderNo: true,
        expectedTotal: true,
        expiresAt: true,
        bizType: true,
        paymentScene: true,
      },
    });
  });

  it('does not invent a recoverable session when no matching mini-program VIP checkout exists', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new CheckoutService({ checkoutSession: { findFirst } } as any, {} as any);

    await expect(service.getPendingVipForMiniProgram('user-1')).resolves.toBeNull();
  });

  it('takes ownership only from the authenticated user in the controller', async () => {
    const checkoutService = {
      getPendingVipForMiniProgram: jest.fn().mockResolvedValue(null),
    };
    const controller = new OrderController(
      {} as any,
      checkoutService as any,
      {} as any,
      {} as any,
    );

    await expect(controller.getMyPendingVipCheckoutForMiniProgram('jwt-user-1')).resolves.toBeNull();
    expect(checkoutService.getPendingVipForMiniProgram).toHaveBeenCalledWith('jwt-user-1');
  });
});
