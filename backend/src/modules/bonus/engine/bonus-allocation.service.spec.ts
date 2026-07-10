import { BonusAllocationService } from './bonus-allocation.service';
import { RewardCalculatorService } from './reward-calculator.service';

const snapshotRates = {
  vip: {
    platform: 0.4,
    reward: 0.2,
    directReferral: 0.15,
    industryFund: 0.1,
    charity: 0.1,
    tech: 0.05,
    reserve: 0,
  },
  normal: {
    platform: 0.35,
    reward: 0.2,
    directReferral: 0.01,
    industryFund: 0.15,
    charity: 0.1,
    tech: 0.1,
    reserve: 0.09,
  },
};

function makeSnapshotOrder(path: 'VIP' | 'NORMAL', snapshotOverrides: any = {}) {
  return {
    id: 'snapshot-order',
    userId: 'buyer-1',
    status: 'RECEIVED',
    bizType: 'NORMAL_GOODS',
    totalAmount: 135,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    items: [
      {
        id: 'item-1',
        unitPrice: 1,
        quantity: 99,
        companyId: 'company-1',
        isPrize: false,
        sku: { cost: 9999, product: { cost: 8888 } },
      },
    ],
    profitSnapshots: [
      {
        id: 'snapshot-1',
        status: 'READY',
        isCurrent: true,
        distributableProfitAmount: 13.25,
        itemBreakdown: [
          { orderItemId: 'item-1', distributableProfitShareCents: 1325 },
        ],
        ruleSnapshot: {
          buyerPath: path,
          buyerTierAtPayment: path,
          vipNormalConfigVersion: 'snapshot-v3',
          directInviter: {
            userId: 'inviter-1',
            eligibleUserId: 'inviter-1',
            tier: 'VIP',
            path: 'VIP',
            effectiveDirectRate: 0.15,
            platformReason: null,
          },
          vipTreeAncestorPathAtPayment: path === 'VIP'
            ? [{ depth: 1, nodeId: 'vip-old-node', userId: 'vip-old-ancestor', level: 4 }]
            : [],
          normalTreeAncestorPathAtPayment: path === 'NORMAL'
            ? [{ depth: 1, nodeId: 'normal-old-node', userId: 'normal-old-ancestor', level: 3 }]
            : [],
          rates: snapshotRates,
        },
        ...snapshotOverrides,
      },
    ],
  };
}

function makeSnapshotAllocationService(order: any) {
  const tx = {
    rewardAllocation: {
      create: jest.fn().mockResolvedValue({ id: 'allocation-1' }),
    },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    rewardAllocation: { findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  const configService = { getConfig: jest.fn(() => { throw new Error('current config must not be read'); }) };
  const calculator = new RewardCalculatorService();
  const vipUpstream = {
    distribute: jest.fn().mockResolvedValue({ result: 'distributed', ancestorUserId: 'vip-old-ancestor' }),
  };
  const vipPlatformSplit = { split: jest.fn().mockResolvedValue(undefined) };
  const normalUpstream = {
    distribute: jest.fn().mockResolvedValue({ result: 'distributed', ancestorUserId: 'normal-old-ancestor' }),
    creditToPlatform: jest.fn(),
  };
  const normalPlatformSplit = { split: jest.fn().mockResolvedValue(undefined) };
  const service = new BonusAllocationService(
    prisma as any,
    configService as any,
    calculator,
    {} as any,
    vipUpstream as any,
    {} as any,
    vipPlatformSplit as any,
    normalUpstream as any,
    normalPlatformSplit as any,
  );
  return {
    service,
    prisma,
    tx,
    configService,
    vipUpstream,
    vipPlatformSplit,
    normalUpstream,
    normalPlatformSplit,
  };
}

describe('BonusAllocationService.allocateForOrder snapshot path', () => {
  it('uses snapshot D, VIP rates, and the snapshotted VIP ancestor after cost/tree/config changes', async () => {
    const harness = makeSnapshotAllocationService(makeSnapshotOrder('VIP'));

    await harness.service.allocateForOrder('snapshot-order');

    expect(harness.configService.getConfig).not.toHaveBeenCalled();
    expect(harness.vipUpstream.distribute).toHaveBeenCalledWith(
      harness.tx,
      'allocation-1',
      'snapshot-order',
      'buyer-1',
      135,
      2.65,
      null,
      {
        buyerPath: 'VIP',
        ancestors: [{ depth: 1, nodeId: 'vip-old-node', userId: 'vip-old-ancestor', level: 4 }],
      },
    );
    expect(harness.vipPlatformSplit.split).toHaveBeenCalledWith(
      harness.tx,
      expect.any(String),
      'snapshot-order',
      expect.objectContaining({
        platformProfit: 5.3,
        industryFund: 1.33,
      }),
      { 'company-1': 1 },
    );
  });

  it('uses normal buyer rates with VIP inviter direct rate and the snapshotted normal ancestor', async () => {
    const harness = makeSnapshotAllocationService(makeSnapshotOrder('NORMAL'));

    await harness.service.allocateForOrder('snapshot-order');

    expect(harness.normalUpstream.distribute).toHaveBeenCalledWith(
      harness.tx,
      'allocation-1',
      'snapshot-order',
      'buyer-1',
      135,
      2.65,
      null,
      {
        buyerPath: 'NORMAL',
        ancestors: [{ depth: 1, nodeId: 'normal-old-node', userId: 'normal-old-ancestor', level: 3 }],
      },
    );
    expect(harness.normalPlatformSplit.split).toHaveBeenCalledWith(
      harness.tx,
      'allocation-1',
      'snapshot-order',
      expect.objectContaining({
        directReferralPool: 1.99,
        industryFund: 1.99,
      }),
      { 'company-1': 1 },
    );
    expect(harness.vipUpstream.distribute).not.toHaveBeenCalled();
  });

  it.each([
    ['zero D', { status: 'READY', distributableProfitAmount: 0 }],
    ['reconciliation', { status: 'RECONCILIATION_REQUIRED', distributableProfitAmount: 13.25 }],
  ])('creates no receipt allocation or external ledger for %s', async (_label, snapshotOverride) => {
    const harness = makeSnapshotAllocationService(makeSnapshotOrder('NORMAL', snapshotOverride));

    await harness.service.allocateForOrder('snapshot-order');

    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.tx.rewardAllocation.create).not.toHaveBeenCalled();
    expect(harness.normalUpstream.distribute).not.toHaveBeenCalled();
    expect(harness.normalPlatformSplit.split).not.toHaveBeenCalled();
  });
});

describe('BonusAllocationService.allocateForOrder legacy fallback', () => {
  it('keeps the existing cost/config route for received orders without a snapshot', async () => {
    const legacyOrder = {
      id: 'legacy-order',
      userId: 'buyer-1',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 100,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      profitSnapshots: [],
      items: [{ id: 'item-1', unitPrice: 100, quantity: 1, companyId: 'company-1', isPrize: false }],
    };
    const legacyOrderWithCost = {
      ...legacyOrder,
      items: [{
        ...legacyOrder.items[0],
        sku: { cost: 60, product: { cost: 50 } },
      }],
    };
    const tx = {};
    const prisma = {
      order: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(legacyOrder)
          .mockResolvedValueOnce(legacyOrderWithCost),
      },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const config = { ruleVersion: 'legacy-v1' };
    const configService = { getConfig: jest.fn().mockResolvedValue(config) };
    const calculator = {
      calculateNormal: jest.fn().mockReturnValue({ profit: 40 }),
    };
    const service = new BonusAllocationService(
      prisma as any,
      configService as any,
      calculator as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'determineRouting').mockResolvedValue('NORMAL_TREE');
    const executeLegacy = jest.spyOn(service as any, 'executeNormalTree').mockResolvedValue(undefined);

    await service.allocateForOrder('legacy-order');

    expect(prisma.order.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.order.findUnique.mock.calls[1][0]).toEqual({
      where: { id: 'legacy-order' },
      include: {
        items: {
          include: {
            sku: {
              select: {
                cost: true,
                product: { select: { cost: true } },
              },
            },
          },
        },
      },
    });
    expect(configService.getConfig).toHaveBeenCalledTimes(1);
    expect(calculator.calculateNormal).toHaveBeenCalledWith([
      { unitPrice: 100, quantity: 1, cost: 60, companyId: 'company-1' },
    ], config);
    expect(executeLegacy).toHaveBeenCalled();
  });
});

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
