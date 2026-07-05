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
    const digitalAsset = { creditOrderReceived: jest.fn().mockResolvedValue({ recorded: true, cumulativeSpendAmount: 100 }) };
    const bonusService = { activateVipByCumulativeSpend: jest.fn().mockResolvedValue({ status: 'UPGRADED' }) };
    const groupBuyLifecycle = { evaluateOrderAfterReceive: jest.fn().mockResolvedValue(undefined) };
    const growthEvents = { receive: jest.fn().mockResolvedValue({ status: 'GRANTED' }) };
    const service = new OrderAutoConfirmService(prisma as any, bonusAllocation as any);
    return { service, prisma, digitalAsset, bonusService, groupBuyLifecycle, growthEvents };
  };

  it('credits digital asset after automatic confirm receive succeeds', async () => {
    const { service, digitalAsset } = makeService();
    service.setDigitalAssetService(digitalAsset as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');

    expect(digitalAsset.creditOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
  });

  it('activates auto VIP after automatic digital asset credit succeeds', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await (service as any).confirmOrder('order-1', 'DELIVERED');
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledTimes(1);
    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it('does not fail automatic confirm receive when digital asset credit fails', async () => {
    const { service, digitalAsset } = makeService();
    digitalAsset.creditOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);

    await expect((service as any).confirmOrder('order-1', 'DELIVERED')).resolves.toBeUndefined();
  });

  it('does not activate auto VIP when automatic digital asset credit fails', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    digitalAsset.creditOrderReceived.mockRejectedValueOnce(new Error('asset failed'));
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await expect((service as any).confirmOrder('order-1', 'DELIVERED')).resolves.toBeUndefined();
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).not.toHaveBeenCalled();
  });

  it('does not grant ordinary invite first-order growth when automatic digital asset credit failed before VIP settlement', async () => {
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

    await (service as any).confirmOrder('order-1', 'DELIVERED');
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

  it('does not activate auto VIP when automatic digital asset credit resolves without recording spend', async () => {
    const { service, digitalAsset, bonusService } = makeService();
    digitalAsset.creditOrderReceived.mockResolvedValueOnce({ recorded: false, reason: 'DUPLICATE_LEDGER' });
    service.setDigitalAssetService(digitalAsset as any);
    service.setBonusService(bonusService as any);

    await expect((service as any).confirmOrder('order-1', 'DELIVERED')).resolves.toBeUndefined();
    await flushAsyncTasks();

    expect(bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it('waits for auto VIP relation settlement before automatic ordinary invite first-order growth', async () => {
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

    await (service as any).confirmOrder('order-1', 'DELIVERED');
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
      relationStatus: 'ACTIVE',
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

  it('does not grant ordinary invite first-order growth after the relation was invalidated by VIP upgrade', async () => {
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

    await (service as any).confirmOrder('order-1', 'DELIVERED');
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
