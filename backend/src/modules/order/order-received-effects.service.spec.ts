import { OrderReceivedEffectsService } from './order-received-effects.service';

describe('OrderReceivedEffectsService durable receive outbox', () => {
  const makeHarness = () => {
    const rows = [
      { id: 'effect-bonus', orderId: 'order-1', userId: 'user-1', kind: 'BONUS_ALLOCATION', status: 'PENDING', attempts: 0 },
      { id: 'effect-assets', orderId: 'order-1', userId: 'user-1', kind: 'DIGITAL_ASSET_CREDIT', status: 'PENDING', attempts: 0 },
      { id: 'effect-group', orderId: 'order-1', userId: 'user-1', kind: 'GROUP_BUY_EVALUATION', status: 'PENDING', attempts: 0 },
      { id: 'effect-growth', orderId: 'order-1', userId: 'user-1', kind: 'GROWTH_REWARD', status: 'PENDING', attempts: 0, isFirstReceived: true },
      { id: 'effect-captain', orderId: 'order-1', userId: 'user-1', kind: 'CAPTAIN_COMMISSION_RELEASE', status: 'PENDING', attempts: 0, source: 'BUYER_CONFIRM' },
      { id: 'effect-coupon', orderId: 'order-1', userId: 'user-1', kind: 'COUPON_TRIGGERS', status: 'PENDING', attempts: 0, isFirstReceived: true },
    ];
    const tx = {
      orderReceivedEffectOutbox: {
        createMany: jest.fn().mockResolvedValue({ count: 6 }),
      },
    };
    const outbox = {
      findMany: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(rows.filter((row) => !where?.orderId || row.orderId === where.orderId))),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      orderReceivedEffectOutbox: outbox,
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1', userId: 'user-1', status: 'RECEIVED', bizType: 'NORMAL_GOODS',
          goodsAmount: 100, totalAmount: 100, receivedAt: new Date(),
          returnWindowExpiresAt: new Date(Date.now() + 7 * 86_400_000), items: [{ isPrize: false }],
        }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 100 } }),
      },
      normalShareBinding: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
      captainOrderAttribution: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const bonus = { allocateForOrder: jest.fn().mockResolvedValue(undefined) };
    const assets = { recordOrderReceived: jest.fn().mockResolvedValue({ recorded: true }) };
    const bonusService = { activateVipByCumulativeSpend: jest.fn().mockResolvedValue({ status: 'NOOP' }) };
    const groupBuy = { evaluateOrderAfterReceive: jest.fn().mockResolvedValue(undefined) };
    const growth = { receive: jest.fn().mockResolvedValue({ status: 'GRANTED' }) };
    const captain = { releaseForReceivedOrder: jest.fn().mockResolvedValue('released') };
    const coupon = { handleTrigger: jest.fn().mockResolvedValue(undefined) };
    const service = new OrderReceivedEffectsService(
      prisma as any,
      bonus as any,
      assets as any,
      bonusService as any,
      groupBuy as any,
      growth as any,
      captain as any,
      coupon as any,
    );
    return { service, prisma, tx, outbox, bonus, assets, bonusService, groupBuy, growth, captain, coupon };
  };

  it('persists all mandatory effects in the caller RECEIVED transaction with stable unique identities', async () => {
    const { service, tx } = makeHarness();

    await service.enqueueInTransaction(tx as any, {
      orderId: 'order-1',
      userId: 'user-1',
      source: 'BUYER_CONFIRM',
      isFirstReceived: true,
    });

    expect(tx.orderReceivedEffectOutbox.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ orderId: 'order-1', kind: 'BONUS_ALLOCATION', source: 'BUYER_CONFIRM' }),
        expect.objectContaining({ orderId: 'order-1', kind: 'DIGITAL_ASSET_CREDIT', source: 'BUYER_CONFIRM' }),
        expect.objectContaining({ orderId: 'order-1', kind: 'GROUP_BUY_EVALUATION', source: 'BUYER_CONFIRM' }),
        expect.objectContaining({ orderId: 'order-1', kind: 'GROWTH_REWARD', isFirstReceived: true }),
        expect.objectContaining({ orderId: 'order-1', kind: 'CAPTAIN_COMMISSION_RELEASE' }),
        expect.objectContaining({ orderId: 'order-1', kind: 'COUPON_TRIGGERS', isFirstReceived: true }),
      ]),
      skipDuplicates: true,
    });
  });

  it('replays persisted effects after restart and uses idempotent domain operations', async () => {
    const { service, bonus, assets, bonusService, groupBuy, growth, captain, coupon } = makeHarness();

    await service.processOrder('order-1');

    expect(bonus.allocateForOrder).toHaveBeenCalledWith('order-1');
    expect(assets.recordOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
    expect(groupBuy.evaluateOrderAfterReceive).toHaveBeenCalledWith('order-1');
    expect(growth.receive).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'FIRST_ORDER_RECEIVED:user-1:order-1',
    }));
    expect(captain.releaseForReceivedOrder).toHaveBeenCalledWith('order-1', 'BUYER_RECEIVED');
    expect(coupon.handleTrigger).toHaveBeenCalledWith('user-1', 'FIRST_ORDER', {
      idempotencyKey: 'order-received:order-1:FIRST_ORDER',
    });
    expect(coupon.handleTrigger).toHaveBeenCalledWith('user-1', 'CUMULATIVE_SPEND', {
      totalSpent: 100,
      idempotencyKey: 'order-received:order-1:CUMULATIVE_SPEND',
    });
  });

  it('defers captain release to the authoritative freeze/return-window boundary instead of marking skipped as success', async () => {
    const { service, prisma, outbox, captain, coupon } = makeHarness();
    const releaseAt = new Date(Date.now() + 8 * 86_400_000);
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1', userId: 'user-1', status: 'RECEIVED', receivedAt: new Date(),
      returnWindowExpiresAt: releaseAt, items: [],
    });
    prisma.captainOrderAttribution.findUnique.mockResolvedValue({
      status: 'FROZEN',
      configSnapshot: { orderRules: { freezeDaysAfterReceived: 7 } },
    });
    captain.releaseForReceivedOrder.mockResolvedValueOnce('skipped');

    await service.processOrder('order-1');

    expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'effect-captain', leaseToken: expect.any(String) }),
      data: expect.objectContaining({ status: 'PENDING', runAt: releaseAt }),
    }));
    expect(outbox.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'effect-captain' }),
      data: expect.objectContaining({ status: 'SUCCEEDED' }),
    }));
    expect(coupon.handleTrigger).toHaveBeenCalledWith(
      'user-1',
      'FIRST_ORDER',
      { idempotencyKey: 'order-received:order-1:FIRST_ORDER' },
    );
  });

  it('uses the captain program default seven-day freeze when no later return window exists', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T00:00:00.000Z'));
    try {
      const { service, prisma, outbox, captain } = makeHarness();
      const receivedAt = new Date('2026-08-20T00:00:00.000Z');
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1', userId: 'user-1', status: 'RECEIVED', receivedAt,
        returnWindowExpiresAt: null, items: [],
      });
      prisma.captainOrderAttribution.findUnique.mockResolvedValue({
        status: 'FROZEN',
        configSnapshot: {},
      });
      captain.releaseForReceivedOrder.mockResolvedValueOnce('skipped');

      await service.processOrder('order-1');

      expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'effect-captain', leaseToken: expect.any(String) }),
        data: expect.objectContaining({
          status: 'PENDING',
          runAt: new Date('2026-08-27T00:00:00.000Z'),
        }),
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a failed effect retryable instead of losing it', async () => {
    const { service, outbox, bonus, coupon } = makeHarness();
    bonus.allocateForOrder.mockRejectedValueOnce(new Error('temporary allocation failure'));

    await service.processOrder('order-1');

    expect(outbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'effect-bonus', leaseToken: expect.any(String) }),
      data: expect.objectContaining({ status: 'FAILED', runAt: expect.any(Date) }),
    }));
    expect(coupon.handleTrigger).toHaveBeenCalledWith(
      'user-1',
      'FIRST_ORDER',
      { idempotencyKey: 'order-received:order-1:FIRST_ORDER' },
    );
  });

  it('keeps growth pending until digital credit and auto-VIP complete, without blocking coupons', async () => {
    const { service, assets, growth, coupon } = makeHarness();
    assets.recordOrderReceived
      .mockRejectedValueOnce(new Error('digital asset temporarily unavailable'))
      .mockResolvedValueOnce({ recorded: true });

    await service.processOrder('order-1');
    expect(growth.receive).not.toHaveBeenCalled();
    expect(coupon.handleTrigger).toHaveBeenCalled();

    await service.processOrder('order-1');
    expect(growth.receive).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'FIRST_ORDER_RECEIVED:user-1:order-1',
    }));
  });
});
