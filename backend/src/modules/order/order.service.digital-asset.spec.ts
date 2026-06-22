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
            items: [],
            _isFirstReceived: false,
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(2),
      },
      orderStatusHistory: {
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      orderStatusHistory: { create: jest.fn() },
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
    return { service, prisma, digitalAsset, groupBuyLifecycle };
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
});
