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
      order: { findMany: jest.fn().mockResolvedValue([]) },
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

describe('VIP activation crash-window discovery', () => {
  const missingOrder = { id: 'o', userId: 'u', checkoutSession: { bizType: 'VIP_PACKAGE', bizMeta: { vipGiftOptionId: 'g', snapshotPrice: 399, vipPackageId: 'p' }, itemsSnapshot: [{ skuId: 'sku', title: 'gift', unitPrice: 5, quantity: 1 }] } };
  it('recovers a paid order missing its purchase, and subsequent scan grants nothing twice', async () => {
    let recovered = false;
    const prisma = { vipPurchase: { findMany: jest.fn().mockResolvedValue([]) }, order: { findMany: jest.fn(async () => recovered ? [] : [missingOrder]) } };
    const bonus = { activateVipAfterPayment: jest.fn(async () => { recovered = true; }) };
    const service = new VipActivationRetryService(prisma as any, bonus as any);
    await service.retryFailedActivations();
    await service.retryFailedActivations();
    expect(bonus.activateVipAfterPayment).toHaveBeenCalledTimes(1);
    expect(bonus.activateVipAfterPayment).toHaveBeenCalledWith('u', 'o', 'g', 399, expect.objectContaining({ items: [expect.objectContaining({ skuId: 'sku' })] }), 'p', undefined);
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] }, refunds: { none: {} }, vipPurchase: { is: null },
      checkoutSession: { is: { status: { in: ['PAID', 'COMPLETED'] }, paidAt: { not: null } } },
    }) }));
  });
  it('includes stale PENDING and resumes it through existing activation CAS', async () => {
    const prisma = { vipPurchase: { findMany: jest.fn().mockResolvedValue([{ id: 'vp', userId: 'u', orderId: 'o', giftOptionId: 'g', amount: 399, activationStatus: 'PENDING' }]), updateMany: jest.fn() }, order: { findMany: jest.fn().mockResolvedValue([]) } };
    const bonus = { activateVipAfterPayment: jest.fn().mockResolvedValue(undefined) };
    await new VipActivationRetryService(prisma as any, bonus as any).retryFailedActivations();
    expect(prisma.vipPurchase.findMany.mock.calls[0][0].where.OR[1].activationStatus.in).toContain('PENDING');
    expect(prisma.vipPurchase.updateMany).not.toHaveBeenCalled();
    expect(bonus.activateVipAfterPayment).toHaveBeenCalledTimes(1);
  });
});


describe('VIP recovery bounded pagination', () => {
  it('advances beyond ten malformed snapshots on the next tick and restarts from oldest after a short page', async () => {
    const createdAt = new Date('2026-01-01');
    const malformed = Array.from({ length: 10 }, (_, i) => ({ id: `bad-${i}`, createdAt, checkoutSession: { bizType: 'VIP_PACKAGE', bizMeta: {}, itemsSnapshot: [] } }));
    const valid = { id: 'good', createdAt, userId: 'u', checkoutSession: { bizType: 'VIP_PACKAGE', bizMeta: { vipGiftOptionId: 'g', snapshotPrice: 399 }, itemsSnapshot: [] } };
    const prisma = { vipPurchase: { findMany: jest.fn().mockResolvedValue([]) }, order: { findMany: jest.fn().mockResolvedValueOnce(malformed).mockResolvedValueOnce([valid]).mockResolvedValueOnce([]) } };
    const bonus = { activateVipAfterPayment: jest.fn().mockResolvedValue(undefined) };
    const service = new VipActivationRetryService(prisma as any, bonus as any);
    await service.retryFailedActivations();
    expect(bonus.activateVipAfterPayment).not.toHaveBeenCalled();
    await service.retryFailedActivations();
    expect(bonus.activateVipAfterPayment).toHaveBeenCalledTimes(1);
    expect(prisma.order.findMany.mock.calls[1][0].where.OR).toEqual([{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: 'bad-9' } }]);
    await service.retryFailedActivations();
    expect(prisma.order.findMany.mock.calls[2][0].where.OR).toBeUndefined();
    expect(prisma.vipPurchase.findMany.mock.calls[0][0].where.order.is).toMatchObject({
      status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] }, refunds: { none: {} },
      checkoutSession: { is: { bizType: 'VIP_PACKAGE', status: { in: ['PAID', 'COMPLETED'] }, paidAt: { not: null } } },
    });
  });
});
