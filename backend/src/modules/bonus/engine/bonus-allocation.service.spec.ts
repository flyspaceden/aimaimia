import { BonusAllocationService } from './bonus-allocation.service';

describe('BonusAllocationService.allocateForOrder cancellation isolation', () => {
  const makeService = () => {
    const prisma = {
      order: {
        findUnique: jest.fn(),
      },
      rewardAllocation: {
        create: jest.fn(),
      },
      normalEligibleOrder: {
        create: jest.fn(),
      },
      vipEligibleOrder: {
        create: jest.fn(),
      },
      normalProgress: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      vipProgress: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const service = new BonusAllocationService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  };

  it('CANCELED 订单不会创建分润、有效消费或 selfPurchaseCount', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o-canceled',
      status: 'CANCELED',
      bizType: 'NORMAL_GOODS',
    });

    await service.allocateForOrder('o-canceled');

    expect(prisma.rewardAllocation.create).not.toHaveBeenCalled();
    expect(prisma.normalEligibleOrder.create).not.toHaveBeenCalled();
    expect(prisma.vipEligibleOrder.create).not.toHaveBeenCalled();
    expect(prisma.normalProgress.update).not.toHaveBeenCalled();
    expect(prisma.normalProgress.updateMany).not.toHaveBeenCalled();
    expect(prisma.vipProgress.update).not.toHaveBeenCalled();
    expect(prisma.vipProgress.updateMany).not.toHaveBeenCalled();
  });
});
