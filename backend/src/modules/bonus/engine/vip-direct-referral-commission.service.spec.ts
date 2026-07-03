import { RewardCalculatorService } from './reward-calculator.service';
import { VipDirectReferralCommissionService } from './vip-direct-referral-commission.service';
import { PLATFORM_USER_ID } from './constants';

const baseConfig = {
  ruleVersion: 'test-vip-direct-v1',
  rebateRatio: 1,
  rewardPoolPercent: 0,
  platformPercent: 0,
  fundPercent: 0,
  pointsPercent: 0,
  normalBroadcastX: 10,
  vipFreezeDays: 7,
  normalFreezeDays: 7,
  vipPlatformPercent: 0.5,
  vipRewardPercent: 0.3,
  vipDirectReferralPercent: 0.05,
  vipIndustryFundPercent: 0.1,
  vipCharityPercent: 0.02,
  vipTechPercent: 0.02,
  vipReservePercent: 0.01,
  vipMaxLayers: 15,
  vipBranchFactor: 3,
  vipMinAmount: 0,
  normalPlatformPercent: 0.5,
  normalRewardPercent: 0.16,
  normalIndustryFundPercent: 0.16,
  normalCharityPercent: 0.08,
  normalTechPercent: 0.08,
  normalReservePercent: 0.02,
  normalMaxLayers: 15,
  normalBranchFactor: 3,
};

function makeOrder(overrides: any = {}) {
  return {
    id: 'order-1',
    userId: 'buyer-1',
    bizType: 'NORMAL_GOODS',
    user: {
      memberProfile: {
        tier: 'VIP',
        inviterUserId: 'inviter-1',
      },
    },
    items: [
      {
        unitPrice: 100,
        quantity: 1,
        isPrize: false,
        companyId: 'company-1',
        sku: { cost: 60, product: { cost: 50 } },
      },
    ],
    ...overrides,
  };
}

function makeTx(order = makeOrder(), inviter: any = { status: 'ACTIVE', deletionExecutedAt: null }) {
  const tx = {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
    },
    rewardAllocation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'allocation-1' }),
    },
    rewardAccount: {
      upsert: jest.fn(({ where }: any) => Promise.resolve({
        id: `${where.userId_type.userId}-${where.userId_type.type}`,
        userId: where.userId_type.userId,
        type: where.userId_type.type,
      })),
      update: jest.fn().mockResolvedValue({}),
    },
    rewardLedger: {
      create: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(inviter),
    },
  };
  return tx;
}

function makeService(configOverrides: any = {}) {
  const config = { ...baseConfig, ...configOverrides };
  const configService = {
    getConfig: jest.fn().mockResolvedValue(config),
  };
  const service = new VipDirectReferralCommissionService(
    {} as any,
    configService as any,
    new RewardCalculatorService(),
  );
  return { service, configService, config };
}

describe('VipDirectReferralCommissionService', () => {
  it('creates frozen VIP direct referral commission for a valid direct inviter', async () => {
    const { service } = makeService();
    const tx = makeTx();

    const result = await service.createFrozenForPaidOrder(tx as any, 'order-1');

    expect(result).toBe('credited');
    expect(tx.rewardAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        triggerType: 'ORDER_PAID',
        orderId: 'order-1',
        ruleType: 'VIP_DIRECT_REFERRAL',
        ruleVersion: 'test-vip-direct-v1',
        idempotencyKey: 'ALLOC:ORDER_PAID:order-1:VIP_DIRECT_REFERRAL',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL',
          sourceOrderId: 'order-1',
          sourceUserId: 'buyer-1',
          directInviterUserId: 'inviter-1',
          profit: 40,
          ratio: 0.05,
          directReferralPool: 2,
          routedToPlatform: false,
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        }),
      }),
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        allocationId: 'allocation-1',
        accountId: 'inviter-1-VIP_REWARD',
        userId: 'inviter-1',
        entryType: 'FREEZE',
        amount: 2,
        status: 'FROZEN',
        refType: 'ORDER',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL',
          accountType: 'VIP_REWARD',
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        }),
      }),
    });
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'inviter-1-VIP_REWARD' },
      data: { frozen: { increment: 2 } },
    });
  });

  it('routes to platform when buyer has no direct inviter', async () => {
    const { service } = makeService();
    const tx = makeTx(makeOrder({
      user: { memberProfile: { tier: 'VIP', inviterUserId: null } },
    }));

    const result = await service.createFrozenForPaidOrder(tx as any, 'order-1');

    expect(result).toBe('platform');
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: `${PLATFORM_USER_ID}-PLATFORM_PROFIT`,
        userId: PLATFORM_USER_ID,
        entryType: 'RELEASE',
        amount: 2,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
          originalScheme: 'VIP_DIRECT_REFERRAL',
          accountType: 'PLATFORM_PROFIT',
          routedToPlatform: true,
          platformReason: 'NO_DIRECT_INVITER',
          sourceOrderId: 'order-1',
          directInviterUserId: null,
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        }),
      }),
    });
    expect(tx.rewardAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        meta: expect.objectContaining({ routedToPlatform: true }),
      }),
    });
    expect(tx.rewardAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        meta: expect.objectContaining({
          routedToPlatform: true,
          releaseCondition: 'RECEIVED_AND_RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        }),
      }),
    });
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: `${PLATFORM_USER_ID}-PLATFORM_PROFIT` },
      data: { balance: { increment: 2 } },
    });
  });

  it.each([
    ['BANNED inviter', { status: 'BANNED', deletionExecutedAt: null }],
    ['deleted inviter', { status: 'ACTIVE', deletionExecutedAt: new Date('2026-01-01T00:00:00.000Z') }],
  ])('routes to platform for %s', async (_label, inviter) => {
    const { service } = makeService();
    const tx = makeTx(makeOrder(), inviter);

    const result = await service.createFrozenForPaidOrder(tx as any, 'order-1');

    expect(result).toBe('platform');
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: PLATFORM_USER_ID,
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
          platformReason: 'DIRECT_INVITER_INACTIVE',
          directInviterUserId: 'inviter-1',
        }),
      }),
    });
  });

  it.each([
    ['non-VIP buyer', makeOrder({ user: { memberProfile: { tier: 'NORMAL', inviterUserId: 'inviter-1' } } }), {}],
    ['VIP package order', makeOrder({ bizType: 'VIP_PACKAGE' }), {}],
    ['group buy order', makeOrder({ bizType: 'GROUP_BUY' }), {}],
    ['zero-profit order', makeOrder({ items: [{ unitPrice: 50, quantity: 1, isPrize: false, companyId: 'company-1', sku: { cost: 60, product: { cost: 60 } } }] }), {}],
    ['zero direct referral percent', makeOrder(), { vipDirectReferralPercent: 0 }],
  ])('skips %s', async (_label, order, configOverrides) => {
    const { service } = makeService(configOverrides);
    const tx = makeTx(order);

    const result = await service.createFrozenForPaidOrder(tx as any, order.id);

    expect(result).toBe('skipped');
    expect(tx.rewardAllocation.create).not.toHaveBeenCalled();
    expect(tx.rewardLedger.create).not.toHaveBeenCalled();
    expect(tx.rewardAccount.update).not.toHaveBeenCalled();
  });

  it('does not create duplicate allocation or ledger for the same paid order', async () => {
    const { service } = makeService();
    const tx = makeTx();
    tx.rewardAllocation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'allocation-1' });

    await service.createFrozenForPaidOrder(tx as any, 'order-1');
    const second = await service.createFrozenForPaidOrder(tx as any, 'order-1');

    expect(second).toBe('skipped');
    expect(tx.rewardAllocation.create).toHaveBeenCalledTimes(1);
    expect(tx.rewardLedger.create).toHaveBeenCalledTimes(1);
  });
});
