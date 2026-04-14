import { VipActivationRetryService } from './vip-activation-retry.service';

describe('VipActivationRetryService — 卡死激活状态接管', () => {
  it('应先把过期的 RETRYING 记录回退为 FAILED，再发起自动重试', async () => {
    const stalePurchase = {
      id: 'vip-1',
      userId: 'user-1',
      orderId: 'order-1',
      giftOptionId: 'gift-1',
      amount: 399,
      giftSnapshot: { title: 'VIP 礼包' },
      packageId: 'package-1',
      referralBonusRate: 0.2,
      activationStatus: 'RETRYING',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    };

    const prisma = {
      vipPurchase: {
        findMany: jest.fn().mockResolvedValue([stalePurchase]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const bonusService = {
      activateVipAfterPayment: jest.fn().mockResolvedValue(undefined),
    };

    const service = new VipActivationRetryService(
      prisma as any,
      bonusService as any,
    );

    await service.retryFailedActivations();

    expect(prisma.vipPurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: stalePurchase.id,
        activationStatus: stalePurchase.activationStatus,
      },
      data: {
        activationStatus: 'FAILED',
        activationError: 'Recovered stale activation lease',
      },
    });
    expect(bonusService.activateVipAfterPayment).toHaveBeenCalledWith(
      stalePurchase.userId,
      stalePurchase.orderId,
      stalePurchase.giftOptionId,
      stalePurchase.amount,
      stalePurchase.giftSnapshot,
      stalePurchase.packageId,
      stalePurchase.referralBonusRate,
    );
  });
});
