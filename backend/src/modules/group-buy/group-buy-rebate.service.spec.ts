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
    candidateSequence: 1,
    effectiveSequence: null,
    referredInstanceId: 'referred_instance_1',
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
      activity: {
        id: 'activity_1',
        status: 'ACTIVE',
        endAt: new Date('2026-07-01T00:00:00.000Z'),
        deletedAt: null,
      },
      priceSnapshot: 1000,
      tierSnapshot,
      validReferralCount: 0,
      code: { id: 'code_1', status: 'ACTIVE' },
    },
    referredInstance: {
      id: 'referred_instance_1',
      priceSnapshot: 1000,
      tierSnapshot,
    },
    ...overrides,
  });

  const buildPrisma = (overrides: Record<string, any> = {}) => {
    const referral = buildReferral(overrides.referral);
    const releaseLedgerFindResults = [...(overrides.releaseLedgerFindResults ?? [])];
    const tx = {
      groupBuyReferral: {
        findUnique: jest.fn().mockResolvedValue(referral),
        findFirst: jest.fn().mockResolvedValue(referral),
        count: jest.fn().mockImplementation((args) => {
          if (args?.where?.status === 'VALID') return Promise.resolve(overrides.validCount ?? 0);
          if (args?.where?.status === 'CANDIDATE') return Promise.resolve(overrides.pendingCount ?? 0);
          return Promise.resolve(overrides.validCount ?? 0);
        }),
        update: jest.fn().mockResolvedValue({ id: 'referral_1' }),
      },
      groupBuyRebateAccount: {
        findUnique: jest.fn().mockResolvedValue(overrides.account ?? null),
        upsert: jest.fn().mockResolvedValue(overrides.account ?? {
          id: 'account_1',
          userId: referral.instance?.userId ?? 'initiator_1',
          balance: 0,
          reserved: 0,
          withdrawn: 0,
          deducted: 0,
        }),
        create: jest.fn().mockResolvedValue({
          id: 'account_1',
          userId: referral.instance?.userId ?? 'initiator_1',
          balance: 0,
          reserved: 0,
          withdrawn: 0,
          deducted: 0,
        }),
        update: jest.fn().mockResolvedValue({ id: 'account_1' }),
      },
      groupBuyRebateLedger: {
        findUnique: jest.fn(({ where }: any) => {
          if (where?.idempotencyKey?.startsWith('GROUP_BUY_PENDING_REBATE:')) {
            return Promise.resolve(overrides.pendingLedger ?? null);
          }
          if (where?.idempotencyKey?.startsWith('GROUP_BUY_RELEASE_REBATE:') && releaseLedgerFindResults.length > 0) {
            return Promise.resolve(releaseLedgerFindResults.shift());
          }
          return Promise.resolve(overrides.existingLedger ?? null);
        }),
        findFirst: jest.fn().mockResolvedValue(overrides.releaseLedger ?? null),
        create: jest.fn().mockResolvedValue({ id: 'ledger_1' }),
        update: jest.fn().mockResolvedValue({ id: 'pending_1' }),
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

  it('creates a pending rebate ledger when referred user pays without increasing available balance', async () => {
    const { tx, service } = buildPrisma({
      account: {
        id: 'account_1',
        userId: 'initiator_1',
        balance: 42,
        reserved: 7,
        withdrawn: 5,
        deducted: 3,
      },
    });

    const result = await service.createPendingReferralAfterPayment(tx as any, 'referral_1', now);

    expect(result).toEqual({
      status: 'PENDING_CREATED',
      candidateSequence: 1,
      amount: 100,
    });
    expect(tx.groupBuyRebateAccount.create).not.toHaveBeenCalled();
    expect(tx.groupBuyRebateLedger.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'GROUP_BUY_PENDING_REBATE:referral_1' },
    });
    expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountId: 'account_1',
        userId: 'initiator_1',
        instanceId: 'instance_1',
        referralId: 'referral_1',
        orderId: 'order_1',
        type: 'PENDING_REBATE',
        status: 'PENDING',
        amount: 100,
        balanceBefore: 42,
        balanceAfter: 42,
        idempotencyKey: 'GROUP_BUY_PENDING_REBATE:referral_1',
        refType: 'GROUP_BUY_REFERRAL',
        refId: 'referral_1',
        meta: expect.objectContaining({
          candidateSequence: 1,
          referredOrderId: 'order_1',
          referredInstanceId: 'referred_instance_1',
          source: 'REFERRED_PAYMENT',
        }),
      }),
    }));
    expect(tx.groupBuyRebateAccount.update).not.toHaveBeenCalled();
  });

  it('creates the rebate account before pending ledger when missing', async () => {
    const { tx, service } = buildPrisma();

    await service.createPendingReferralAfterPayment(tx as any, 'referral_1', now);

    expect(tx.groupBuyRebateAccount.upsert).toHaveBeenCalledWith({
      where: { userId: 'initiator_1' },
      update: {},
      create: {
        userId: 'initiator_1',
        balance: 0,
      },
    });
    expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountId: 'account_1',
        balanceBefore: 0,
        balanceAfter: 0,
      }),
    }));
  });

  it('uses an atomic account upsert when creating a pending rebate ledger', async () => {
    const { tx, service } = buildPrisma();

    await service.createPendingReferralAfterPayment(tx as any, 'referral_1', now);

    expect(tx.groupBuyRebateAccount.upsert).toHaveBeenCalledWith({
      where: { userId: 'initiator_1' },
      update: {},
      create: {
        userId: 'initiator_1',
        balance: 0,
      },
    });
    expect(tx.groupBuyRebateAccount.create).not.toHaveBeenCalled();
  });

  it('calculates pending rebate from referred instance tier snapshot', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        candidateSequence: 2,
        instance: {
          id: 'instance_1',
          userId: 'initiator_1',
          status: 'SHARING',
          priceSnapshot: 1000,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '推荐人第一档' },
            { sequence: 2, basisPoints: 2000, label: '推荐人第二档' },
          ],
          validReferralCount: 0,
          code: { id: 'code_1', status: 'ACTIVE' },
        },
        referredInstance: {
          id: 'referred_instance_1',
          priceSnapshot: 500,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '被推荐人第一档' },
            { sequence: 2, basisPoints: 3000, label: '被推荐人第二档' },
          ],
        },
      },
    });

    const result = await service.createPendingReferralAfterPayment(tx as any, 'referral_1', now);

    expect(result).toEqual({
      status: 'PENDING_CREATED',
      candidateSequence: 2,
      amount: 150,
    });
    expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        amount: 150,
        meta: expect.objectContaining({
          candidateSequence: 2,
          tierBasisPoints: 3000,
          priceSnapshot: 500,
        }),
      }),
    }));
  });

  it('does not create duplicate pending ledger for repeated payment callback', async () => {
    const { tx, service } = buildPrisma({
      pendingLedger: {
        id: 'pending_1',
        amount: 100,
        status: 'PENDING',
        meta: { candidateSequence: 1 },
      },
    });

    const result = await service.createPendingReferralAfterPayment(tx as any, 'referral_1', now);

    expect(result).toEqual({
      status: 'PENDING_EXISTS',
      candidateSequence: 1,
      amount: 100,
    });
    expect(tx.groupBuyRebateLedger.create).not.toHaveBeenCalled();
    expect(tx.groupBuyRebateAccount.update).not.toHaveBeenCalled();
  });

  it('releases tier 1 rebate for the first valid direct purchase', async () => {
    const { prisma, tx, service } = buildPrisma({
      pendingLedger: {
        id: 'pending_1',
        amount: 100,
        status: 'PENDING',
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializableOptions);
    expect(result).toEqual({
      status: 'RELEASED',
      effectiveSequence: 1,
      amount: 100,
    });
    expect(tx.groupBuyRebateAccount.upsert).toHaveBeenCalledWith({
      where: { userId: 'initiator_1' },
      update: {},
      create: {
        userId: 'initiator_1',
        balance: 0,
      },
    });
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
        idempotencyKey: 'GROUP_BUY_RELEASE_REBATE:referral_1',
      }),
    }));
    expect(tx.groupBuyRebateLedger.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { idempotencyKey: 'GROUP_BUY_PENDING_REBATE:referral_1' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
    expect(tx.groupBuyRebateLedger.create.mock.invocationCallOrder[0])
      .toBeLessThan(tx.groupBuyRebateLedger.update.mock.invocationCallOrder[0]);
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
      data: {
        validReferralCount: { increment: 1 },
        candidateCount: 0,
      },
    }));
    expect(tx.groupBuyCode.update).not.toHaveBeenCalled();
  });

  it('releases tier 2 rebate for the second valid direct purchase', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        candidateSequence: 2,
      },
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

  it('uses an atomic account upsert when releasing a referral rebate', async () => {
    const { tx, service } = buildPrisma();

    await service.releaseReferralIfValid('referral_1', now);

    expect(tx.groupBuyRebateAccount.upsert).toHaveBeenCalledWith({
      where: { userId: 'initiator_1' },
      update: {},
      create: {
        userId: 'initiator_1',
        balance: 0,
      },
    });
    expect(tx.groupBuyRebateAccount.create).not.toHaveBeenCalled();
  });

  it('returns already released without mutating balances when release ledger create loses idempotency race', async () => {
    const duplicateReleaseLedger = {
      id: 'release_1',
      amount: 100,
      status: 'AVAILABLE',
      meta: { tierSequence: 1 },
    };
    const duplicateError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`idempotencyKey`)',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['idempotencyKey'] },
      },
    );
    const { tx, service } = buildPrisma({
      pendingLedger: {
        id: 'pending_1',
        amount: 100,
        status: 'PENDING',
      },
      releaseLedgerFindResults: [null, duplicateReleaseLedger],
    });
    tx.groupBuyRebateLedger.create.mockRejectedValueOnce(duplicateError);

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'ALREADY_RELEASED',
      effectiveSequence: 1,
      amount: 100,
    });
    expect(tx.groupBuyRebateLedger.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'GROUP_BUY_RELEASE_REBATE:referral_1' },
    });
    expect(tx.groupBuyRebateLedger.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { idempotencyKey: 'GROUP_BUY_PENDING_REBATE:referral_1' },
    }));
    expect(tx.groupBuyRebateAccount.update).not.toHaveBeenCalled();
    expect(tx.groupBuyReferral.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referral_1' },
      data: expect.objectContaining({ status: 'VALID' }),
    }));
  });

  it('uses referrer tier snapshot length to complete sharing even when referred snapshot is longer', async () => {
    const { tx, service } = buildPrisma({
      validCount: 1,
      referral: {
        candidateSequence: 2,
        instance: {
          id: 'instance_1',
          userId: 'initiator_1',
          status: 'SHARING',
          priceSnapshot: 1000,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '推荐人第一档' },
            { sequence: 2, basisPoints: 2000, label: '推荐人第二档' },
          ],
          validReferralCount: 1,
          code: { id: 'code_1', status: 'ACTIVE' },
        },
        referredInstance: {
          id: 'referred_instance_1',
          priceSnapshot: 500,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '被推荐人第一档' },
            { sequence: 2, basisPoints: 3000, label: '被推荐人第二档' },
            { sequence: 3, basisPoints: 6000, label: '被推荐人第三档' },
          ],
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'RELEASED',
      effectiveSequence: 2,
      amount: 150,
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
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
  });

  it('releases tier 3 rebate and completes active sharing when the last tier is valid', async () => {
    const { tx, service } = buildPrisma({
      validCount: 2,
      referral: {
        candidateSequence: 3,
      },
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

  it('invalidates an unfinished candidate when the activity has ended before rebate release', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        instance: {
          id: 'instance_1',
          userId: 'initiator_1',
          status: 'SHARING',
          activity: {
            id: 'activity_1',
            status: 'ENDED',
            endAt: new Date('2026-06-22T11:59:00.000Z'),
            deletedAt: null,
          },
          priceSnapshot: 1000,
          tierSnapshot,
          validReferralCount: 0,
          code: { id: 'code_1', status: 'EXPIRED' },
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'INVALIDATED',
      reason: 'ACTIVITY_ENDED',
    });
    expect(tx.groupBuyReferral.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referral_1' },
      data: expect.objectContaining({
        status: 'INVALID',
        invalidReason: 'ACTIVITY_ENDED',
        invalidatedAt: now,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: { candidateCount: { decrement: 1 } },
    }));
    expect(tx.groupBuyRebateLedger.create).not.toHaveBeenCalled();
    expect(tx.groupBuyRebateAccount.update).not.toHaveBeenCalled();
  });

  it('keeps an already valid released rebate after the activity has ended', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        status: 'VALID',
        effectiveSequence: 1,
        amountSnapshot: 100,
        instance: {
          id: 'instance_1',
          userId: 'initiator_1',
          status: 'EXPIRED',
          activity: {
            id: 'activity_1',
            status: 'ENDED',
            endAt: new Date('2026-06-22T11:59:00.000Z'),
            deletedAt: null,
          },
          priceSnapshot: 1000,
          tierSnapshot,
          validReferralCount: 1,
          code: { id: 'code_1', status: 'EXPIRED' },
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'ALREADY_VALID',
      effectiveSequence: 1,
      amount: 100,
    });
    expect(tx.groupBuyReferral.update).not.toHaveBeenCalled();
    expect(tx.groupBuyRebateLedger.create).not.toHaveBeenCalled();
  });

  it('voids an already released rebate when the referred order is refunded later', async () => {
    const { prisma, tx, service } = buildPrisma({
      referral: {
        status: 'VALID',
        effectiveSequence: 1,
        amountSnapshot: 100,
        referredOrder: {
          id: 'order_1',
          status: 'RECEIVED',
          returnWindowExpiresAt: new Date('2026-06-20T00:00:00.000Z'),
          afterSaleRequests: [],
          refunds: [{ id: 'refund_1', status: 'REFUNDED' }],
        },
      },
      validCount: 1,
      account: {
        id: 'account_1',
        userId: 'initiator_1',
        balance: 100,
        reserved: 0,
        withdrawn: 0,
        deducted: 0,
      },
      releaseLedger: {
        id: 'release_ledger_1',
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
        meta: { tierSequence: 1 },
      },
    });

    const result = await service.voidReleasedReferralByOrderIfValid(
      'order_1',
      'REFERRED_ORDER_AFTER_SALE_OR_REFUND',
      now,
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializableOptions);
    expect(result).toEqual({
      status: 'VOIDED',
      amount: 100,
      referralId: 'referral_1',
    });
    expect(tx.groupBuyRebateAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'account_1' },
      data: { balance: { decrement: 100 } },
    }));
    expect(tx.groupBuyRebateLedger.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'release_ledger_1' },
      data: expect.objectContaining({
        status: 'VOIDED',
      }),
    }));
    expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountId: 'account_1',
        userId: 'initiator_1',
        instanceId: 'instance_1',
        referralId: 'referral_1',
        orderId: 'order_1',
        type: 'VOID',
        status: 'COMPLETED',
        amount: -100,
        balanceBefore: 100,
        balanceAfter: 0,
        idempotencyKey: 'GROUP_BUY_REBATE_VOID:referral_1',
      }),
    }));
    expect(tx.groupBuyReferral.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referral_1' },
      data: expect.objectContaining({
        status: 'INVALID',
        invalidReason: 'REFERRED_ORDER_AFTER_SALE_OR_REFUND',
        invalidatedAt: now,
        voidedAt: now,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: { validReferralCount: { decrement: 1 } },
    }));
  });

  it('voids pending rebate ledger when invalidating a candidate with refund or after-sale record', async () => {
    const { tx, service } = buildPrisma({
      pendingLedger: {
        id: 'pending_1',
        status: 'PENDING',
        amount: 100,
      },
      referral: {
        referredOrder: {
          id: 'order_1',
          status: 'RECEIVED',
          returnWindowExpiresAt: new Date('2026-06-20T00:00:00.000Z'),
          afterSaleRequests: [],
          refunds: [{ id: 'refund_1' }],
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'INVALIDATED',
      reason: 'REFERRED_ORDER_AFTER_SALE_OR_REFUND',
    });
    expect(tx.groupBuyRebateLedger.update).toHaveBeenCalledWith({
      where: { idempotencyKey: 'GROUP_BUY_PENDING_REBATE:referral_1' },
      data: { status: 'VOIDED' },
    });
    expect(tx.groupBuyRebateAccount.update).not.toHaveBeenCalled();
  });

  it('invalidates unfinished candidate purchases after the initiator actively terminates sharing', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        instance: {
          id: 'instance_1',
          userId: 'initiator_1',
          status: 'TERMINATED',
          activity: {
            id: 'activity_1',
            status: 'ACTIVE',
            endAt: new Date('2026-07-01T00:00:00.000Z'),
            deletedAt: null,
          },
          priceSnapshot: 1000,
          tierSnapshot,
          validReferralCount: 0,
          code: { id: 'code_1', status: 'DISABLED' },
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({
      status: 'INVALIDATED',
      reason: 'USER_TERMINATED',
    });
    expect(tx.groupBuyReferral.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referral_1' },
      data: expect.objectContaining({
        status: 'INVALID',
        invalidReason: 'USER_TERMINATED',
        invalidatedAt: now,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: { candidateCount: { decrement: 1 } },
    }));
    expect(tx.groupBuyRebateLedger.create).not.toHaveBeenCalled();
    expect(tx.groupBuyCode.update).not.toHaveBeenCalled();
  });

  it('releases immediately after receive without waiting for return window expiry', async () => {
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

    expect(result).toEqual({
      status: 'RELEASED',
      effectiveSequence: 1,
      amount: 100,
    });
    expect(tx.groupBuyRebateLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'RELEASE',
        status: 'AVAILABLE',
        amount: 100,
        idempotencyKey: 'GROUP_BUY_RELEASE_REBATE:referral_1',
      }),
    }));
  });

  it('waits when referred order is not received', async () => {
    const { tx, service } = buildPrisma({
      referral: {
        referredOrder: {
          id: 'order_1',
          status: 'PAID',
          returnWindowExpiresAt: null,
          afterSaleRequests: [],
          refunds: [],
        },
      },
    });

    const result = await service.releaseReferralIfValid('referral_1', now);

    expect(result).toEqual({ status: 'WAITING_RECEIVE' });
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
