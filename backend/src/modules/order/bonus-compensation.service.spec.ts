import { BonusCompensationService } from './bonus-compensation.service';
import { DEAD_LETTER_REASON } from '../bonus/engine/constants';

describe('BonusCompensationService auto VIP compensation', () => {
  it('does not treat ORDER_PAID direct referral allocations as received-order bonus compensation', async () => {
    const allocateForOrder = jest.fn().mockResolvedValue(undefined);
    const prisma: any = {
      orderStatusHistory: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ orderId: 'order-1', reason: DEAD_LETTER_REASON }])
          .mockResolvedValueOnce([]),
        create: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1', status: 'RECEIVED' }),
      },
      rewardAllocation: {
        findFirst: jest.fn(({ where }: any) => {
          if (where.triggerType === 'ORDER_RECEIVED') {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            id: 'direct-paid-alloc-1',
            orderId: 'order-1',
            triggerType: 'ORDER_PAID',
            ruleType: 'NORMAL_DIRECT_REFERRAL',
          });
        }),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ tier: 'VIP' }),
      },
    };
    const service = new BonusCompensationService(
      prisma,
      { allocateForOrder } as any,
      { activateVipByCumulativeSpend: jest.fn() } as any,
      {
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
      } as any,
    );

    await service.compensateFailedBonusAllocations();

    expect(prisma.rewardAllocation.findFirst).toHaveBeenCalledWith({
      where: { orderId: 'order-1', triggerType: 'ORDER_RECEIVED' },
    });
    expect(allocateForOrder).toHaveBeenCalledWith('order-1');
    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        reason: '补偿分润成功',
      }),
    });
  });

  it('retries unresolved auto VIP dead letters for received orders', async () => {
    const prisma: any = {
      orderStatusHistory: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ orderId: 'order-1', meta: { event: 'AUTO_VIP_UPGRADE_DEAD_LETTER' } }])
          .mockResolvedValueOnce([]),
        create: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1', status: 'RECEIVED' }),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ tier: 'NORMAL' }),
      },
    };
    const service = new BonusCompensationService(
      prisma,
      { allocateForOrder: jest.fn() } as any,
      { activateVipByCumulativeSpend: jest.fn().mockResolvedValue({ status: 'UPGRADED' }) } as any,
      {
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
      } as any,
    );

    await service.compensateFailedBonusAllocations();

    expect(prisma.orderStatusHistory.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        reason: '自动VIP升级失败',
        meta: {
          path: ['event'],
          equals: 'AUTO_VIP_UPGRADE_DEAD_LETTER',
        },
      }),
    }));
    expect((service as any).bonusService.activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        reason: '自动VIP补偿结果：UPGRADED',
        meta: expect.objectContaining({
          deadLetterResolved: true,
          event: 'AUTO_VIP_UPGRADE_DEAD_LETTER',
        }),
      }),
    });
  });

  it('retries digital asset dead letters before granting ordinary invite first-order growth', async () => {
    const digitalAsset = {
      recordOrderReceived: jest.fn().mockResolvedValue({ recorded: true, cumulativeSpendAmount: 120 }),
    };
    const growthEvents = {
      receive: jest.fn().mockResolvedValue({ status: 'GRANTED' }),
    };
    const activateVipByCumulativeSpend = jest.fn().mockResolvedValue({ status: 'NOT_ELIGIBLE' });
    const prisma: any = {
      orderStatusHistory: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ orderId: 'order-1', meta: { event: 'DIGITAL_ASSET_CREDIT_DEAD_LETTER' } }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
        create: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1', status: 'RECEIVED' }),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ tier: 'NORMAL' }),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'binding-1',
          inviterUserId: 'inviter-1',
          inviteeUserId: 'user-1',
          relationStatus: 'ACTIVE',
          rewardStatus: 'REGISTER_REWARDED',
          firstOrderId: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new BonusCompensationService(
      prisma,
      { allocateForOrder: jest.fn() } as any,
      { activateVipByCumulativeSpend } as any,
      {
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
    (service as any).digitalAssetService = digitalAsset;
    (service as any).growthEventService = growthEvents;

    await service.compensateFailedBonusAllocations();

    expect(digitalAsset.recordOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
    expect(activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'inviter-1',
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
      idempotencyKey: 'NORMAL_INVITE_FIRST_ORDER:user-1:order-1',
      refType: 'ORDER',
      refId: 'order-1',
    }));
    expect(prisma.normalShareBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'binding-1',
        relationStatus: 'ACTIVE',
        rewardStatus: { in: ['PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING'] },
      },
      data: {
        firstOrderId: 'order-1',
        rewardStatus: 'ISSUED',
        rewardIssuedAt: expect.any(Date),
      },
    });
    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        reason: '数字资产补偿成功',
        meta: expect.objectContaining({
          deadLetterResolved: true,
          event: 'DIGITAL_ASSET_CREDIT_DEAD_LETTER',
        }),
      }),
    });
  });

  it('does not grant ordinary invite first-order growth after digital asset compensation upgrades invitee to VIP and invalidates relation', async () => {
    const digitalAsset = {
      recordOrderReceived: jest.fn().mockResolvedValue({ recorded: true, cumulativeSpendAmount: 399 }),
    };
    const growthEvents = {
      receive: jest.fn().mockResolvedValue({ status: 'GRANTED' }),
    };
    const binding = {
      id: 'binding-1',
      inviterUserId: 'inviter-1',
      inviteeUserId: 'user-1',
      relationStatus: 'ACTIVE',
      rewardStatus: 'REGISTER_REWARDED',
      firstOrderId: null,
    };
    const activateVipByCumulativeSpend = jest.fn().mockImplementation(async () => {
      binding.relationStatus = 'INVALIDATED_BY_INVITEE_VIP_UPGRADE';
      return { status: 'UPGRADED' };
    });
    const prisma: any = {
      orderStatusHistory: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ orderId: 'order-1', meta: { event: 'DIGITAL_ASSET_CREDIT_DEAD_LETTER' } }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
        create: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ id: 'order-1', userId: 'user-1', status: 'RECEIVED' }),
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ tier: 'VIP' }),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(binding)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new BonusCompensationService(
      prisma,
      { allocateForOrder: jest.fn() } as any,
      { activateVipByCumulativeSpend } as any,
      {
        acquireLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
    (service as any).digitalAssetService = digitalAsset;
    (service as any).growthEventService = growthEvents;

    await service.compensateFailedBonusAllocations();

    expect(digitalAsset.recordOrderReceived).toHaveBeenCalledWith('order-1', 'ORDER_RECEIVED');
    expect(activateVipByCumulativeSpend).toHaveBeenCalledWith('user-1', 'order-1');
    expect(growthEvents.receive).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'inviter-1',
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
    }));
    expect(prisma.normalShareBinding.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        reason: '数字资产补偿成功',
        meta: expect.objectContaining({
          deadLetterResolved: true,
          event: 'DIGITAL_ASSET_CREDIT_DEAD_LETTER',
        }),
      }),
    });
  });
});
