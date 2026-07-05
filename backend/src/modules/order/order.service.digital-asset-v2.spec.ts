import { OrderService } from './order.service';

const flushAsyncTasks = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('OrderService digital asset V2 hook', () => {
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
    const digitalAsset = { recordOrderReceived: jest.fn().mockResolvedValue(undefined) };
    const bonusService = { activateVipByCumulativeSpend: jest.fn().mockResolvedValue({ status: 'UPGRADED' }) };
    return { service, prisma, tx, digitalAsset, bonusService };
  };

  it('calls recordOrderReceived after manual confirm receive succeeds', async () => {
    const { service, digitalAsset } = makeService();
    service.setDigitalAssetService(digitalAsset as any);

    await service.confirmReceive('order-1', 'user-1');

    expect(digitalAsset.recordOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
  });

  it('activates auto VIP after manual v2 digital asset credit succeeds', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await service.confirmReceive('order-1', 'user-1');
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledTimes(1);
    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it('keeps manual confirm receive successful and writes the same dead-letter record when v2 credit fails', async () => {
    const { service, prisma, digitalAsset } = makeService();
    digitalAsset.recordOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);

    await expect(service.confirmReceive('order-1', 'user-1')).resolves.toMatchObject({ id: 'order-1' });

    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        fromStatus: 'RECEIVED',
        toStatus: 'RECEIVED',
        reason: '数字资产累计失败',
        meta: expect.objectContaining({
          deadLetter: true,
          event: 'DIGITAL_ASSET_CREDIT_DEAD_LETTER',
          error: 'asset failed',
        }),
      }),
    });
  });

  it('does not activate auto VIP when manual v2 digital asset credit fails', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    digitalAsset.recordOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await expect(service.confirmReceive('order-1', 'user-1')).resolves.toMatchObject({ id: 'order-1' });
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).not.toHaveBeenCalled();
  });
});
