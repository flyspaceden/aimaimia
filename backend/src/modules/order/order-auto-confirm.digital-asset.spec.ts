import { OrderAutoConfirmService } from './order-auto-confirm.service';

describe('OrderAutoConfirmService digital asset hook', () => {
  const makeService = () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'DELIVERED',
          afterSaleRequests: [],
        }),
        update: jest.fn(),
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
    const digitalAsset = { creditOrderReceived: jest.fn().mockResolvedValue(undefined) };
    const groupBuyLifecycle = { evaluateOrderAfterReceive: jest.fn().mockResolvedValue(undefined) };
    const service = new OrderAutoConfirmService(prisma as any, bonusAllocation as any);
    return { service, digitalAsset, groupBuyLifecycle };
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
});
