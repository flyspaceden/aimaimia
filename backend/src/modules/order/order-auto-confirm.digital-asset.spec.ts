import { OrderAutoConfirmService } from './order-auto-confirm.service';

const flushAsyncTasks = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('OrderAutoConfirmService digital asset hook', () => {
  const makeService = () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          userId: 'user-1',
          status: 'DELIVERED',
          bizType: 'NORMAL_GOODS',
          goodsAmount: 100,
          totalAmount: 100,
          items: [{ isPrize: false }],
          afterSaleRequests: [],
        }),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      orderStatusHistory: {
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      order: {
        findUnique: jest.fn().mockResolvedValue({ status: 'RECEIVED' }),
      },
      orderStatusHistory: { create: jest.fn() },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    const bonusAllocation = { allocateForOrder: jest.fn().mockResolvedValue(undefined) };
    const digitalAsset = { creditOrderReceived: jest.fn().mockResolvedValue(undefined) };
    const groupBuyLifecycle = { evaluateOrderAfterReceive: jest.fn().mockResolvedValue(undefined) };
    const growthEvents = { receive: jest.fn().mockResolvedValue({ status: 'GRANTED' }) };
    const service = new OrderAutoConfirmService(prisma as any, bonusAllocation as any);
    return { service, prisma, digitalAsset, groupBuyLifecycle, growthEvents };
  };

  it('credits digital asset after automatic confirm receive succeeds', async () => {
    const { service, digitalAsset } = makeService();
    service.setDigitalAssetService(digitalAsset as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');

    expect(digitalAsset.creditOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
  });

  it('does not fail automatic confirm receive when digital asset credit fails', async () => {
    const { service, digitalAsset } = makeService();
    digitalAsset.creditOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);

    await expect((service as any).confirmOrder('order-1', 'DELIVERED')).resolves.toBeUndefined();
  });

  it('evaluates group-buy qualification and referral rebate after automatic confirm receive succeeds', async () => {
    const { service, groupBuyLifecycle } = makeService();
    service.setGroupBuyLifecycleService(groupBuyLifecycle as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');

    expect(groupBuyLifecycle.evaluateOrderAfterReceive).toHaveBeenCalledWith('order-1');
  });

  it('triggers first-order growth reward after automatic confirm receive succeeds', async () => {
    const { service, growthEvents } = makeService();
    service.setGrowthEventService(growthEvents as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');
    await flushAsyncTasks();

    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      behaviorCode: 'FIRST_ORDER_RECEIVED',
      idempotencyKey: 'FIRST_ORDER_RECEIVED:user-1:order-1',
      refType: 'ORDER',
      refId: 'order-1',
    }));
  });

  it('triggers ordinary invite first-order growth reward after automatic confirm receive succeeds', async () => {
    const { service, prisma, growthEvents } = makeService();
    prisma.normalShareBinding.findUnique.mockResolvedValueOnce({
      id: 'binding-1',
      inviterUserId: 'inviter-1',
      inviteeUserId: 'user-1',
      rewardStatus: 'FIRST_ORDER_PENDING',
      firstOrderId: null,
    });
    service.setGrowthEventService(growthEvents as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');
    await flushAsyncTasks();

    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'inviter-1',
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
      idempotencyKey: 'NORMAL_INVITE_FIRST_ORDER:user-1:order-1',
      refType: 'ORDER',
      refId: 'order-1',
    }));
    expect(prisma.normalShareBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'binding-1' }),
      data: expect.objectContaining({
        firstOrderId: 'order-1',
        rewardStatus: 'ISSUED',
      }),
    }));
  });
});
