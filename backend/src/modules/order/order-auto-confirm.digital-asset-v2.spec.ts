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
    const digitalAsset = { recordOrderReceived: jest.fn().mockResolvedValue(undefined) };
    const service = new OrderAutoConfirmService(prisma as any, bonusAllocation as any);
    return { service, prisma, digitalAsset };
  };

  it('calls recordOrderReceived after automatic confirm receive succeeds', async () => {
    const { service, digitalAsset } = makeService();
    service.setDigitalAssetService(digitalAsset as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');

    expect(digitalAsset.recordOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
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
});
