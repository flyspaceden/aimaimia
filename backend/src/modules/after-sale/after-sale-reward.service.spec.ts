import { AfterSaleRewardService } from './after-sale-reward.service';

function makeHarness(frozenLedgers: any[], releasedLedgers: any[] = []) {
  const tx = {
    rewardLedger: {
      findMany: jest.fn()
        .mockResolvedValueOnce(frozenLedgers)
        .mockResolvedValueOnce(releasedLedgers),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'platform-ledger-1' }),
    },
    rewardAccount: {
      findUnique: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
      create: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  return {
    service: new AfterSaleRewardService(prisma as any),
    prisma,
    tx,
  };
}

describe('AfterSaleRewardService direct referral voiding', () => {
  it('voids FROZEN VIP_DIRECT_REFERRAL order ledgers to platform', async () => {
    const { service, tx } = makeHarness([
      {
        id: 'direct-ledger-1',
        userId: 'inviter-1',
        accountId: 'vip-account-1',
        entryType: 'FREEZE',
        amount: 2,
        status: 'FROZEN',
        refType: 'ORDER',
        refId: 'order-1',
        meta: { scheme: 'VIP_DIRECT_REFERRAL', accountType: 'VIP_REWARD' },
      },
    ]);

    await service.voidRewardsForOrder('order-1');

    expect(tx.rewardLedger.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        refType: 'ORDER',
        refId: 'order-1',
        entryType: 'FREEZE',
        status: { in: ['RETURN_FROZEN', 'FROZEN'] },
      },
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'inviter-1',
        type: 'VIP_REWARD',
        frozen: { gte: 2 },
      },
      data: { frozen: { decrement: 2 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'PLATFORM',
        entryType: 'RELEASE',
        amount: 2,
        status: 'AVAILABLE',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL_VOID',
          originalScheme: 'VIP_DIRECT_REFERRAL',
          originalLedgerId: 'direct-ledger-1',
          originalReceiverUserId: 'inviter-1',
        }),
      }),
    });
  });

  it('defensively voids already released VIP_DIRECT_REFERRAL order ledgers to platform', async () => {
    const { service, tx } = makeHarness([], [
      {
        id: 'direct-ledger-2',
        userId: 'inviter-1',
        accountId: 'vip-account-1',
        entryType: 'RELEASE',
        amount: 2,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: 'order-1',
        meta: { scheme: 'VIP_DIRECT_REFERRAL', accountType: 'VIP_REWARD' },
      },
    ]);

    await service.voidRewardsForOrder('order-1');

    expect(tx.rewardLedger.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        refType: 'ORDER',
        refId: 'order-1',
        entryType: 'RELEASE',
        status: 'AVAILABLE',
      },
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'inviter-1',
        type: 'VIP_REWARD',
        balance: { gte: 2 },
      },
      data: { balance: { decrement: 2 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL_VOID',
          voidSource: 'AFTER_SALE_SUCCESS',
          originalLedgerId: 'direct-ledger-2',
        }),
      }),
    });
  });

  it('voids FROZEN NORMAL_DIRECT_REFERRAL order ledgers to platform with normal direct referral audit meta', async () => {
    const { service, tx } = makeHarness([
      {
        id: 'normal-direct-ledger-1',
        userId: 'normal-inviter-1',
        accountId: 'normal-account-1',
        entryType: 'FREEZE',
        amount: 1,
        status: 'FROZEN',
        refType: 'ORDER',
        refId: 'order-1',
        meta: {
          scheme: 'NORMAL_DIRECT_REFERRAL',
          accountType: 'NORMAL_REWARD',
          sourceOrderId: 'order-1',
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
      },
    ]);

    await service.voidRewardsForOrder('order-1');

    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'normal-inviter-1',
        type: 'NORMAL_REWARD',
        frozen: { gte: 1 },
      },
      data: { frozen: { decrement: 1 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'PLATFORM',
        entryType: 'RELEASE',
        amount: 1,
        status: 'AVAILABLE',
        refType: 'AFTER_SALE',
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
          voidSource: 'AFTER_SALE_SUCCESS',
        }),
      }),
    });
  });

  it('defensively voids already released NORMAL_DIRECT_REFERRAL order ledgers to platform', async () => {
    const { service, tx } = makeHarness([], [
      {
        id: 'normal-direct-ledger-2',
        userId: 'normal-inviter-1',
        accountId: 'normal-account-1',
        entryType: 'RELEASE',
        amount: 1,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: 'order-1',
        meta: { scheme: 'NORMAL_DIRECT_REFERRAL', accountType: 'NORMAL_REWARD' },
      },
    ]);

    await service.voidRewardsForOrder('order-1');

    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'normal-inviter-1',
        type: 'NORMAL_REWARD',
        balance: { gte: 1 },
      },
      data: { balance: { decrement: 1 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        meta: expect.objectContaining({
          scheme: 'NORMAL_DIRECT_REFERRAL_VOID',
          originalScheme: 'NORMAL_DIRECT_REFERRAL',
          voidSource: 'AFTER_SALE_SUCCESS',
          originalLedgerId: 'normal-direct-ledger-2',
        }),
      }),
    });
  });

  it('defensively voids platform-routed VIP_DIRECT_REFERRAL_PLATFORM ledgers with direct referral audit meta', async () => {
    const { service, tx } = makeHarness([], [
      {
        id: 'direct-platform-ledger-1',
        userId: 'PLATFORM',
        accountId: 'platform-account-original',
        entryType: 'RELEASE',
        amount: 2,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: 'order-1',
        meta: {
          scheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
          originalScheme: 'VIP_DIRECT_REFERRAL',
          accountType: 'PLATFORM_PROFIT',
          routedToPlatform: true,
          platformReason: 'NO_DIRECT_INVITER',
          sourceOrderId: 'order-1',
          sourceUserId: 'buyer-1',
          profit: 40,
          ratio: 0.05,
          directReferralPool: 2,
        },
      },
    ]);

    await service.voidRewardsForOrder('order-1');

    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'PLATFORM',
        type: 'PLATFORM_PROFIT',
        balance: { gte: 2 },
      },
      data: { balance: { decrement: 2 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'PLATFORM',
        entryType: 'RELEASE',
        amount: 2,
        status: 'AVAILABLE',
        refType: 'AFTER_SALE',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL_VOID',
          originalScheme: 'VIP_DIRECT_REFERRAL_PLATFORM',
          routedToPlatform: true,
          originalLedgerId: 'direct-platform-ledger-1',
          originalReceiverUserId: 'PLATFORM',
          sourceOrderId: 'order-1',
          sourceUserId: 'buyer-1',
          profit: 40,
          ratio: 0.05,
          directReferralPool: 2,
          platformReason: 'NO_DIRECT_INVITER',
          voidSource: 'AFTER_SALE_SUCCESS',
        }),
      }),
    });
    const createdMeta = tx.rewardLedger.create.mock.calls[0][0].data.meta;
    expect(createdMeta.scheme).not.toBe('AFTER_SALE_VOID');
  });

  it('defensively voids platform-routed NORMAL_DIRECT_REFERRAL_PLATFORM ledgers with direct referral audit meta', async () => {
    const { service, tx } = makeHarness([], [
      {
        id: 'normal-direct-platform-ledger-1',
        userId: 'PLATFORM',
        accountId: 'platform-account-original',
        entryType: 'RELEASE',
        amount: 1,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: 'order-1',
        meta: {
          scheme: 'NORMAL_DIRECT_REFERRAL_PLATFORM',
          originalScheme: 'NORMAL_DIRECT_REFERRAL',
          accountType: 'PLATFORM_PROFIT',
          routedToPlatform: true,
          platformReason: 'NO_DIRECT_INVITER',
          sourceOrderId: 'order-1',
          sourceUserId: 'buyer-1',
          profit: 100,
          ratio: 0.01,
          directReferralPool: 1,
        },
      },
    ]);

    await service.voidRewardsForOrder('order-1');

    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'PLATFORM',
        type: 'PLATFORM_PROFIT',
        balance: { gte: 1 },
      },
      data: { balance: { decrement: 1 } },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'PLATFORM',
        entryType: 'RELEASE',
        amount: 1,
        status: 'AVAILABLE',
        refType: 'AFTER_SALE',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'NORMAL_DIRECT_REFERRAL_VOID',
          originalScheme: 'NORMAL_DIRECT_REFERRAL_PLATFORM',
          routedToPlatform: true,
          originalLedgerId: 'normal-direct-platform-ledger-1',
          originalReceiverUserId: 'PLATFORM',
          sourceOrderId: 'order-1',
          sourceUserId: 'buyer-1',
          profit: 100,
          ratio: 0.01,
          directReferralPool: 1,
          platformReason: 'NO_DIRECT_INVITER',
          voidSource: 'AFTER_SALE_SUCCESS',
        }),
      }),
    });
    const createdMeta = tx.rewardLedger.create.mock.calls[0][0].data.meta;
    expect(createdMeta.scheme).not.toBe('AFTER_SALE_VOID');
  });

  it('does not re-void VIP_DIRECT_REFERRAL_VOID platform mirror ledgers', async () => {
    const { service, tx } = makeHarness([], [
      {
        id: 'direct-void-mirror-1',
        userId: 'PLATFORM',
        accountId: 'platform-account-1',
        entryType: 'RELEASE',
        amount: 2,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: 'order-1',
        meta: {
          scheme: 'VIP_DIRECT_REFERRAL_VOID',
          originalScheme: 'VIP_DIRECT_REFERRAL',
          accountType: 'PLATFORM_PROFIT',
          routedToPlatform: true,
          sourceOrderId: 'order-1',
          originalLedgerId: 'direct-ledger-1',
        },
      },
    ]);

    await service.voidRewardsForOrder('order-1');

    expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
    expect(tx.rewardLedger.create).not.toHaveBeenCalled();
    expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.rewardAccount.update).not.toHaveBeenCalled();
  });

  it('does not re-void NORMAL_DIRECT_REFERRAL_VOID platform mirror ledgers', async () => {
    const { service, tx } = makeHarness([], [
      {
        id: 'normal-direct-void-mirror-1',
        userId: 'PLATFORM',
        accountId: 'platform-account-1',
        entryType: 'RELEASE',
        amount: 1,
        status: 'AVAILABLE',
        refType: 'ORDER',
        refId: 'order-1',
        meta: {
          scheme: 'NORMAL_DIRECT_REFERRAL_VOID',
          originalScheme: 'NORMAL_DIRECT_REFERRAL',
          accountType: 'PLATFORM_PROFIT',
          routedToPlatform: true,
          sourceOrderId: 'order-1',
          originalLedgerId: 'normal-direct-ledger-1',
        },
      },
    ]);

    await service.voidRewardsForOrder('order-1');

    expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
    expect(tx.rewardLedger.create).not.toHaveBeenCalled();
    expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.rewardAccount.update).not.toHaveBeenCalled();
  });

  it('rejects FROZEN VIP_DIRECT_REFERRAL voiding when receiver frozen balance cannot be debited', async () => {
    const { service, tx } = makeHarness([
      {
        id: 'direct-ledger-insufficient',
        userId: 'inviter-1',
        accountId: 'vip-account-1',
        entryType: 'FREEZE',
        amount: 2,
        status: 'FROZEN',
        refType: 'ORDER',
        refId: 'order-1',
        meta: { scheme: 'VIP_DIRECT_REFERRAL', accountType: 'VIP_REWARD' },
      },
    ]);
    tx.rewardAccount.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.voidRewardsForOrder('order-1'))
      .rejects.toThrow('奖励账户余额异常');

    expect(tx.rewardLedger.create).not.toHaveBeenCalled();
    expect(tx.rewardAccount.update).not.toHaveBeenCalled();
  });
});
