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

describe('BonusAllocationService.rollbackForOrder direct referral rollback', () => {
  const makeService = (tx: any) => {
    const prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
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

  it('includes VIP_DIRECT_REFERRAL allocations and mirrors voided direct ledger to platform', async () => {
    const directLedger = {
      id: 'direct-ledger-1',
      allocationId: 'allocation-direct-1',
      accountId: 'vip-account-1',
      userId: 'inviter-1',
      status: 'FROZEN',
      entryType: 'FREEZE',
      amount: 2,
      meta: { scheme: 'VIP_DIRECT_REFERRAL', accountType: 'VIP_REWARD' },
    };
    const tx = {
      rewardAllocation: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'allocation-direct-1',
            ruleType: 'VIP_DIRECT_REFERRAL',
            ledgers: [directLedger],
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 'refund-allocation-1' }),
      },
      rewardLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'platform-ledger-1' }),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        create: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      vipEligibleOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      normalQueueMember: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      normalEligibleOrder: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { service } = makeService(tx);

    await service.rollbackForOrder('order-1');

    expect(tx.rewardAllocation.findMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      include: { ledgers: true },
    });
    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['direct-ledger-1'] },
        status: { in: ['AVAILABLE', 'FROZEN', 'RETURN_FROZEN'] },
      },
      data: { status: 'VOIDED', entryType: 'VOID' },
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'vip-account-1', frozen: { gte: 2 } },
      data: { frozen: { decrement: 2 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'platform-account-1',
        userId: 'PLATFORM',
        entryType: 'RELEASE',
        amount: 2,
        status: 'AVAILABLE',
        refType: 'REFUND',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL_VOID',
          originalScheme: 'VIP_DIRECT_REFERRAL',
          originalLedgerId: 'direct-ledger-1',
          originalReceiverUserId: 'inviter-1',
          voidSource: 'REFUND_ROLLBACK',
        }),
      }),
    });
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'platform-account-1' },
      data: { balance: { increment: 2 } },
    });
  });

  it('mirrors rollback of platform-routed VIP_DIRECT_REFERRAL_PLATFORM ledgers back to platform for audit continuity', async () => {
    const platformLedger = {
      id: 'direct-platform-ledger-1',
      allocationId: 'allocation-direct-platform-1',
      accountId: 'platform-account-original',
      userId: 'PLATFORM',
      status: 'AVAILABLE',
      entryType: 'RELEASE',
      amount: 2,
      meta: {
        scheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
        originalScheme: 'VIP_DIRECT_REFERRAL',
        accountType: 'PLATFORM_PROFIT',
        sourceUserId: 'buyer-1',
        profit: 40,
        ratio: 0.05,
        directReferralPool: 2,
        platformReason: 'NO_DIRECT_INVITER',
      },
    };
    const tx = {
      rewardAllocation: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'allocation-direct-platform-1',
            ruleType: 'VIP_DIRECT_REFERRAL',
            ledgers: [platformLedger],
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 'refund-allocation-1' }),
      },
      rewardLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'platform-ledger-mirror' }),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        create: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      vipEligibleOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      normalQueueMember: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      normalEligibleOrder: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { service } = makeService(tx);

    await service.rollbackForOrder('order-1');

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['direct-platform-ledger-1'] },
        status: { in: ['AVAILABLE', 'FROZEN', 'RETURN_FROZEN'] },
      },
      data: { status: 'VOIDED', entryType: 'VOID' },
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'platform-account-original', balance: { gte: 2 } },
      data: { balance: { decrement: 2 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'platform-account-1',
        userId: 'PLATFORM',
        amount: 2,
        status: 'AVAILABLE',
        refType: 'REFUND',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL_VOID',
          originalScheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
          originalLedgerId: 'direct-platform-ledger-1',
          originalReceiverUserId: 'PLATFORM',
          sourceUserId: 'buyer-1',
          profit: 40,
          ratio: 0.05,
          directReferralPool: 2,
          platformReason: 'NO_DIRECT_INVITER',
          voidSource: 'REFUND_ROLLBACK',
        }),
      }),
    });
  });

  it('includes NORMAL_DIRECT_REFERRAL allocations and mirrors voided direct ledger to platform', async () => {
    const directLedger = {
      id: 'normal-direct-ledger-1',
      allocationId: 'allocation-normal-direct-1',
      accountId: 'normal-account-1',
      userId: 'normal-inviter-1',
      status: 'FROZEN',
      entryType: 'FREEZE',
      amount: 1,
      meta: {
        scheme: 'NORMAL_DIRECT_REFERRAL',
        accountType: 'NORMAL_REWARD',
        sourceUserId: 'buyer-1',
        directInviterUserId: 'normal-inviter-1',
        inviterTierAtOrder: 'NORMAL',
        inviteeTierAtOrder: 'NORMAL',
        profit: 100,
        ratio: 0.01,
        directReferralPool: 1,
        sourceRelation: 'NORMAL_SHARE_BINDING',
        normalShareBindingId: 'binding-1',
        relationStatus: 'ACTIVE',
        configSnapshot: { NORMAL_DIRECT_REFERRAL_PERCENT: 0.01 },
        releaseCondition: 'ORDER_RECEIVED_RETURN_WINDOW_EXPIRED',
      },
    };
    const tx = {
      rewardAllocation: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'allocation-normal-direct-1',
            ruleType: 'NORMAL_DIRECT_REFERRAL',
            ledgers: [directLedger],
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 'refund-allocation-1' }),
      },
      rewardLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'platform-ledger-1' }),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        create: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      vipEligibleOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      normalQueueMember: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      normalEligibleOrder: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { service } = makeService(tx);

    await service.rollbackForOrder('order-1');

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['normal-direct-ledger-1'] },
        status: { in: ['AVAILABLE', 'FROZEN', 'RETURN_FROZEN'] },
      },
      data: { status: 'VOIDED', entryType: 'VOID' },
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'normal-account-1', frozen: { gte: 1 } },
      data: { frozen: { decrement: 1 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'platform-account-1',
        userId: 'PLATFORM',
        entryType: 'RELEASE',
        amount: 1,
        status: 'AVAILABLE',
        refType: 'REFUND',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'NORMAL_DIRECT_REFERRAL_VOID',
          originalScheme: 'NORMAL_DIRECT_REFERRAL',
          originalLedgerId: 'normal-direct-ledger-1',
          originalReceiverUserId: 'normal-inviter-1',
          sourceUserId: 'buyer-1',
          directInviterUserId: 'normal-inviter-1',
          inviterTierAtOrder: 'NORMAL',
          inviteeTierAtOrder: 'NORMAL',
          profit: 100,
          ratio: 0.01,
          directReferralPool: 1,
          sourceRelation: 'NORMAL_SHARE_BINDING',
          normalShareBindingId: 'binding-1',
          relationStatus: 'ACTIVE',
          configSnapshot: { NORMAL_DIRECT_REFERRAL_PERCENT: 0.01 },
          releaseCondition: 'ORDER_RECEIVED_RETURN_WINDOW_EXPIRED',
          voidSource: 'REFUND_ROLLBACK',
        }),
      }),
    });
  });

  it('mirrors rollback of platform-routed NORMAL_DIRECT_REFERRAL_PLATFORM ledgers back to platform for audit continuity', async () => {
    const platformLedger = {
      id: 'normal-direct-platform-ledger-1',
      allocationId: 'allocation-normal-direct-platform-1',
      accountId: 'platform-account-original',
      userId: 'PLATFORM',
      status: 'AVAILABLE',
      entryType: 'RELEASE',
      amount: 1,
      meta: {
        scheme: 'NORMAL_DIRECT_REFERRAL_PLATFORM',
        originalScheme: 'NORMAL_DIRECT_REFERRAL',
        accountType: 'PLATFORM_PROFIT',
        sourceUserId: 'buyer-1',
        profit: 100,
        ratio: 0.01,
        directReferralPool: 1,
        platformReason: 'NO_DIRECT_INVITER',
      },
    };
    const tx = {
      rewardAllocation: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'allocation-normal-direct-platform-1',
            ruleType: 'NORMAL_DIRECT_REFERRAL',
            ledgers: [platformLedger],
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 'refund-allocation-1' }),
      },
      rewardLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'platform-ledger-mirror' }),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        create: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      vipEligibleOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      normalQueueMember: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      normalEligibleOrder: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const { service } = makeService(tx);

    await service.rollbackForOrder('order-1');

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['normal-direct-platform-ledger-1'] },
        status: { in: ['AVAILABLE', 'FROZEN', 'RETURN_FROZEN'] },
      },
      data: { status: 'VOIDED', entryType: 'VOID' },
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'platform-account-original', balance: { gte: 1 } },
      data: { balance: { decrement: 1 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'platform-account-1',
        userId: 'PLATFORM',
        amount: 1,
        status: 'AVAILABLE',
        refType: 'REFUND',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'NORMAL_DIRECT_REFERRAL_VOID',
          originalScheme: 'NORMAL_DIRECT_REFERRAL_PLATFORM',
          originalLedgerId: 'normal-direct-platform-ledger-1',
          originalReceiverUserId: 'PLATFORM',
          sourceUserId: 'buyer-1',
          profit: 100,
          ratio: 0.01,
          directReferralPool: 1,
          platformReason: 'NO_DIRECT_INVITER',
          voidSource: 'REFUND_ROLLBACK',
        }),
      }),
    });
  });

  it('reuses caller transaction when provided and does not open a nested transaction', async () => {
    const tx = {
      rewardAllocation: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
    };
    const { service, prisma } = makeService(tx);

    await service.rollbackForOrder('order-1', tx);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.rewardAllocation.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'ALLOC:REFUND:order-1' },
    });
    expect(tx.rewardAllocation.findMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      include: { ledgers: true },
    });
    expect(tx.rewardAllocation.create).not.toHaveBeenCalled();
  });

  it('skips rollback inside caller transaction when refund idempotency key already exists', async () => {
    const tx = {
      rewardAllocation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing-refund-allocation' }),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const { service, prisma } = makeService(tx);

    await service.rollbackForOrder('order-1', tx);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.rewardAllocation.findMany).not.toHaveBeenCalled();
    expect(tx.rewardAllocation.create).not.toHaveBeenCalled();
  });
});
