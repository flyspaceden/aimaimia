import { OrderAutoConfirmService } from './order-auto-confirm.service';
import { OrderService } from './order.service';

describe('Order captain commission release hooks', () => {
  function makeManualService() {
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
    const captainCommission = {
      releaseForReceivedOrder: jest.fn().mockResolvedValue('released'),
    };
    return { service, captainCommission };
  }

  function makeAutoService() {
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
    const service = new OrderAutoConfirmService(prisma as any, bonusAllocation as any);
    const captainCommission = {
      releaseForReceivedOrder: jest.fn().mockResolvedValue('released'),
    };
    return { service, captainCommission };
  }

  it('calls captain commission release after buyer confirms receipt', async () => {
    const { service, captainCommission } = makeManualService();
    service.setCaptainCommissionService(captainCommission as any);

    await service.confirmReceive('order-1', 'user-1');

    expect(captainCommission.releaseForReceivedOrder).toHaveBeenCalledWith(
      'order-1',
      'BUYER_RECEIVED',
    );
  });

  it('does not fail buyer confirm receive when captain release fails', async () => {
    const { service, captainCommission } = makeManualService();
    captainCommission.releaseForReceivedOrder.mockRejectedValueOnce(new Error('captain failed'));
    service.setCaptainCommissionService(captainCommission as any);

    await expect(service.confirmReceive('order-1', 'user-1')).resolves.toMatchObject({ id: 'order-1' });
  });

  it('calls captain commission release after automatic receipt confirmation', async () => {
    const { service, captainCommission } = makeAutoService();
    service.setCaptainCommissionService(captainCommission as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');

    expect(captainCommission.releaseForReceivedOrder).toHaveBeenCalledWith(
      'order-1',
      'AUTO_RECEIVED',
    );
  });
});
