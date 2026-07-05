import { Prisma } from '@prisma/client';
import { FreezeExpireService } from './freeze-expire.service';

const directLedger = {
  id: 'ledger-direct-1',
  userId: 'inviter-1',
  accountId: 'vip-account-1',
  amount: 2,
  refId: 'order-1',
  meta: {
    scheme: 'VIP_DIRECT_REFERRAL',
    accountType: 'VIP_REWARD',
    sourceOrderId: 'order-1',
    sourceUserId: 'buyer-1',
    directInviterUserId: 'inviter-1',
  },
};

const normalDirectLedger = {
  id: 'ledger-normal-direct-1',
  userId: 'normal-inviter-1',
  accountId: 'normal-account-1',
  amount: 1,
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
    normalShareBindingId: 'normal-share-binding-1',
    relationStatus: 'ACTIVE',
    sourceRelation: 'NORMAL_SHARE_BINDING',
    configSnapshot: { NORMAL_DIRECT_REFERRAL_PERCENT: 0.01 },
    releaseCondition: 'ORDER_RECEIVED_RETURN_WINDOW_EXPIRED',
  },
};

function queryText(strings: TemplateStringsArray | string[]) {
  return Array.from(strings as any).join('');
}

function makeService(overrides: any = {}) {
  const tx = {
    order: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        status: 'RECEIVED',
        returnWindowExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    },
    afterSaleRequest: {
      findMany: jest.fn().mockResolvedValue([]),
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
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    afterSaleRequest: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  const bonusConfig = {
    getConfig: jest.fn().mockResolvedValue({
      vipFreezeDays: 7,
      normalFreezeDays: 7,
    }),
  };
  const notificationService = {
    send: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new FreezeExpireService(prisma as any, bonusConfig as any, notificationService as any),
    prisma,
    tx,
    notificationService,
  };
}

describe('FreezeExpireService notifications', () => {
  it('emits reward.expired inside the ledger Serializable transaction', async () => {
    const tx: any = {
      rewardLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'platform-ledger-1' }),
      },
      rewardAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'platform-account-1' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma: any = {
      $transaction: jest.fn(async (callback: any, options: any) => {
        await callback(tx);
        return options;
      }),
    };
    const notificationService = {
      send: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn().mockResolvedValue(undefined),
    };
    const service = new FreezeExpireService(
      prisma,
      { getConfig: jest.fn() } as any,
      notificationService as any,
    );

    await (service as any).expireSingleLedger({
      id: 'ledger-expired-1',
      userId: 'buyer-1',
      accountId: 'account-1',
      amount: 12.34,
      meta: { scheme: 'VIP_UPSTREAM' },
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'reward.expired',
      aggregateType: 'rewardLedger',
      aggregateId: 'ledger-expired-1',
      idempotencyKey: 'reward:ledger-expired-1:expired',
      actor: { kind: 'system' },
      payload: {
        ledgerId: 'ledger-expired-1',
        userId: 'buyer-1',
        amount: 12.34,
      },
    }, tx);
  });
});

describe('FreezeExpireService direct referral semantics', () => {
  it('excludes direct referral frozen ledgers from generic freeze expiration', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      return Promise.resolve(
        queryText(strings).includes("COALESCE(meta->>'scheme', '') NOT IN ('VIP_DIRECT_REFERRAL', 'NORMAL_DIRECT_REFERRAL')")
          ? []
          : [directLedger],
      );
    });

    await service.handleFreezeExpire();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    for (const call of prisma.$queryRaw.mock.calls) {
      expect(queryText(call[0])).toContain(
        "COALESCE(meta->>'scheme', '') NOT IN ('VIP_DIRECT_REFERRAL', 'NORMAL_DIRECT_REFERRAL')",
      );
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps received direct commission frozen before return window expiry', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValue([]);

    await service.handleVipDirectReferralRelease();

    expect(queryText(prisma.$queryRaw.mock.calls[0][0])).toContain(
      "rl.meta->>'scheme' IN ('VIP_DIRECT_REFERRAL', 'NORMAL_DIRECT_REFERRAL')",
    );
    expect(queryText(prisma.$queryRaw.mock.calls[0][0])).toContain(
      'o."returnWindowExpiresAt" < NOW()',
    );
    expect(prisma.afterSaleRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('releases received direct commission after return window expiry when no after-sale exists', async () => {
    const { service, prisma, tx } = makeService();
    prisma.$queryRaw.mockResolvedValue([directLedger]);
    prisma.afterSaleRequest.findMany.mockResolvedValue([]);

    await service.handleVipDirectReferralRelease();

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ledger-direct-1',
        status: 'FROZEN',
        entryType: 'FREEZE',
      },
      data: {
        status: 'AVAILABLE',
        entryType: 'RELEASE',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL',
          releasedAt: expect.any(String),
          releaseReason: 'RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
        }),
      },
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'vip-account-1', frozen: { gte: 2 } },
      data: { frozen: { decrement: 2 }, balance: { increment: 2 } },
    });
  });

  it('releases NORMAL_DIRECT_REFERRAL commission after return window expiry when no after-sale exists', async () => {
    const { service, prisma, tx } = makeService();
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
      Promise.resolve(
        queryText(strings).includes("'NORMAL_DIRECT_REFERRAL'")
          ? [normalDirectLedger]
          : [],
      ),
    );
    prisma.afterSaleRequest.findMany.mockResolvedValue([]);

    await service.handleVipDirectReferralRelease();

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ledger-normal-direct-1',
        status: 'FROZEN',
        entryType: 'FREEZE',
      },
      data: {
        status: 'AVAILABLE',
        entryType: 'RELEASE',
        meta: expect.objectContaining({
          scheme: 'NORMAL_DIRECT_REFERRAL',
          releasedAt: expect.any(String),
          releaseReason: 'RETURN_WINDOW_EXPIRED_NO_SUCCESS_AFTER_SALE',
          normalShareBindingId: 'normal-share-binding-1',
          relationStatus: 'ACTIVE',
          configSnapshot: { NORMAL_DIRECT_REFERRAL_PERCENT: 0.01 },
          releaseCondition: 'ORDER_RECEIVED_RETURN_WINDOW_EXPIRED',
        }),
      },
    });
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'normal-account-1', frozen: { gte: 1 } },
      data: { frozen: { decrement: 1 }, balance: { increment: 1 } },
    });
  });

  it('blocks direct commission release while any after-sale is active', async () => {
    const { service, prisma } = makeService();
    prisma.$queryRaw.mockResolvedValue([directLedger]);
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { orderId: 'order-1', status: 'REQUESTED' },
    ]);

    await service.handleVipDirectReferralRelease();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('releases direct commission when after-sales are terminal failures', async () => {
    const { service, prisma, tx } = makeService();
    prisma.$queryRaw.mockResolvedValue([directLedger]);
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { orderId: 'order-1', status: 'REJECTED' },
      { orderId: 'order-1', status: 'CANCELED' },
    ]);

    await service.handleVipDirectReferralRelease();

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'AVAILABLE', entryType: 'RELEASE' }),
    }));
    expect(tx.rewardLedger.create).not.toHaveBeenCalled();
  });

  it('voids direct commission to platform when a successful after-sale is found', async () => {
    const { service, prisma, tx } = makeService();
    prisma.$queryRaw.mockResolvedValue([directLedger]);
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { orderId: 'order-1', status: 'REFUNDED' },
    ]);

    await service.handleVipDirectReferralRelease();

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ledger-direct-1',
        status: 'FROZEN',
        entryType: 'FREEZE',
      },
      data: {
        status: 'VOIDED',
        entryType: 'VOID',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL',
          voidReason: 'SUCCESS_AFTER_SALE_BACKSTOP',
        }),
      },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'platform-account-1',
        userId: 'PLATFORM',
        entryType: 'RELEASE',
        amount: 2,
        status: 'AVAILABLE',
        refType: 'AFTER_SALE',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'VIP_DIRECT_REFERRAL_VOID',
          originalLedgerId: 'ledger-direct-1',
          originalReceiverUserId: 'inviter-1',
          sourceOrderId: 'order-1',
        }),
      }),
    });
    expect(tx.rewardAccount.update).toHaveBeenCalledWith({
      where: { id: 'platform-account-1' },
      data: { balance: { increment: 2 } },
    });
  });

  it('voids NORMAL_DIRECT_REFERRAL commission to platform with normal void scheme when a successful after-sale is found', async () => {
    const { service, prisma, tx } = makeService();
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
      Promise.resolve(
        queryText(strings).includes("'NORMAL_DIRECT_REFERRAL'")
          ? [normalDirectLedger]
          : [],
      ),
    );
    prisma.afterSaleRequest.findMany.mockResolvedValue([
      { orderId: 'order-1', status: 'REFUNDED' },
    ]);

    await service.handleVipDirectReferralRelease();

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ledger-normal-direct-1',
        status: 'FROZEN',
        entryType: 'FREEZE',
      },
      data: {
        status: 'VOIDED',
        entryType: 'VOID',
        meta: expect.objectContaining({
          scheme: 'NORMAL_DIRECT_REFERRAL',
          voidReason: 'SUCCESS_AFTER_SALE_BACKSTOP',
        }),
      },
    });
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'platform-account-1',
        userId: 'PLATFORM',
        entryType: 'RELEASE',
        amount: 1,
        status: 'AVAILABLE',
        refType: 'AFTER_SALE',
        refId: 'order-1',
        meta: expect.objectContaining({
          scheme: 'NORMAL_DIRECT_REFERRAL_VOID',
          originalScheme: 'NORMAL_DIRECT_REFERRAL',
          originalLedgerId: 'ledger-normal-direct-1',
          originalReceiverUserId: 'normal-inviter-1',
          sourceOrderId: 'order-1',
          sourceUserId: 'buyer-1',
          directInviterUserId: 'normal-inviter-1',
          inviterTierAtOrder: 'NORMAL',
          inviteeTierAtOrder: 'NORMAL',
          profit: 100,
          ratio: 0.01,
          directReferralPool: 1,
          sourceRelation: 'NORMAL_SHARE_BINDING',
          normalShareBindingId: 'normal-share-binding-1',
          relationStatus: 'ACTIVE',
          configSnapshot: { NORMAL_DIRECT_REFERRAL_PERCENT: 0.01 },
          releaseCondition: 'ORDER_RECEIVED_RETURN_WINDOW_EXPIRED',
        }),
      }),
    });
  });

  it('is idempotent when repeated release scans see an already processed ledger', async () => {
    const { service, prisma, tx } = makeService();
    prisma.$queryRaw.mockResolvedValue([directLedger]);
    prisma.afterSaleRequest.findMany.mockResolvedValue([]);
    tx.rewardLedger.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await service.handleVipDirectReferralRelease();
    await service.handleVipDirectReferralRelease();

    expect(tx.rewardLedger.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.rewardAccount.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['active', 'REQUESTED'],
    ['successful', 'REFUNDED'],
  ])('skips release when a %s after-sale appears inside the release transaction', async (_label, status) => {
    const { service, prisma, tx } = makeService();
    prisma.$queryRaw.mockResolvedValue([directLedger]);
    prisma.afterSaleRequest.findMany.mockResolvedValue([]);
    tx.afterSaleRequest.findMany.mockResolvedValue([{ orderId: 'order-1', status }]);

    await service.handleVipDirectReferralRelease();

    expect(tx.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      select: { status: true, returnWindowExpiresAt: true },
    });
    expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
    expect(tx.rewardAccount.updateMany).not.toHaveBeenCalled();
  });
});
