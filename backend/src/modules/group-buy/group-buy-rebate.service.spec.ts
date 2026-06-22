import { Prisma } from '@prisma/client';

import { GroupBuyRebateService } from './group-buy-rebate.service';

describe('GroupBuyRebateService', () => {
  const now = new Date('2026-06-22T12:00:00.000Z');
  const serializableOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  const tierSnapshot = [
    { sequence: 1, basisPoints: 1000, label: '第一位好友' },
    { sequence: 2, basisPoints: 2000, label: '第二位好友' },
    { sequence: 3, basisPoints: 7000, label: '第三位好友' },
  ];

  const buildReferral = (overrides: Record<string, any> = {}) => ({
    id: 'referral_1',
    status: 'CANDIDATE',
    instanceId: 'instance_1',
    referredOrderId: 'order_1',
    referredOrder: {
      id: 'order_1',
      status: 'RECEIVED',
      returnWindowExpiresAt: new Date('2026-06-20T00:00:00.000Z'),
      afterSaleRequests: [],
      refunds: [],
    },
    instance: {
      id: 'instance_1',
      userId: 'initiator_1',
      status: 'SHARING',
      priceSnapshot: 1000,
      tierSnapshot,
      validReferralCount: 0,
      code: { id: 'code_1', status: 'ACTIVE' },
    },
    ...overrides,
  });

  const buildPrisma = (overrides: Record<string, any> = {}) => {
    const tx = {
      groupBuyReferral: {
        findUnique: jest.fn().mockResolvedValue(buildReferral(overrides.referral)),
        findFirst: jest.fn().mockResolvedValue(buildReferral(overrides.referral)),
        count: jest.fn().mockResolvedValue(overrides.validCount ?? 0),
        update: jest.fn().mockResolvedValue({ id: 'referral_1' }),
      },
      groupBuyRebateAccount: {
        findUnique: jest.fn().mockResolvedValue(overrides.account ?? null),
        create: jest.fn().mockResolvedValue({
          id: 'account_1',
          userId: 'initiator_1',
          balance: 0,
          reserved: 0,
          withdrawn: 0,
          deducted: 0,
        }),
        update: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      groupBuyRebateLedger: {
        findUnique: jest.fn().mockResolvedValue(overrides.existingLedger ?? null),
        create: jest.fn().mockResolvedValue({ id: 'ledger_1' }),
      },
      groupBuyInstance: {
        update: jest.fn().mockResolvedValue({ id: 'instance_1' }),
      },
      groupBuyCode: {
        update: jest.fn().mockResolvedValue({ id: 'code_1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
      groupBuyRebateAccount: {
        findUnique: jest.fn().mockResolvedValue(overrides.readAccount ?? null),
      },
      groupBuyRebateLedger: {
        findMany: jest.fn().mockResolvedValue(overrides.readLedgers ?? []),
        count: jest.fn().mockResolvedValue(overrides.readLedgerTotal ?? 0),
      },
      rewardAccount: {
        findMany: jest.fn().mockResolvedValue(overrides.rewardAccounts ?? []),
      },
      withdrawRequest: {
        findMany: jest.fn().mockResolvedValue(overrides.withdrawals ?? []),
        count: jest.fn().mockResolvedValue(overrides.withdrawalTotal ?? 0),
      },
    };
    return { prisma, tx, service: new (GroupBuyRebateService as any)(prisma) as GroupBuyRebateService };
  };

  it('releases tier 1 rebate for the first valid direct purchase', async () => {
    const { prisma, tx, service } = buildPrisma();

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializableOptions);
    expect(result).toEqual({
      status: 'RELEASED',
      effectiveSequence: 1,
      amount: 100,
    });
    expect(tx.groupBuyRebateAccount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'initiator_1',
        balance: 0,
      }),
    }));
    expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountId: 'account_1',
        userId: 'initiator_1',
        instanceId: 'instance_1',
        referralId: 'referral_1',
        orderId: 'order_1',
        type: 'RELEASE',
        status: 'AVAILABLE',
        amount: 100,
        balanceBefore: 0,
        balanceAfter: 100,
        idempotencyKey: 'GROUP_BUY_REBATE:referral_1',
      }),
    }));
    expect(tx.groupBuyRebateAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'account_1' },
      data: { balance: { increment: 100 } },
    }));
    expect(tx.groupBuyReferral.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referral_1' },
      data: expect.objectContaining({
        status: 'VALID',
        effectiveSequence: 1,
        amountSnapshot: 100,
        validAt: now,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: { validReferralCount: { increment: 1 } },
    }));
    expect(tx.groupBuyCode.update).not.toHaveBeenCalled();
  });

  it('releases tier 2 rebate for the second valid direct purchase', async () => {
    const { tx, service } = buildPrisma({
      validCount: 1,
      account: { id: 'account_1', userId: 'initiator_1', balance: 100 },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'RELEASED',
      effectiveSequence: 2,
      amount: 200,
    });
    expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amount: 200,
        balanceBefore: 100,
        balanceAfter: 300,
      }),
    }));
  });

  it('releases tier 3 rebate and completes active sharing when the last tier is valid', async () => {
    const { tx, service } = buildPrisma({
      validCount: 2,
      account: { id: 'account_1', userId: 'initiator_1', balance: 300 },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'RELEASED',
      effectiveSequence: 3,
      amount: 700,
    });
    expect(tx.groupBuyInstance.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        completedAt: now,
      }),
    }));
    expect(tx.groupBuyCode.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'code_1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        completedAt: now,
      }),
    }));
  });

  it('marks a candidate invalid when the referred order has any refund or after-sale record', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        referredOrder: {
          id: 'order_1',
          status: 'RECEIVED',
          returnWindowExpiresAt: new Date('2026-06-20T00:00:00.000Z'),
          afterSaleRequests: [{ id: 'as_1' }],
          refunds: [],
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'INVALIDATED',
      reason: 'REFERRED_ORDER_AFTER_SALE_OR_REFUND',
    });
    expect(tx.groupBuyReferral.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referral_1' },
      data: expect.objectContaining({
        status: 'INVALID',
        invalidReason: 'REFERRED_ORDER_AFTER_SALE_OR_REFUND',
        invalidatedAt: now,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: { candidateCount: { decrement: 1 } },
    }));
    expect(tx.groupBuyRebateLedger.create).not.toHaveBeenCalled();
  });

  it('keeps a terminated instance terminated but releases already paid candidate purchases', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        instance: {
          id: 'instance_1',
          userId: 'initiator_1',
          status: 'TERMINATED',
          priceSnapshot: 1000,
          tierSnapshot,
          validReferralCount: 0,
          code: { id: 'code_1', status: 'DISABLED' },
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result.status).toBe('RELEASED');
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: { validReferralCount: { increment: 1 } },
    }));
    expect(tx.groupBuyInstance.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
    expect(tx.groupBuyCode.update).not.toHaveBeenCalled();
  });

  it('waits until referred order is received and return window has expired', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        referredOrder: {
          id: 'order_1',
          status: 'RECEIVED',
          returnWindowExpiresAt: new Date('2026-06-23T00:00:00.000Z'),
          afterSaleRequests: [],
          refunds: [],
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({ status: 'WAITING_RETURN_WINDOW' });
    expect(tx.groupBuyRebateLedger.create).not.toHaveBeenCalled();
    expect(tx.groupBuyReferral.update).not.toHaveBeenCalled();
  });

  it('returns a zero group-buy rebate account when none exists', async () => {
    const { prisma, service } = buildPrisma();

    const result = await service.getAccount('user_1');

    expect(result).toEqual({
      balance: 0,
      reserved: 0,
      withdrawn: 0,
      deducted: 0,
      available: 0,
      total: 0,
    });
    expect(prisma.groupBuyRebateAccount.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user_1' },
    });
    expect(prisma.rewardAccount.findMany).not.toHaveBeenCalled();
  });

  it('lists group-buy rebate ledgers with pagination', async () => {
    const createdAt = new Date('2026-06-22T12:10:00.000Z');
    const { prisma, service } = buildPrisma({
      readLedgers: [
        {
          id: 'ledger_1',
          type: 'RELEASE',
          status: 'AVAILABLE',
          amount: 100,
          balanceBefore: 0,
          balanceAfter: 100,
          instanceId: 'instance_1',
          referralId: 'referral_1',
          orderId: 'order_1',
          refType: 'GROUP_BUY_REFERRAL',
          refId: 'referral_1',
          meta: { tierSequence: 1 },
          createdAt,
        },
      ],
      readLedgerTotal: 3,
    });

    const result = await service.listLedgers('user_1', 2, 1);

    expect(prisma.groupBuyRebateLedger.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      skip: 1,
      take: 1,
    });
    expect(result).toEqual({
      items: [
        {
          id: 'ledger_1',
          type: 'RELEASE',
          status: 'AVAILABLE',
          amount: 100,
          balanceBefore: 0,
          balanceAfter: 100,
          instanceId: 'instance_1',
          referralId: 'referral_1',
          orderId: 'order_1',
          refType: 'GROUP_BUY_REFERRAL',
          refId: 'referral_1',
          meta: { tierSequence: 1 },
          createdAt: createdAt.toISOString(),
        },
      ],
      total: 3,
      page: 2,
      pageSize: 1,
      nextPage: 3,
    });
  });

  it('does not merge RewardAccount balances into group-buy rebate account', async () => {
    const { prisma, service } = buildPrisma({
      readAccount: {
        id: 'account_1',
        userId: 'user_1',
        balance: 12,
        reserved: 3,
        withdrawn: 4,
        deducted: 5,
      },
      rewardAccounts: [
        { balance: 999, frozen: 99 },
      ],
    });

    const result = await service.getAccount('user_1');

    expect(result).toEqual({
      balance: 12,
      reserved: 3,
      withdrawn: 4,
      deducted: 5,
      available: 9,
      total: 24,
    });
    expect(prisma.rewardAccount.findMany).not.toHaveBeenCalled();
  });

  it('lists only group-buy rebate withdrawal history', async () => {
    const createdAt = new Date('2026-06-22T12:30:00.000Z');
    const { prisma, service } = buildPrisma({
      withdrawals: [
        {
          id: 'withdraw_1',
          amount: 80,
          netAmount: 64,
          taxAmount: 16,
          channel: 'ALIPAY',
          status: 'PROCESSING',
          accountType: 'GROUP_BUY_REBATE',
          createdAt,
        },
      ],
      withdrawalTotal: 1,
    });

    const result = await (service as any).listWithdrawals('user_1', 1, 20);

    expect(prisma.withdrawRequest.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        accountType: 'GROUP_BUY_REBATE',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(result).toEqual({
      items: [
        {
          id: 'withdraw_1',
          amount: 80,
          netAmount: 64,
          taxAmount: 16,
          channel: 'ALIPAY',
          status: 'PROCESSING',
          createdAt: createdAt.toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      nextPage: undefined,
    });
  });
});
