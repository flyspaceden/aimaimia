import { OrderService } from './order.service';

describe('OrderService digital asset hook', () => {
  const makeService = () => {
    const tx = {
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'order-1',
            userId: 'user-1',
            status: 'DELIVERED',
            deliveredAt: new Date(),
          })
          .mockResolvedValueOnce({
            id: 'order-1',
            userId: 'user-1',
            status: 'RECEIVED',
            bizType: 'NORMAL_GOODS',
            goodsAmount: 100,
            totalAmount: 100,
            items: [{ isPrize: false }],
            _isFirstReceived: true,
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(1),
      },
      orderStatusHistory: {
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      orderStatusHistory: { create: jest.fn() },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    const bonusAllocation = { allocateForOrder: jest.fn().mockResolvedValue(undefined) };
    const service = new OrderService(
      prisma as any,
      bonusAllocation as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (service as any).mapOrder = jest.fn((order) => order);
    const digitalAsset = { creditOrderReceived: jest.fn().mockResolvedValue(undefined) };
    const groupBuyLifecycle = { evaluateOrderAfterReceive: jest.fn().mockResolvedValue(undefined) };
    const growthEvents = { receive: jest.fn().mockResolvedValue({ status: 'GRANTED' }) };
    return { service, prisma, digitalAsset, groupBuyLifecycle, growthEvents };
  };

  it('credits digital asset after manual confirm receive succeeds', async () => {
    const { service, digitalAsset } = makeService();
    service.setDigitalAssetService(digitalAsset as any);

    await service.confirmReceive('order-1', 'user-1');

    expect(digitalAsset.creditOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
  });

  it('does not fail confirm receive when digital asset credit fails', async () => {
    const { service, digitalAsset } = makeService();
    digitalAsset.creditOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);

    await expect(service.confirmReceive('order-1', 'user-1')).resolves.toMatchObject({ id: 'order-1' });
  });

  it('evaluates group-buy qualification and referral rebate after manual confirm receive succeeds', async () => {
    const { service, groupBuyLifecycle } = makeService();
    service.setGroupBuyLifecycleService(groupBuyLifecycle as any);

    await service.confirmReceive('order-1', 'user-1');

    expect(groupBuyLifecycle.evaluateOrderAfterReceive).toHaveBeenCalledWith('order-1');
  });

  it('triggers first-order growth reward after manual confirm receive succeeds', async () => {
    const { service, growthEvents } = makeService();
    service.setGrowthEventService(growthEvents as any);

    await service.confirmReceive('order-1', 'user-1');

    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      behaviorCode: 'FIRST_ORDER_RECEIVED',
      idempotencyKey: 'FIRST_ORDER_RECEIVED:user-1:order-1',
      refType: 'ORDER',
      refId: 'order-1',
    }));
  });
});
