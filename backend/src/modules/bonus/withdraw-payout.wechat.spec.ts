import { Prisma } from '@prisma/client';
import { encryptJsonValue, decryptJsonValue } from '../../common/security/encryption';
import { WithdrawPayoutService } from './withdraw-payout.service';

const rules = {
  withdrawTaxRate: 0.2,
  withdrawMinAmount: 10,
  withdrawMaxAmount: 10000,
  withdrawDailyMaxCount: 3,
  withdrawCooldownSeconds: 60,
  withdrawYearlyMaxAmount: 50000,
  deductionRatioNormal: 0.1,
  deductionRatioVip: 0.15,
  deductionMinOrderAmount: 0,
  deductionAllowCouponStack: true,
  withdrawProviderFeeAmount: 0,
  withdrawYearlyAlertThreshold: 0.8,
};

const authContext = { sessionId: 'session-mini', authIdentityId: 'identity-mini' };
const trustedSession = {
  id: 'session-mini',
  userId: 'u1',
  authIdentityId: 'identity-mini',
  authIdentity: {
    id: 'identity-mini',
    userId: 'u1',
    provider: 'WECHAT',
    verified: true,
    appId: 'wx-mini-app',
    identifier: 'openid-session-bound',
  },
};

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    isAvailable: jest.fn().mockReturnValue(true),
    getMiniProgramAppId: jest.fn().mockReturnValue('wx-mini-app'),
    getMerchantId: jest.fn().mockReturnValue('1900000109'),
    assertTransferAmountSupported: jest.fn(),
    createTransfer: jest.fn().mockResolvedValue({
      outcome: 'FOUND',
      state: 'WAIT_USER_CONFIRM',
      outBillNo: 'unused',
      transferBillNo: 'wx-transfer-1',
      packageInfo: 'confirm-package',
    }),
    cancelTransfer: jest.fn().mockResolvedValue({ accepted: true }),
    queryTransfer: jest.fn(),
    ...overrides,
  } as any;
}

function buildService(options: {
  provider?: any;
  session?: any;
  existing?: any;
  prisma?: any;
} = {}) {
  let created: any;
  const prisma: any = options.prisma ?? {
    $transaction: jest.fn(async (fn: any, _txOptions?: any) => fn(prisma)),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{
      status: 'ACTIVE',
      deletionExecutedAt: null,
    }]),
    session: {
      findFirst: jest.fn().mockResolvedValue(options.session === undefined ? trustedSession : options.session),
    },
    withdrawRequest: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(options.existing ?? null),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        created = { ...data, userId: 'u1' };
        return created;
      }),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        created = { ...created, ...data };
        return created;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    wechatTransferNotifyInbox: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rewardAccount: {
      findUnique: jest.fn()
        .mockResolvedValueOnce({ id: 'vip-1', userId: 'u1', type: 'VIP_REWARD', balance: 100, frozen: 0 })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rewardLedger: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    groupBuyRebateAccount: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    groupBuyRebateLedger: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    companyStaff: { findFirst: jest.fn().mockResolvedValue(null) },
    adminUser: { findMany: jest.fn().mockResolvedValue([]) },
    adminAuditLog: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const provider = options.provider ?? makeProvider();
  const rulesService = { getRules: jest.fn().mockResolvedValue(rules) };
  const notificationService = { emit: jest.fn().mockResolvedValue(undefined) };
  const alipayService = { queryTransfer: jest.fn() };
  const moduleRef = {
    get: jest.fn((token: any) => token?.name === 'AlipayService'
      ? alipayService
      : { initiateTransfer: jest.fn() }),
  };
  const redisCoordinator = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const service = new WithdrawPayoutService(
    prisma,
    rulesService as any,
    notificationService as any,
    moduleRef as any,
    redisCoordinator as any,
    provider,
  );
  return {
    service,
    prisma,
    provider,
    notificationService,
    redisCoordinator,
    getCreated: () => created,
  };
}

describe('WithdrawPayoutService WeChat merchant transfer', () => {
  it('rejects a session whose exact auth identity is not verified for the miniapp AppID', async () => {
    const { service, prisma, provider } = buildService({
      session: {
        ...trustedSession,
        authIdentity: { ...trustedSession.authIdentity, appId: 'another-app' },
      },
    });

    await expect(service.requestWithdraw(
      'u1',
      { amount: 100, channel: 'wechat' },
      'wechat-wrong-identity',
      authContext,
    )).rejects.toThrow('当前会话未绑定可信的小程序微信身份');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(provider.createTransfer).not.toHaveBeenCalled();
  });

  it('rejects known unsupported large transfer before freezing any wallet balance', async () => {
    const provider = makeProvider({
      assertTransferAmountSupported: jest.fn(() => {
        throw new Error('微信大额提现实名校验尚未就绪');
      }),
    });
    const { service, prisma } = buildService({ provider });

    await expect(service.requestWithdraw(
      'u1',
      { amount: 2_500, channel: 'wechat' },
      'wechat-large-no-kyc',
      authContext,
    )).rejects.toThrow('微信大额提现实名校验尚未就绪');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });

  it('freezes the unified wallet in Serializable and returns only server-derived confirmation params', async () => {
    const { service, prisma, provider, getCreated } = buildService();

    const result = await service.requestWithdraw(
      'u1',
      { amount: 100, channel: 'wechat' },
      'wechat-wait-confirm',
      authContext,
    );

    expect(result).toMatchObject({
      grossAmount: 100,
      taxAmount: 20,
      netAmount: 80,
      status: 'PROCESSING',
      mchId: '1900000109',
      appId: 'wx-mini-app',
      package: 'confirm-package',
    });
    const created = getCreated();
    expect(created.outBizNo).toMatch(/^WX[A-Za-z0-9]{30}$/);
    expect(created.outBizNo).toHaveLength(32);
    expect(decryptJsonValue(created.accountSnapshot)).toMatchObject({
      account: 'openid-session-bound',
      appId: 'wx-mini-app',
      channel: 'WECHAT',
      source: 'UNIFIED_POINTS',
    });
    expect(provider.createTransfer).toHaveBeenCalledWith({
      outBillNo: created.outBizNo,
      openId: 'openid-session-bound',
      amountFen: 8_000,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('returns the same WAIT_USER_CONFIRM request on an identical retry without a second transfer', async () => {
    const provider = makeProvider();
    const existing = {
      id: 'withdraw-existing',
      userId: 'u1',
      amount: 100,
      taxAmount: 20,
      taxRate: 0.2,
      netAmount: 80,
      status: 'PROCESSING',
      channel: 'WECHAT',
      providerStatus: 'WAIT_USER_CONFIRM',
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound',
        appId: 'wx-mini-app',
        channel: 'WECHAT',
        source: 'UNIFIED_POINTS',
        packageInfo: 'saved-confirm-package',
      }),
    };
    const { service, prisma } = buildService({ existing, provider });

    await expect(service.requestWithdraw(
      'u1',
      { amount: 100, channel: 'wechat' },
      'wechat-same-key',
      authContext,
    )).resolves.toMatchObject({
      withdrawId: 'withdraw-existing',
      status: 'PROCESSING',
      mchId: '1900000109',
      appId: 'wx-mini-app',
      package: 'saved-confirm-package',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(provider.createTransfer).not.toHaveBeenCalled();
  });

  it('keeps funds frozen when create plus same-number query are UNKNOWN/404', async () => {
    const provider = makeProvider({
      createTransfer: jest.fn().mockResolvedValue({
        outcome: 'UNKNOWN',
        outBillNo: 'same-number',
        errorCode: 'NOT_FOUND_AFTER_UNKNOWN_CREATE',
      }),
    });
    const { service, prisma } = buildService({ provider });

    await expect(service.requestWithdraw(
      'u1',
      { amount: 100, channel: 'wechat' },
      'wechat-unknown',
      authContext,
    )).resolves.toMatchObject({ status: 'PROCESSING' });
    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'PROCESSING' }),
      data: expect.not.objectContaining({ status: 'FAILED' }),
    }));
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerStatus: 'UNKNOWN',
        providerErrorCode: 'NOT_FOUND_AFTER_UNKNOWN_CREATE',
      }),
    }));
  });

  it('finalizes SUCCESS only after all queried identity and amount fields match', async () => {
    const withdraw = {
      id: 'withdraw-success',
      userId: 'u1',
      channel: 'WECHAT',
      outBizNo: 'WX123456789012345678901234567890',
      netAmount: 80,
      amount: 100,
      taxAmount: 20,
      status: 'PROCESSING',
      providerPayoutId: 'wx-transfer-success',
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'SUCCESS', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-success',
        openId: 'openid-session-bound', amountFen: 8_000,
      }),
    });
    const { service, prisma } = buildService({ provider, existing: withdraw });
    prisma.withdrawRequest.findUnique.mockResolvedValue(withdraw);
    prisma.withdrawRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.withdrawRequest.findUnique.mockResolvedValue(withdraw);

    await service.handleWechatTransferNotify({
      eventId: 'event-success',
      outBillNo: withdraw.outBizNo,
      transferBillNo: 'wx-transfer-success',
      state: 'SUCCESS',
      mchId: '1900000109',
      openId: 'openid-session-bound',
      amountFen: 8_000,
    });

    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: withdraw.id, status: 'PROCESSING' },
      data: expect.objectContaining({ status: 'PAID', providerStatus: 'SUCCESS' }),
    }));
  });

  it('rejects callback identity mismatch without changing the withdrawal', async () => {
    const withdraw = {
      id: 'withdraw-mismatch', userId: 'u1', channel: 'WECHAT',
      outBizNo: 'WX123456789012345678901234567890', netAmount: 80,
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'SUCCESS', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-wrong',
        openId: 'attacker-openid', amountFen: 8_000,
      }),
    });
    const { service, prisma } = buildService({ provider, existing: withdraw });

    await expect(service.handleWechatTransferNotify({
      eventId: 'event-mismatch',
      outBillNo: withdraw.outBizNo,
      transferBillNo: 'wx-transfer-wrong',
      state: 'SUCCESS',
      mchId: '1900000109',
      openId: 'attacker-openid',
      amountFen: 8_000,
    })).rejects.toThrow('微信提现订单身份或金额不匹配');
    expect(prisma.withdrawRequest.updateMany).not.toHaveBeenCalled();
  });

  it('refunds FAIL only once when the same terminal callback is delivered repeatedly', async () => {
    const withdraw = {
      id: 'withdraw-fail', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: 'wx-transfer-fail',
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    let firstCas = true;
    const prisma: any = {
      withdrawRequest: {
        findUnique: jest.fn().mockResolvedValue(withdraw),
        updateMany: jest.fn().mockImplementation(async () => {
          if (!firstCas) return { count: 0 };
          firstCas = false;
          return { count: 1 };
        }),
      },
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue([{ accountId: 'vip-1', userId: 'u1', amount: 100, account: { type: 'VIP_REWARD' } }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rewardAccount: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      groupBuyRebateLedger: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      groupBuyRebateAccount: { updateMany: jest.fn() },
      adminUser: { findMany: jest.fn().mockResolvedValue([]) },
      adminAuditLog: { createMany: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'FAIL', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-fail',
        openId: 'openid-session-bound', amountFen: 8_000, failReason: 'REAL_NAME_CHECK_FAIL',
      }),
    });
    const { service, notificationService } = buildService({ prisma, provider });
    const notify = {
      eventId: 'event-fail',
      outBillNo: withdraw.outBizNo,
      transferBillNo: 'wx-transfer-fail',
      state: 'FAIL' as const,
      mchId: '1900000109',
      openId: 'openid-session-bound',
      amountFen: 8_000,
    };

    await service.handleWechatTransferNotify(notify);
    await service.handleWechatTransferNotify(notify);

    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledTimes(1);
    expect(notificationService.emit).toHaveBeenCalledTimes(1);
  });

  it('dispatches Cron by channel and never asks Alipay to query a WeChat withdrawal', async () => {
    const withdraw = {
      id: 'withdraw-cron', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: 'wx-transfer-cron',
      queryAttempts: 20,
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({ outcome: 'NOT_FOUND', outBillNo: withdraw.outBizNo }),
    });
    const { service, prisma, redisCoordinator } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);
    const resolveAlipay = jest.spyOn(service as any, 'resolveAlipayService');

    await service.retryProcessingWithdrawals();

    expect(provider.queryTransfer).toHaveBeenCalledWith(withdraw.outBizNo);
    expect(resolveAlipay).not.toHaveBeenCalled();
    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: withdraw.id, status: 'PROCESSING' }),
      data: expect.objectContaining({
        nextReconcileAt: expect.any(Date),
        queryAttempts: { increment: 1 },
      }),
    }));
    expect(redisCoordinator.releaseLock).toHaveBeenCalled();
  });

  it('cancels the original bill and never returns an unpersisted confirmation package', async () => {
    const provider = makeProvider();
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.updateMany
      .mockResolvedValueOnce({ count: 1 }) // READY -> CREATING
      .mockRejectedValueOnce(new Error('database unavailable')) // package persistence
      .mockResolvedValueOnce({ count: 1 }); // recovery marker

    const result = await service.requestWithdraw(
      'u1',
      { amount: 100, channel: 'wechat' },
      'wechat-package-persist-failure',
      authContext,
    );

    expect(result).toMatchObject({ status: 'PROCESSING' });
    expect(result).not.toHaveProperty('package');
    expect(provider.cancelTransfer).toHaveBeenCalledWith(expect.stringMatching(/^WX[A-Za-z0-9]{30}$/));
    expect(prisma.withdrawRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerStatus: 'RECOVERY_CANCEL_REQUESTED' }),
    }));
  });

  it('Cron cancels WAIT_USER_CONFIRM when the one-time package was never persisted', async () => {
    const withdraw = {
      id: 'withdraw-lost-package', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'CREATING', queryAttempts: 1,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: null,
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'WAIT_USER_CONFIRM', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-lost-package',
        openId: 'openid-session-bound', amountFen: 8_000,
      }),
    });
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(provider.cancelTransfer).toHaveBeenCalledWith(withdraw.outBizNo);
    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerStatus: 'RECOVERY_CANCEL_REQUESTED' }),
    }));
  });

  it('replays the same outBillNo only after a definitive NOT_FOUND recovery query', async () => {
    const withdraw = {
      id: 'withdraw-ready', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'READY', queryAttempts: 1,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: null,
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({ outcome: 'NOT_FOUND', outBillNo: withdraw.outBizNo }),
      createTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'WAIT_USER_CONFIRM', outBillNo: withdraw.outBizNo,
        transferBillNo: 'wx-transfer-recovered', packageInfo: 'recovered-package',
      }),
    });
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(provider.createTransfer).toHaveBeenCalledWith({
      outBillNo: withdraw.outBizNo,
      openId: 'openid-session-bound',
      amountFen: 8_000,
    });
    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerStatus: 'WAIT_USER_CONFIRM' }),
    }));
  });

  it('never replays create while a READY recovery query is UNKNOWN', async () => {
    const withdraw = {
      id: 'withdraw-ready-unknown', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'READY', queryAttempts: 1,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: null,
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'UNKNOWN', outBillNo: withdraw.outBizNo, errorCode: 'NETWORK_TIMEOUT',
      }),
    });
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(provider.createTransfer).not.toHaveBeenCalled();
    expect(provider.cancelTransfer).not.toHaveBeenCalled();
  });

  it('alerts after bounded UNKNOWN queries but keeps the frozen withdrawal PROCESSING', async () => {
    const withdraw = {
      id: 'withdraw-ready-unknown-stuck', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'READY', queryAttempts: 11,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: null,
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'UNKNOWN', outBillNo: withdraw.outBizNo, errorCode: 'NETWORK_TIMEOUT',
      }),
    });
    const { service, prisma, notificationService } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(provider.createTransfer).not.toHaveBeenCalled();
    expect(provider.cancelTransfer).not.toHaveBeenCalled();
    expect(prisma.withdrawRequest.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(notificationService.emit).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'withdraw.wechatStuck',
      idempotencyKey: `withdraw:${withdraw.id}:wechat-stuck`,
      payload: expect.objectContaining({ providerState: 'UNKNOWN', attempts: 12 }),
    }));
  });

  it('does not settle a Cron query whose official optional openid is absent', async () => {
    const withdraw = {
      id: 'withdraw-no-query-openid', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'PROCESSING', queryAttempts: 1,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: 'wx-transfer-no-openid',
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'SUCCESS', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-no-openid', amountFen: 8_000,
      }),
    });
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(prisma.withdrawRequest.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PAID' }),
    }));
    expect(provider.cancelTransfer).not.toHaveBeenCalled();
  });

  it('does not cancel or overwrite a fresh CREATING owner during manual/Cron reconciliation', async () => {
    const withdraw = {
      id: 'withdraw-fresh-creating', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'CREATING', providerStateUpdatedAt: new Date(), queryAttempts: 1,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: null,
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'WAIT_USER_CONFIRM', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-fresh',
        openId: 'openid-session-bound', amountFen: 8_000,
      }),
    });
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(provider.cancelTransfer).not.toHaveBeenCalled();
    expect(provider.createTransfer).not.toHaveBeenCalled();
    expect(prisma.withdrawRequest.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerStatus: 'WAIT_USER_CONFIRM' }),
    }));
  });

  it('never returns package_info when the CREATING CAS owner has already changed', async () => {
    const provider = makeProvider();
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.updateMany
      .mockResolvedValueOnce({ count: 1 }) // READY -> CREATING
      .mockResolvedValueOnce({ count: 0 }); // another reconciler changed providerStatus

    const result = await service.requestWithdraw(
      'u1',
      { amount: 100, channel: 'wechat' },
      'wechat-package-owner-fenced',
      authContext,
    );

    expect(result).toMatchObject({ status: 'PROCESSING' });
    expect(result).not.toHaveProperty('package');
  });

  it('retries ACCEPTED with the exact same bill, amount, and OpenID only at a bounded attempt', async () => {
    const withdraw = {
      id: 'withdraw-accepted', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'ACCEPTED', queryAttempts: 2,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: 'wx-transfer-accepted',
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'ACCEPTED', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-accepted',
        openId: 'openid-session-bound', amountFen: 8_000,
      }),
      createTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'PROCESSING', outBillNo: withdraw.outBizNo,
        transferBillNo: 'wx-transfer-accepted',
      }),
    });
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(provider.createTransfer).toHaveBeenCalledTimes(1);
    expect(provider.createTransfer).toHaveBeenCalledWith({
      outBillNo: withdraw.outBizNo,
      openId: 'openid-session-bound',
      amountFen: 8_000,
    });
  });

  it('requests cancellation and alerts after bounded PROCESSING retries without refunding early', async () => {
    const withdraw = {
      id: 'withdraw-processing-stuck', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'PROCESSING', queryAttempts: 11,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: 'wx-transfer-stuck',
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'PROCESSING', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-stuck',
        openId: 'openid-session-bound', amountFen: 8_000,
      }),
      cancelTransfer: jest.fn().mockResolvedValue({
        accepted: true, outBillNo: withdraw.outBizNo,
        transferBillNo: 'wx-transfer-stuck', state: 'CANCELING',
      }),
    });
    const { service, prisma, notificationService } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(provider.createTransfer).not.toHaveBeenCalled();
    expect(provider.cancelTransfer).toHaveBeenCalledWith(withdraw.outBizNo);
    expect(prisma.withdrawRequest.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(notificationService.emit).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'withdraw.wechatStuck',
      idempotencyKey: `withdraw:${withdraw.id}:wechat-stuck`,
    }));
  });

  it('claims recovery ownership before the external cancel call can race package persistence', async () => {
    const withdraw = {
      id: 'withdraw-race-claim', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'CREATING',
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: null,
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    let resolveCancel!: (value: any) => void;
    const cancelFlight = new Promise((resolve) => { resolveCancel = resolve; });
    const provider = makeProvider({ cancelTransfer: jest.fn().mockReturnValue(cancelFlight) });
    const { service, prisma } = buildService({ provider });
    let providerStatus = 'CREATING';
    prisma.withdrawRequest.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.providerStatus && where.providerStatus !== providerStatus) return { count: 0 };
      providerStatus = data.providerStatus;
      return { count: 1 };
    });

    const recovery = (service as any).recoverUnconfirmableWechatTransfer(withdraw, {
      transferBillNo: 'wx-transfer-race', reason: 'PACKAGE_UNAVAILABLE',
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(providerStatus).toBe('RECOVERY_CANCEL_CLAIMED');

    const staleCreatorPersisted = await (service as any).markWechatProcessingProviderInfo(
      { ...withdraw, providerStatus: 'CREATING' },
      { state: 'WAIT_USER_CONFIRM', transferBillNo: 'wx-transfer-race', packageInfo: 'stale-package' },
    );
    expect(staleCreatorPersisted).toBe(false);

    resolveCancel({
      accepted: true, outBillNo: withdraw.outBizNo,
      transferBillNo: 'wx-transfer-race', state: 'CANCELING',
    });
    await recovery;
    expect(providerStatus).toBe('RECOVERY_CANCEL_REQUESTED');
  });

  it('retries a pending recovery cancel with the same bill at a bounded attempt', async () => {
    const withdraw = {
      id: 'withdraw-cancel-pending', userId: 'u1', channel: 'WECHAT', amount: 100, netAmount: 80,
      status: 'PROCESSING', providerStatus: 'RECOVERY_CANCEL_PENDING', queryAttempts: 2,
      outBizNo: 'WX123456789012345678901234567890', providerPayoutId: 'wx-transfer-pending',
      accountSnapshot: encryptJsonValue({
        account: 'openid-session-bound', appId: 'wx-mini-app', channel: 'WECHAT', source: 'UNIFIED_POINTS',
      }),
    };
    const provider = makeProvider({
      queryTransfer: jest.fn().mockResolvedValue({
        outcome: 'FOUND', state: 'WAIT_USER_CONFIRM', mchId: '1900000109', appId: 'wx-mini-app',
        outBillNo: withdraw.outBizNo, transferBillNo: 'wx-transfer-pending',
        openId: 'openid-session-bound', amountFen: 8_000,
      }),
      cancelTransfer: jest.fn().mockResolvedValue({
        accepted: true, outBillNo: withdraw.outBizNo,
        transferBillNo: 'wx-transfer-pending', state: 'CANCELING',
      }),
    });
    const { service, prisma } = buildService({ provider });
    prisma.withdrawRequest.findMany.mockResolvedValue([withdraw]);

    await service.retryProcessingWithdrawals();

    expect(provider.cancelTransfer).toHaveBeenCalledTimes(1);
    expect(provider.cancelTransfer).toHaveBeenCalledWith(withdraw.outBizNo);
  });

  it('dead-letters a permanently failing notify so it cannot starve newer events', async () => {
    const row = {
      id: 'inbox-dead', eventId: 'durable-event-dead', outBillNo: 'WX123456789012345678901234567890',
      attempts: 8,
      payload: encryptJsonValue({
        eventId: 'durable-event-dead', outBillNo: 'WX123456789012345678901234567890',
        transferBillNo: 'wx-transfer-dead', state: 'SUCCESS', mchId: '1900000109',
        openId: 'openid-session-bound', amountFen: 8_000,
      }),
    };
    const { service, prisma, notificationService } = buildService();
    prisma.wechatTransferNotifyInbox.findUnique.mockResolvedValue(row);
    jest.spyOn(service, 'handleWechatTransferNotify').mockRejectedValue(new Error('permanent poison'));

    await expect(service.processWechatTransferNotifyInbox(row.eventId)).rejects.toThrow('permanent poison');

    expect(prisma.wechatTransferNotifyInbox.updateMany).toHaveBeenLastCalledWith({
      where: { eventId: row.eventId, status: 'PROCESSING' },
      data: expect.objectContaining({ status: 'DEAD', deadAt: expect.any(Date) }),
    });
    expect(notificationService.emit).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'withdraw.wechatNotifyDead',
    }));
  });

  it('persists a verified notify before CAS-consuming it from the durable inbox', async () => {
    let saved: any;
    const { service, prisma } = buildService();
    prisma.wechatTransferNotifyInbox.findUnique.mockImplementation(async () => saved);
    prisma.wechatTransferNotifyInbox.create.mockImplementation(async ({ data }: any) => {
      saved = { id: 'inbox-1', ...data };
      return saved;
    });
    const handle = jest.spyOn(service, 'handleWechatTransferNotify').mockResolvedValue(undefined);
    const notify = {
      eventId: 'durable-event-1',
      outBillNo: 'WX123456789012345678901234567890',
      transferBillNo: 'wx-transfer-durable',
      state: 'SUCCESS' as const,
      mchId: '1900000109',
      openId: 'openid-session-bound',
      amountFen: 8_000,
    };

    await expect(service.enqueueWechatTransferNotify(notify)).resolves.toBe('durable-event-1');
    await service.processWechatTransferNotifyInbox('durable-event-1');

    expect(decryptJsonValue(saved.payload)).toEqual(notify);
    expect(handle).toHaveBeenCalledWith(notify);
    expect(prisma.wechatTransferNotifyInbox.updateMany).toHaveBeenLastCalledWith({
      where: { eventId: 'durable-event-1', status: 'PROCESSING' },
      data: expect.objectContaining({ status: 'DONE', processedAt: expect.any(Date) }),
    });
  });
});
