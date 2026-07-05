import { OrderAutoConfirmService } from './order-auto-confirm.service';

describe('OrderAutoConfirmService digital asset V2 hook', () => {
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
    };
    const bonusAllocation = { allocateForOrder: jest.fn().mockResolvedValue(undefined) };
    const digitalAsset = { recordOrderReceived: jest.fn().mockResolvedValue({ recorded: true, cumulativeSpendAmount: 100 }) };
    const bonusService = { activateVipByCumulativeSpend: jest.fn().mockResolvedValue({ status: 'UPGRADED' }) };
    const service = new OrderAutoConfirmService(prisma as any, bonusAllocation as any);
    return { service, prisma, digitalAsset, bonusService };
  };

  it('calls recordOrderReceived after automatic confirm receive succeeds', async () => {
    const { service, digitalAsset } = makeService();
    service.setDigitalAssetService(digitalAsset as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');

    expect(digitalAsset.recordOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
  });

  it('activates auto VIP after automatic v2 digital asset credit succeeds', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledTimes(1);
    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it('keeps automatic confirm receive successful and writes the same dead-letter record when v2 credit fails', async () => {
    const { service, prisma, digitalAsset } = makeService();
    digitalAsset.recordOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);

    await expect((service as any).confirmOrder('order-1', 'DELIVERED')).resolves.toBeUndefined();

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

  it('does not activate auto VIP when automatic v2 digital asset credit fails', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    digitalAsset.recordOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await expect((service as any).confirmOrder('order-1', 'DELIVERED')).resolves.toBeUndefined();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(bonusService.activateVipByCumulativeSpend).not.toHaveBeenCalled();
  });

  it('does not activate auto VIP when automatic v2 digital asset credit resolves without recording spend', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    digitalAsset.recordOrderReceived.mockResolvedValueOnce({ recorded: false, reason: 'VIP_PACKAGE' });
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await expect((service as any).confirmOrder('order-1', 'DELIVERED')).resolves.toBeUndefined();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(bonusService.activateVipByCumulativeSpend).not.toHaveBeenCalled();
  });
});
