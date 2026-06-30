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
  notificationService?: any;
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
      groupBuyRebateAccount: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      companyStaff: {
        findFirst: jest.fn().mockResolvedValue(null),
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
      groupBuyRebateLedger: {
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
  const notificationService = overrides.notificationService ?? {
    emit: jest.fn().mockResolvedValue(undefined),
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
    notificationService,
    moduleRef as any,
    redisCoordinator,
  );
  (service as any).paymentService = paymentService;
  (service as any).alipayService = alipayService;
  (service as any).redisCoordinator = redisCoordinator;
  return { service, prisma, rulesService, notificationService, paymentService, alipayService, redisCoordinator };
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

  it('rejects repeated idempotency key when the payee real name differs', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-1',
      userId: 'u1',
      amount: 100,
      taxAmount: 20,
      taxRate: 0.2,
      netAmount: 80,
      status: 'PROCESSING',
      accountSnapshot: { account: 'a@example.com', name: '张三' },
    });

    await expect(service.requestWithdraw('u1', {
      amount: 100,
      alipayAccount: 'a@example.com',
      alipayName: '李四',
    }, 'same-key-name-differs')).rejects.toThrow(ConflictException);
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

  it('returns an existing mixed unified request for identical idempotency retries', async () => {
    const { service, prisma, paymentService } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-mixed-existing',
      userId: 'u1',
      amount: 25,
      taxAmount: 5,
      taxRate: 0.2,
      netAmount: 20,
      status: 'PROCESSING',
      accountType: 'VIP_REWARD',
      accountSnapshot: { account: 'a@example.com', name: '张三' },
    });

    const result = await service.requestWithdraw('u1', {
      amount: 25,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'mixed-key');

    expect(result).toMatchObject({
      withdrawId: 'w-mixed-existing',
      grossAmount: 25,
      netAmount: 20,
      status: 'PROCESSING',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(paymentService.initiateTransfer).not.toHaveBeenCalled();
  });

  it('returns an existing group-buy-only unified request for identical idempotency retries', async () => {
    const { service, prisma, paymentService } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-unified-gb-existing',
      userId: 'u1',
      amount: 25,
      taxAmount: 5,
      taxRate: 0.2,
      netAmount: 20,
      status: 'PROCESSING',
      accountType: 'GROUP_BUY_REBATE',
      accountSnapshot: { account: 'a@example.com', name: '张三', source: 'UNIFIED_POINTS' },
    });

    const result = await service.requestWithdraw('u1', {
      amount: 25,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'unified-gb-key');

    expect(result).toMatchObject({
      withdrawId: 'w-unified-gb-existing',
      grossAmount: 25,
      netAmount: 20,
      status: 'PROCESSING',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(paymentService.initiateTransfer).not.toHaveBeenCalled();
  });

  it('rejects a unified idempotency retry against a legacy group-buy withdrawal', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-legacy-gb-existing',
      userId: 'u1',
      amount: 25,
      taxAmount: 5,
      taxRate: 0.2,
      netAmount: 20,
      status: 'PROCESSING',
      accountType: 'GROUP_BUY_REBATE',
      accountSnapshot: { account: 'a@example.com', name: '张三', source: 'GROUP_BUY_REBATE_LEGACY' },
    });

    await expect(service.requestWithdraw('u1', {
      amount: 25,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'same-key-cross-source')).rejects.toThrow(ConflictException);
  });

  it('rejects a legacy group-buy idempotency retry against a unified withdrawal', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-unified-gb-existing',
      userId: 'u1',
      amount: 25,
      taxAmount: 5,
      taxRate: 0.2,
      netAmount: 20,
      status: 'PROCESSING',
      accountType: 'GROUP_BUY_REBATE',
      accountSnapshot: { account: 'a@example.com', name: '张三', source: 'UNIFIED_POINTS' },
    });

    await expect((service as any).requestGroupBuyRebateWithdraw('u1', {
      amount: 25,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'same-key-cross-source')).rejects.toThrow(ConflictException);
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
      source: 'UNIFIED_POINTS',
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

  it('splits unified consumption-points withdraw across Reward then group-buy rebate ledgers', async () => {
    const { service, prisma, paymentService } = buildService();
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'acc-vip', userId: 'u1', type: 'VIP_REWARD', balance: 10, frozen: 0 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.groupBuyRebateAccount.findUnique.mockResolvedValue({
      id: 'gba-1',
      userId: 'u1',
      balance: 20,
      reserved: 0,
      withdrawn: 0,
    });
    prisma.withdrawRequest.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      createdAt: new Date('2026-06-24T00:00:00.000Z'),
      updatedAt: new Date('2026-06-24T00:00:00.000Z'),
    }));
    prisma.withdrawRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'w-mixed-1',
        userId: 'u1',
        amount: 25,
        taxAmount: 5,
        netAmount: 20,
        taxRate: 0.2,
        status: 'PAID',
        accountType: 'VIP_REWARD',
      });
    prisma.rewardLedger.findMany.mockResolvedValue([{ accountId: 'acc-vip', amount: 10 }]);
    prisma.groupBuyRebateLedger.findMany.mockResolvedValue([{ accountId: 'gba-1', amount: 15 }]);

    const result = await service.requestWithdraw('u1', {
      amount: 25,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'mixed-idemp-1');

    expect(result).toMatchObject({
      grossAmount: 25,
      taxAmount: 5,
      netAmount: 20,
      status: 'PAID',
    });
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-vip', balance: { gte: 10 } },
      data: { balance: { decrement: 10 }, frozen: { increment: 10 } },
    }));
    expect(prisma.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'gba-1', balance: { gte: 15 } },
      data: {
        balance: { decrement: 15 },
        reserved: { increment: 15 },
      },
    });
    expect(prisma.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'acc-vip',
        amount: 10,
        status: 'FROZEN',
        refType: 'WITHDRAW',
        meta: expect.objectContaining({
          scheme: 'POINTS_WITHDRAW',
          groupId: expect.stringMatching(/^WG-/),
          accountType: 'VIP_REWARD',
          role: 'PRIMARY',
        }),
      }),
    });
    expect(prisma.groupBuyRebateLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'gba-1',
        type: 'WITHDRAW',
        status: 'RESERVED',
        amount: 15,
        balanceBefore: 20,
        balanceAfter: 5,
        refType: 'WITHDRAW',
        meta: expect.objectContaining({
          scheme: 'POINTS_WITHDRAW',
          groupId: expect.stringMatching(/^WG-/),
          accountType: 'GROUP_BUY_REBATE',
          role: 'SECONDARY',
        }),
      }),
    });
    expect(prisma.withdrawRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountType: 'VIP_REWARD',
        amount: 25,
        status: 'PROCESSING',
        clientIdempotencyKey: 'mixed-idemp-1',
      }),
    }));
    const createData = prisma.withdrawRequest.create.mock.calls[0][0].data;
    expect(decryptJsonValue(createData.accountSnapshot)).toEqual({
      account: 'a@example.com',
      name: '张三',
      source: 'UNIFIED_POINTS',
    });
    expect(paymentService.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({
      remark: '爱买买消费积分提现',
    }));
  });

  it('uses seller-owner industry fund only after Reward and group-buy rebate', async () => {
    const { service, prisma } = buildService();
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce({ id: 'acc-vip', userId: 'owner-1', type: 'VIP_REWARD', balance: 5, frozen: 0 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'acc-industry', userId: 'owner-1', type: 'INDUSTRY_FUND', balance: 30, frozen: 0 });
    prisma.groupBuyRebateAccount.findUnique.mockResolvedValue({
      id: 'gba-owner',
      userId: 'owner-1',
      balance: 10,
      reserved: 0,
      withdrawn: 0,
    });
    prisma.companyStaff.findFirst.mockResolvedValue({ id: 'staff-owner', userId: 'owner-1', role: 'OWNER', status: 'ACTIVE' });
    prisma.withdrawRequest.create.mockImplementation(async ({ data }: any) => data);
    prisma.withdrawRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'w-owner',
        userId: 'owner-1',
        amount: 25,
        taxAmount: 5,
        netAmount: 20,
        accountType: 'VIP_REWARD',
      });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-vip', amount: 5 },
      { accountId: 'acc-industry', amount: 10 },
    ]);
    prisma.groupBuyRebateLedger.findMany.mockResolvedValue([{ accountId: 'gba-owner', amount: 10 }]);

    await service.requestWithdraw('owner-1', {
      amount: 25,
      alipayAccount: 'owner@example.com',
      alipayName: '李四',
    }, 'owner-mixed');

    expect(prisma.companyStaff.findFirst).toHaveBeenCalledWith({
      where: { userId: 'owner-1', role: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-vip', balance: { gte: 5 } },
      data: { balance: { decrement: 5 }, frozen: { increment: 5 } },
    }));
    expect(prisma.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'gba-owner', balance: { gte: 10 } },
      data: { balance: { decrement: 10 }, reserved: { increment: 10 } },
    });
    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-industry', balance: { gte: 10 } },
      data: { balance: { decrement: 10 }, frozen: { increment: 10 } },
    }));
  });

  it('ignores stale industry fund rows for non-owner unified withdraws', async () => {
    const { service, prisma } = buildService();
    prisma.rewardAccount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'acc-stale-industry', userId: 'u1', type: 'INDUSTRY_FUND', balance: 100, frozen: 0 });
    prisma.groupBuyRebateAccount.findUnique.mockResolvedValue(null);
    prisma.companyStaff.findFirst.mockResolvedValue(null);
    prisma.withdrawRequest.create.mockImplementation(async ({ data }: any) => data);
    prisma.withdrawRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'w-stale-industry',
        userId: 'u1',
        amount: 20,
        taxAmount: 4,
        netAmount: 16,
        accountType: 'INDUSTRY_FUND',
      });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-stale-industry', amount: 20 },
    ]);

    await expect(service.requestWithdraw('u1', {
      amount: 20,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'non-owner-industry')).rejects.toThrow(BadRequestException);

    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.groupBuyRebateAccount.updateMany).not.toHaveBeenCalled();
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

  it('freezes group-buy rebate balance independently from Reward and finalizes paid', async () => {
    const { service, prisma, paymentService } = buildService();
    prisma.groupBuyRebateAccount.findUnique.mockResolvedValue({
      id: 'gba-1',
      userId: 'u1',
      balance: 100,
      reserved: 0,
      withdrawn: 0,
    });
    prisma.withdrawRequest.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      createdAt: new Date('2026-06-22T00:00:00.000Z'),
      updatedAt: new Date('2026-06-22T00:00:00.000Z'),
    }));
    prisma.withdrawRequest.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: 'w-gb-1',
        userId: 'u1',
        amount: 80,
        taxAmount: 16,
        netAmount: 64,
        taxRate: 0.2,
        status: 'PAID',
        accountType: 'GROUP_BUY_REBATE',
      });
    prisma.groupBuyRebateLedger.findMany.mockResolvedValue([
      { accountId: 'gba-1', amount: 80 },
    ]);

    const result = await (service as any).requestGroupBuyRebateWithdraw('u1', {
      amount: 80,
      alipayAccount: 'a@example.com',
      alipayName: '张三',
    }, 'gb-idemp-1');

    expect(result).toMatchObject({
      grossAmount: 80,
      taxAmount: 16,
      netAmount: 64,
      status: 'PAID',
    });
    expect(prisma.rewardAccount.findUnique).not.toHaveBeenCalled();
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.groupBuyRebateAccount.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'gba-1', balance: { gte: 80 } },
      data: {
        balance: { decrement: 80 },
        reserved: { increment: 80 },
      },
    });
    expect(prisma.groupBuyRebateLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'gba-1',
        userId: 'u1',
        type: 'WITHDRAW',
        status: 'RESERVED',
        amount: 80,
        refType: 'WITHDRAW',
        refId: expect.any(String),
        idempotencyKey: expect.stringMatching(/^GROUP_BUY_WITHDRAW:/),
        meta: expect.objectContaining({
          scheme: 'GROUP_BUY_REBATE_WITHDRAW',
          accountType: 'GROUP_BUY_REBATE',
        }),
      }),
    });
    expect(prisma.withdrawRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountType: 'GROUP_BUY_REBATE',
        amount: 80,
        status: 'PROCESSING',
        clientIdempotencyKey: 'gb-idemp-1',
      }),
    }));
    const createData = prisma.withdrawRequest.create.mock.calls[0][0].data;
    expect(decryptJsonValue(createData.accountSnapshot)).toEqual({
      account: 'a@example.com',
      name: '张三',
      source: 'GROUP_BUY_REBATE_LEGACY',
    });
    expect(paymentService.initiateTransfer).toHaveBeenCalledWith(expect.objectContaining({
      remark: '爱买买团购返还余额提现',
    }));
  });
});

describe('WithdrawPayoutService.finalize', () => {
  it('marks a processing withdrawal paid, releases frozen balances, and emits notification', async () => {
    const rulesService = {
      getRules: jest.fn().mockResolvedValue(makeRules({ withdrawYearlyAlertThreshold: 0.8 })),
    };
    const { service, prisma, notificationService } = buildService({ rulesService });
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
    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'withdraw.paid',
      aggregateType: 'withdrawRequest',
      aggregateId: 'w-1',
      idempotencyKey: 'withdraw:w-1:paid',
      actor: { kind: 'system' },
      payload: {
        withdrawId: 'w-1',
        userId: 'u1',
        amount: 100,
        netAmount: 64,
        taxAmount: 16,
      },
    });
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

  it('marks a processing withdrawal failed, restores each split balance, voids ledgers, and emits safe notification', async () => {
    const { service, prisma, notificationService } = buildService();
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
    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'withdraw.failed',
      aggregateType: 'withdrawRequest',
      aggregateId: 'w-1',
      idempotencyKey: 'withdraw:w-1:failed',
      actor: { kind: 'system' },
      payload: {
        withdrawId: 'w-1',
        userId: 'u1',
        amount: 80,
        reason: 'PAYOUT_FAILED',
      },
    });
  });

  it('emits processing notification without provider raw details', async () => {
    const { service, prisma, notificationService } = buildService();
    prisma.withdrawRequest.update.mockResolvedValue({
      id: 'w-processing',
      userId: 'u1',
      amount: 80,
    });

    await service.markProcessingProviderInfo('w-processing', {
      errorCode: 'CHANNEL_PENDING_CODE',
      errorMessage: 'provider raw pending message',
      providerStatus: 'PROCESSING',
    });

    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'withdraw.processing',
      aggregateType: 'withdrawRequest',
      aggregateId: 'w-processing',
      idempotencyKey: 'withdraw:w-processing:processing',
      actor: { kind: 'system' },
      payload: {
        withdrawId: 'w-processing',
        userId: 'u1',
        amount: 80,
      },
    });
  });

  it('marks group-buy rebate withdrawal paid and moves reserved balance to withdrawn', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-gb-1',
      userId: 'u1',
      amount: 80,
      netAmount: 64,
      taxAmount: 16,
      accountType: 'GROUP_BUY_REBATE',
    });
    prisma.groupBuyRebateLedger.findMany.mockResolvedValue([
      { accountId: 'gba-1', amount: 80 },
    ]);

    await service.finalizeWithdrawalPaid('w-gb-1', {
      providerOrderId: 'po-1',
      providerFundOrderId: 'pf-1',
      providerStatus: 'SUCCESS',
    });

    expect(prisma.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'gba-1', reserved: { gte: 80 } },
      data: {
        reserved: { decrement: 80 },
        withdrawn: { increment: 80 },
      },
    });
    expect(prisma.groupBuyRebateLedger.updateMany).toHaveBeenCalledWith({
      where: { refType: 'WITHDRAW', refId: 'w-gb-1', status: 'RESERVED' },
      data: { status: 'COMPLETED' },
    });
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.rewardLedger.updateMany).not.toHaveBeenCalled();
  });

  it('marks a mixed unified withdrawal paid and releases both reward and group-buy balances', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-mixed-1',
      userId: 'u1',
      amount: 25,
      netAmount: 20,
      taxAmount: 5,
      accountType: 'VIP_REWARD',
    });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-vip', amount: 10 },
    ]);
    prisma.groupBuyRebateLedger.findMany.mockResolvedValue([
      { accountId: 'gba-1', amount: 15 },
    ]);

    await service.finalizeWithdrawalPaid('w-mixed-1', {
      providerOrderId: 'po-1',
      providerFundOrderId: 'pf-1',
      providerStatus: 'SUCCESS',
    });

    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'acc-vip', frozen: { gte: 10 } },
      data: { frozen: { decrement: 10 } },
    });
    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: { refType: 'WITHDRAW', refId: 'w-mixed-1', status: 'FROZEN' },
      data: { status: 'WITHDRAWN' },
    });
    expect(prisma.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'gba-1', reserved: { gte: 15 } },
      data: {
        reserved: { decrement: 15 },
        withdrawn: { increment: 15 },
      },
    });
    expect(prisma.groupBuyRebateLedger.updateMany).toHaveBeenCalledWith({
      where: { refType: 'WITHDRAW', refId: 'w-mixed-1', status: 'RESERVED' },
      data: { status: 'COMPLETED' },
    });
  });

  it('marks group-buy rebate withdrawal failed and restores reserved balance', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-gb-1',
      userId: 'u1',
      amount: 80,
      accountType: 'GROUP_BUY_REBATE',
    });
    prisma.groupBuyRebateLedger.findMany.mockResolvedValue([
      { accountId: 'gba-1', amount: 80 },
    ]);

    await service.finalizeWithdrawalFailed('w-gb-1', {
      errorCode: 'PAYEE_NOT_EXIST',
      errorMessage: '收款账户不存在',
      providerStatus: 'FAIL',
    });

    expect(prisma.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'gba-1', reserved: { gte: 80 } },
      data: {
        reserved: { decrement: 80 },
        balance: { increment: 80 },
      },
    });
    expect(prisma.groupBuyRebateLedger.updateMany).toHaveBeenCalledWith({
      where: { refType: 'WITHDRAW', refId: 'w-gb-1', status: 'RESERVED' },
      data: { status: 'VOIDED' },
    });
    expect(prisma.rewardAccount.updateMany).not.toHaveBeenCalled();
    expect(prisma.rewardLedger.updateMany).not.toHaveBeenCalled();
  });

  it('marks a mixed unified withdrawal failed and restores both reward and group-buy balances', async () => {
    const { service, prisma } = buildService();
    prisma.withdrawRequest.findUnique.mockResolvedValue({
      id: 'w-mixed-1',
      userId: 'u1',
      amount: 25,
      accountType: 'VIP_REWARD',
    });
    prisma.rewardLedger.findMany.mockResolvedValue([
      { accountId: 'acc-vip', amount: 10 },
    ]);
    prisma.groupBuyRebateLedger.findMany.mockResolvedValue([
      { accountId: 'gba-1', amount: 15 },
    ]);

    await service.finalizeWithdrawalFailed('w-mixed-1', {
      errorCode: 'PAYEE_NOT_EXIST',
      errorMessage: '收款账户不存在',
      providerStatus: 'FAIL',
    });

    expect(prisma.rewardAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'acc-vip', frozen: { gte: 10 } },
      data: {
        frozen: { decrement: 10 },
        balance: { increment: 10 },
      },
    });
    expect(prisma.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: { refType: 'WITHDRAW', refId: 'w-mixed-1', status: 'FROZEN' },
      data: { status: 'VOIDED', entryType: 'VOID' },
    });
    expect(prisma.groupBuyRebateAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'gba-1', reserved: { gte: 15 } },
      data: {
        reserved: { decrement: 15 },
        balance: { increment: 15 },
      },
    });
    expect(prisma.groupBuyRebateLedger.updateMany).toHaveBeenCalledWith({
      where: { refType: 'WITHDRAW', refId: 'w-mixed-1', status: 'RESERVED' },
      data: { status: 'VOIDED' },
    });
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
