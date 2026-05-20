import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decryptJsonValue } from '../../common/security/encryption';
import { WithdrawPayoutService } from './withdraw-payout.service';

const makeRules = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

function buildService(overrides: {
  prisma?: any;
  rulesService?: any;
  inboxService?: any;
  paymentService?: any;
  alipayService?: any;
  redisCoordinator?: any;
} = {}) {
  let prisma: any = overrides.prisma;
  if (!prisma) {
    prisma = {
      $transaction: jest.fn(async (fn: any, _options?: any): Promise<any> => fn(prisma)),
      rewardAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      withdrawRequest: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rewardLedger: {
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      adminUser: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      adminAuditLog: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }
  const rulesService = overrides.rulesService ?? {
    getRules: jest.fn().mockResolvedValue(makeRules()),
  };
  const inboxService = overrides.inboxService ?? {
    send: jest.fn().mockResolvedValue(undefined),
  };
  const paymentService = overrides.paymentService ?? {
    initiateTransfer: jest.fn().mockResolvedValue({
      success: true,
      processing: false,
      providerOrderId: 'po-1',
      providerFundOrderId: 'pf-1',
    }),
  };
  const alipayService = overrides.alipayService ?? {
    queryTransfer: jest.fn(),
  };
  const redisCoordinator = overrides.redisCoordinator ?? {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  };
  const moduleRef = {
    get: jest.fn((token: any) => {
      const tokenName = token?.name ?? token;
      if (tokenName === 'AlipayService') return alipayService;
      return paymentService;
    }),
  };
  const service = new WithdrawPayoutService(
    prisma,
    rulesService,
    inboxService,
    moduleRef as any,
    redisCoordinator,
  );
  (service as any).paymentService = paymentService;
  (service as any).alipayService = alipayService;
  (service as any).redisCoordinator = redisCoordinator;
  return { service, prisma, rulesService, inboxService, paymentService, alipayService, redisCoordinator };
}

describe('WithdrawPayoutService.requestWithdraw', () => {
  it('rejects amounts outside configured min/max using cents math', async () => {
    const { service } = buildService();

    await expect(service.requestWithdraw('u1', {
      amount: 9.99,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-min')).rejects.toThrow(BadRequestException);

    await expect(service.requestWithdraw('u1', {
      amount: 10000.01,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-max')).rejects.toThrow(BadRequestException);
  });

  it('rejects repeated idempotency key when the existing request differs', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-1',
      userId: 'u1',
      amount: 100,
      taxAmount: 20,
      taxRate: 0.2,
      netAmount: 80,
      status: 'PAID',
      accountSnapshot: { account: 'old@example.com', name: '张三' },
    });

    await expect(service.requestWithdraw('u1', {
      amount: 100,
      alipayAccount: 'new@example.com',
      alipayName: '张三',
    }, 'same-key')).rejects.toThrow(ConflictException);
  });

  it('returns the existing request for identical idempotency retries', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-1',
      userId: 'u1',
      amount: 100,
      taxAmount: 20,
      taxRate: 0.2,
      netAmount: 80,
      status: 'PAID',
      accountSnapshot: { account: 'a@example.com', name: '张三' },
    });

    const result = await service.requestWithdraw('u1', {
      amount: 100,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'same-key');

    expect(result).toMatchObject({
      withdrawId: 'w-1',
      grossAmount: 100,
      taxAmount: 20,
      netAmount: 80,
      status: 'PAID',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns the existing request when concurrent retries hit the idempotency unique constraint', async () => {
    const { service, prisma, paymentService } = buildService();
    prisma.withdrawRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'w-1',
        userId: 'u1',
        amount: 100,
        taxAmount: 20,
        taxRate: 0.2,
        netAmount: 80,
        status: 'PROCESSING',
        accountSnapshot: { account: 'a@example.com', name: '张三' },
      });
    prisma.$transaction.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));

    const result = await service.requestWithdraw('u1', {
      amount: 100,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'race-key');

    expect(result).toMatchObject({
      withdrawId: 'w-1',
      grossAmount: 100,
      status: 'PROCESSING',
    });
    expect(paymentService.initiateTransfer).not.toHaveBeenCalled();
  });

  it('rejects when the shared reward balance is insufficient', async () => {
    const { service, prisma } = buildService();
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'acc-vip', userId: 'u1', type: 'VIP_REWARD', balance: 20, frozen: 0 })
      .mockResolvedValueOnce({ id: 'acc-normal', userId: 'u1', type: 'NORMAL_REWARD', balance: 30, frozen: 0 });

    await expect(service.requestWithdraw('u1', {
      amount: 60,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-insufficient')).rejects.toThrow(BadRequestException);
  });

  it('enforces daily count, cooldown, and yearly cap limits inside the Serializable transaction', async () => {
    const daily = buildService();
    daily.prisma.withdrawRequest.count.mockResolvedValueOnce(3);
    await expect(daily.service.requestWithdraw('u1', {
      amount: 20,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-daily')).rejects.toThrow('每日最多提现');

    const cooldown = buildService();
    cooldown.prisma.withdrawRequest.findFirst.mockResolvedValueOnce({ id: 'w-last' });
    await expect(cooldown.service.requestWithdraw('u1', {
      amount: 20,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-cooldown')).rejects.toThrow('冷却时间未到');

    const yearly = buildService();
    yearly.prisma.withdrawRequest.aggregate.mockResolvedValueOnce({ _sum: { amount: 49990 } });
    await expect(yearly.service.requestWithdraw('u1', {
      amount: 20,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-yearly')).rejects.toThrow('年累计提现已达上限');
  });

  it('freezes VIP balance before NORMAL balance, writes split ledgers, encrypts account snapshot, and finalizes paid', async () => {
    const { service, prisma, paymentService } = buildService();
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'acc-vip', userId: 'u1', type: 'VIP_REWARD', balance: 30, frozen: 0 })
      .mockResolvedValueOnce({ id: 'acc-normal', userId: 'u1', type: 'NORMAL_REWARD', balance: 100, frozen: 0 });
    prisma.withdrawRequest.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      createdAt: new Date('2026-05-20T00:00:00.000Z'),
      updatedAt: new Date('2026-05-20T00:00:00.000Z'),
    }));
    prisma.withdrawRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'w-1',
        userId: 'u1',
        amount: 80,
        taxAmount: 16,
        netAmount: 64,
        taxRate: 0.2,
        status: 'PAID',
      });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-vip', amount: 30 },
      { accountId: 'acc-normal', amount: 50 },
    ]);

    const result = await service.requestWithdraw('u1', {
      amount: 80,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-1');

    expect(result).toMatchObject({
      grossAmount: 80,
      taxAmount: 16,
      netAmount: 64,
      status: 'PAID',
    });
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-vip', balance: { gte: 30 } },
      data: { balance: { decrement: 30 }, frozen: { increment: 30 } },
    }));
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-normal', balance: { gte: 50 } },
      data: { balance: { decrement: 50 }, frozen: { increment: 50 } },
    }));
    expect(prisma.rewardLedger.create).toHaveBeenCalledTimes(2);
    expect(prisma.withdrawRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountType: 'VIP_REWARD',
        amount: 80,
        taxAmount: 16,
        netAmount: 64,
        providerFeeAmount: 0,
        status: 'PROCESSING',
        clientIdempotencyKey: 'idemp-1',
      }),
    }));
    const createData = prisma.withdrawRequest.create.mock.calls[0][0].data;
    expect(decryptJsonValue(createData.accountSnapshot)).toEqual({
      account: 'a@example.com',
      name: '张三',
    });
    expect(paymentService.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'ALIPAY',
      amount: 64,
      outBizNo: createData.outBizNo,
      payeeAccount: 'a@example.com',
      payeeRealName: '张三',
    }));
    expect(createData.outBizNo).toMatch(/^WD-/);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('keeps PROCESSING and stores provider info when provider result is uncertain', async () => {
    const paymentService = {
      initiateTransfer: jest.fn().mockResolvedValue({
        success: false,
        processing: true,
        providerStatus: 'UNKNOWN',
        errorCode: 'SYSTEM_ERROR',
        errorMessage: '系统错误',
      }),
    };
    const { service, prisma } = buildService({ paymentService });
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'acc-vip', userId: 'u1', type: 'VIP_REWARD', balance: 100, frozen: 0 })
      .mockResolvedValueOnce(null);
    prisma.withdrawRequest.create.mockImplementation(async ({ data }: any) => data);

    const result = await service.requestWithdraw('u1', {
      amount: 20,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-processing');

    expect(result.status).toBe('PROCESSING');
    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerStatus: 'UNKNOWN',
        providerErrorCode: 'SYSTEM_ERROR',
      }),
    }));
  });

  it('keeps PROCESSING when the provider call throws after balance freeze', async () => {
    const paymentService = {
      initiateTransfer: jest.fn().mockRejectedValue(new Error('network timeout')),
    };
    const { service, prisma } = buildService({ paymentService });
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'acc-vip', userId: 'u1', type: 'VIP_REWARD', balance: 100, frozen: 0 })
      .mockResolvedValueOnce(null);
    prisma.withdrawRequest.create.mockImplementation(async ({ data }: any) => data);

    const result = await service.requestWithdraw('u1', {
      amount: 20,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'idemp-throw');

    expect(result.status).toBe('PROCESSING');
    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerStatus: 'UNKNOWN',
        providerErrorCode: 'PROVIDER_EXCEPTION',
        providerErrorMessage: 'network timeout',
      }),
    }));
  });
});

describe('WithdrawPayoutService.finalize', () => {
  it('marks a processing withdrawal paid, releases frozen balances, and sends inbox notification', async () => {
    const rulesService = {
      getRules: jest.fn().mockResolvedValue(makeRules({ withdrawYearlyAlertThreshold: 0.8 })),
    };
    const { service, prisma, inboxService } = buildService({ rulesService });
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-1',
      userId: 'u1',
      amount: 100,
      netAmount: 64,
      taxAmount: 16,
    });
    prisma.withdrawRequest.aggregate.mockResolvedValue({ _sum: { amount: 41000 } });
    prisma.adminUser.findMany.mockResolvedValue([{ id: 'admin-1' }]);
    prisma.adminAuditLog.createMany.mockResolvedValue({ count: 1 });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-vip', amount: 30 },
      { accountId: 'acc-normal', amount: 50 },
    ]);

    await service.finalizeWithdrawalPaid('w-1', {
      providerOrderId: 'po-1',
      providerFundOrderId: 'pf-1',
      providerStatus: 'SUCCESS',
    });

    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'w-1', status: 'PROCESSING' },
      data: expect.objectContaining({
        status: 'PAID',
        providerPayoutId: 'po-1',
        providerFundOrderId: 'pf-1',
        providerStatus: 'SUCCESS',
        paidAt: expect.any(Date),
      }),
    }));
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { refType: 'WITHDRAW', refId: 'w-1', status: 'FROZEN' },
      data: { status: 'WITHDRAWN' },
    }));
    expect(inboxService.send).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      type: 'withdraw_paid',
    }));
    await new Promise(process.nextTick);
    expect(rulesService.getRules).toHaveBeenCalled();
    expect(prisma.adminAuditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        adminUserId: 'admin-1',
        module: 'bonus',
        summary: '高额提现告警',
      })],
    }));
  });

  it('marks a processing withdrawal failed, restores each split balance, voids ledgers, and sends inbox notification', async () => {
    const { service, prisma, inboxService } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-1',
      userId: 'u1',
      amount: 80,
    });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-vip', amount: 30 },
      { accountId: 'acc-normal', amount: 50 },
    ]);

    await service.finalizeWithdrawalFailed('w-1', {
      errorCode: 'PAYEE_NOT_EXIST',
      errorMessage: '收款账户不存在',
      providerStatus: 'FAIL',
    });

    expect(prisma.withdrawRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'w-1', status: 'PROCESSING' },
      data: expect.objectContaining({
        status: 'FAILED',
        providerErrorCode: 'PAYEE_NOT_EXIST',
        providerErrorMessage: '收款账户不存在',
        providerStatus: 'FAIL',
      }),
    }));
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-vip', frozen: { gte: 30 } },
      data: { frozen: { decrement: 30 }, balance: { increment: 30 } },
    }));
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-normal', frozen: { gte: 50 } },
      data: { frozen: { decrement: 50 }, balance: { increment: 50 } },
    }));
    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { refType: 'WITHDRAW', refId: 'w-1', status: 'FROZEN' },
      data: { status: 'VOIDED', entryType: 'VOID' },
    }));
    expect(inboxService.send).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      type: 'withdraw_failed',
    }));
  });

  it('short-circuits repeated finalize calls through PROCESSING CAS', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.updateMany.mockResolvedValue({ count: 0 });

    await service.finalizeWithdrawalPaid('w-1', { providerOrderId: 'po-1' });

    expect(prisma.rewardLedger.findMany).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
  });
});

describe('WithdrawPayoutService.retryProcessingWithdrawals', () => {
  it('uses a Redis lock, increments query attempts first, and finalizes stale PROCESSING withdrawals by Alipay query result', async () => {
    const { service, prisma, alipayService, redisCoordinator } = buildService();
    prisma.withdrawRequest.findMany.mockResolvedValue([
      { id: 'w-success', outBizNo: 'WD-success', queryAttempts: 0 },
      { id: 'w-fail', outBizNo: 'WD-fail', queryAttempts: 1 },
      { id: 'w-not-found', outBizNo: 'WD-not-found', queryAttempts: 9 },
    ]);
    alipayService.queryTransfer
      .mockResolvedValueOnce({
        status: 'SUCCESS',
        orderId: 'po-success',
        payFundOrderId: 'pf-success',
      })
      .mockResolvedValueOnce({
        status: 'FAIL',
        errorCode: 'PAYEE_NOT_EXIST',
        errorMessage: '收款账户不存在',
      })
      .mockResolvedValueOnce({
        status: 'NOT_FOUND',
      });
    const paidSpy = jest.spyOn(service, 'finalizeWithdrawalPaid').mockResolvedValue(undefined);
    const failedSpy = jest.spyOn(service, 'finalizeWithdrawalFailed').mockResolvedValue(undefined);

    await (service as any).retryProcessingWithdrawals();

    expect(redisCoordinator.acquireLock).toHaveBeenCalledWith(
      'cron:withdraw-payout-retry',
      expect.any(String),
      9 * 60 * 1000,
    );
    expect(prisma.withdrawRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'PROCESSING',
      }),
      orderBy: { createdAt: 'asc' },
      take: 20,
    }));
    const findArgs = prisma.withdrawRequest.findMany.mock.calls[0][0];
    expect(findArgs.where).not.toHaveProperty('queryAttempts');
    expect(prisma.withdrawRequest.update).toHaveBeenCalledTimes(3);
    expect(prisma.withdrawRequest.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'w-success' },
      data: { lastQueriedAt: expect.any(Date), queryAttempts: { increment: 1 } },
    });
    expect(alipayService.queryTransfer).toHaveBeenCalledWith({ outBizNo: 'WD-success' });
    expect(paidSpy).toHaveBeenCalledWith('w-success', {
      providerOrderId: 'po-success',
      providerFundOrderId: 'pf-success',
      providerStatus: 'SUCCESS',
    });
    expect(failedSpy).toHaveBeenCalledWith('w-fail', {
      errorCode: 'PAYEE_NOT_EXIST',
      errorMessage: '收款账户不存在',
      providerStatus: 'FAIL',
    });
    expect(failedSpy).toHaveBeenCalledWith('w-not-found', {
      errorCode: 'NOT_FOUND_MAX_ATTEMPTS',
      errorMessage: '支付宝查询多次未找到订单，强制退款',
      providerStatus: 'NOT_FOUND',
    });
    expect(redisCoordinator.releaseLock).toHaveBeenCalledWith(
      'cron:withdraw-payout-retry',
      expect.any(String),
    );
  });

  it('keeps querying stale PROCESSING withdrawals after the tenth non-terminal attempt', async () => {
    const { service, prisma, alipayService } = buildService();
    prisma.withdrawRequest.findMany.mockResolvedValue([
      { id: 'w-processing', outBizNo: 'WD-processing', queryAttempts: 10 },
    ]);
    alipayService.queryTransfer.mockResolvedValue({
      status: 'PROCESSING',
      errorCode: 'SYSTEM_ERROR',
      errorMessage: '系统处理中',
    });
    const paidSpy = jest.spyOn(service, 'finalizeWithdrawalPaid').mockResolvedValue(undefined);
    const failedSpy = jest.spyOn(service, 'finalizeWithdrawalFailed').mockResolvedValue(undefined);

    await (service as any).retryProcessingWithdrawals();

    const findArgs = prisma.withdrawRequest.findMany.mock.calls[0][0];
    expect(findArgs.where).not.toHaveProperty('queryAttempts');
    expect(prisma.withdrawRequest.update).toHaveBeenCalledWith({
      where: { id: 'w-processing' },
      data: { lastQueriedAt: expect.any(Date), queryAttempts: { increment: 1 } },
    });
    expect(alipayService.queryTransfer).toHaveBeenCalledWith({ outBizNo: 'WD-processing' });
    expect(paidSpy).not.toHaveBeenCalled();
    expect(failedSpy).not.toHaveBeenCalled();
  });

  it('skips retry when another instance holds the Redis lock', async () => {
    const redisCoordinator = {
      acquireLock: jest.fn().mockResolvedValue(false),
      releaseLock: jest.fn(),
    };
    const { service, prisma, alipayService } = buildService({ redisCoordinator });

    await (service as any).retryProcessingWithdrawals();

    expect(prisma.withdrawRequest.findMany).not.toHaveBeenCalled();
    expect(alipayService.queryTransfer).not.toHaveBeenCalled();
    expect(redisCoordinator.releaseLock).not.toHaveBeenCalled();
  });
});
