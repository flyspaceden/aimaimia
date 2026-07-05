import { OrderService } from './order.service';

const flushAsyncTasks = () => new Promise<void>((resolve) => setImmediate(resolve));

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
    const digitalAsset = { creditOrderReceived: jest.fn().mockResolvedValue({ recorded: true, cumulativeSpendAmount: 100 }) };
    const bonusService = { activateVipByCumulativeSpend: jest.fn().mockResolvedValue({ status: 'UPGRADED' }) };
    const groupBuyLifecycle = { evaluateOrderAfterReceive: jest.fn().mockResolvedValue(undefined) };
    const growthEvents = { receive: jest.fn().mockResolvedValue({ status: 'GRANTED' }) };
    return { service, prisma, digitalAsset, bonusService, groupBuyLifecycle, growthEvents };
  };

  it('credits digital asset after manual confirm receive succeeds', async () => {
    const { service, digitalAsset } = makeService();
    service.setDigitalAssetService(digitalAsset as any);

    await service.confirmReceive('order-1', 'user-1');

    expect(digitalAsset.creditOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
  });

  it('activates auto VIP after manual digital asset credit succeeds', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await service.confirmReceive('order-1', 'user-1');
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledTimes(1);
    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it('does not fail confirm receive when digital asset credit fails', async () => {
    const { service, digitalAsset } = makeService();
    digitalAsset.creditOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);

    await expect(service.confirmReceive('order-1', 'user-1')).resolves.toMatchObject({ id: 'order-1' });
  });

  it('does not activate auto VIP when manual digital asset credit fails', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    digitalAsset.creditOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await expect(service.confirmReceive('order-1', 'user-1')).resolves.toMatchObject({ id: 'order-1' });
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).not.toHaveBeenCalled();
  });

  it('does not grant ordinary invite first-order growth when digital asset credit failed before VIP settlement', async () => {
    const { service, prisma, digitalAsset, growthEvents } = makeService();
    digitalAsset.creditOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    prisma.normalShareBinding.findUnique.mockResolvedValueOnce({
      id: 'binding-1',
      inviterUserId: 'inviter-1',
      inviteeUserId: 'user-1',
      rewardStatus: 'REGISTER_REWARDED',
      relationStatus: 'ACTIVE',
      firstOrderId: null,
    });
    service.setDigitalAssetService(digitalAsset as any);
    service.setGrowthEventService(growthEvents as any);

    await service.confirmReceive('order-1', 'user-1');
    await flushAsyncTasks();

    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      behaviorCode: 'FIRST_ORDER_RECEIVED',
    }));
    expect(growthEvents.receive).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'inviter-1',
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
    }));
    expect(prisma.normalShareBinding.updateMany).not.toHaveBeenCalled();
  });

  it('does not activate auto VIP when manual digital asset credit resolves without recording spend', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    digitalAsset.creditOrderReceived.mockResolvedValueOnce({ recorded: false, reason: 'DUPLICATE_LEDGER' });
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await expect(service.confirmReceive('order-1', 'user-1')).resolves.toMatchObject({ id: 'order-1' });
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it('waits for auto VIP relation settlement before ordinary invite first-order growth', async () => {
    const { service, prisma, digitalAsset, bonusService, growthEvents } = makeService();
    let resolveAsset!: (value: any) => void;
    digitalAsset.creditOrderReceived.mockReturnValueOnce(new Promise((resolve) => {
      resolveAsset = resolve;
    }));
    const binding = {
      id: 'binding-1',
      inviterUserId: 'inviter-1',
      inviteeUserId: 'user-1',
      rewardStatus: 'REGISTER_REWARDED',
      relationStatus: 'ACTIVE',
      firstOrderId: null,
    };
    prisma.normalShareBinding.findUnique.mockImplementation(() => Promise.resolve(binding));
    bonusService.activateVipByCumulativeSpend.mockImplementation(async () => {
      binding.relationStatus = 'INVALIDATED_BY_INVITEE_VIP_UPGRADE';
      return { status: 'UPGRADED' };
    });
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);
    service.setGrowthEventService(growthEvents as any);

    await service.confirmReceive('order-1', 'user-1');
    await flushAsyncTasks();

    expect(growthEvents.receive).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'inviter-1',
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
    }));

    resolveAsset({ recorded: true, cumulativeSpendAmount: 399 });
    await flushAsyncTasks();
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      behaviorCode: 'FIRST_ORDER_RECEIVED',
    }));
    expect(growthEvents.receive).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'inviter-1',
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
    }));
    expect(prisma.normalShareBinding.updateMany).not.toHaveBeenCalled();
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

  it('does not grant ordinary invite first-order growth when the direct relation was invalidated by VIP upgrade', async () => {
    const { service, prisma, growthEvents } = makeService();
    prisma.normalShareBinding.findUnique.mockResolvedValueOnce({
      id: 'binding-invalidated',
      inviterUserId: 'inviter-1',
      inviteeUserId: 'user-1',
      rewardStatus: 'REGISTER_REWARDED',
      relationStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
      firstOrderId: null,
    });
    service.setGrowthEventService(growthEvents as any);

    await service.confirmReceive('order-1', 'user-1');
    await flushAsyncTasks();

    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      behaviorCode: 'FIRST_ORDER_RECEIVED',
    }));
    expect(growthEvents.receive).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'inviter-1',
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
    }));
    expect(prisma.normalShareBinding.updateMany).not.toHaveBeenCalled();
  });
});
