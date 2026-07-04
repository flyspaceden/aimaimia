import { Prisma } from '@prisma/client';
import { GrowthEventService } from './growth-event.service';
import { isGrowthEnabled } from './growth-config.util';

const activeRule = (overrides: Record<string, unknown> = {}) => ({
  code: 'CHECK_IN',
  name: '每日签到',
  categoryCode: 'DAILY',
  pointsReward: 10,
  growthReward: 20,
  grantTiming: 'IMMEDIATE',
  dailyLimit: null,
  weeklyLimit: null,
  monthlyLimit: null,
  lifetimeLimit: null,
  applicableUserType: 'ALL',
  vipPointsMultiplier: null,
  vipGrowthMultiplier: null,
  enabled: true,
  startAt: null,
  endAt: null,
  ...overrides,
});

const makeHarness = (options: {
  rule?: any;
  existingLedger?: any;
  ledgersToReverse?: any[];
  existingReverseLedger?: any;
  limitCount?: number;
  memberTier?: 'NORMAL' | 'VIP' | null;
  configs?: Record<string, unknown>;
  earnedPoints?: number;
  currentLevelCode?: string | null;
  resolvedLevelCode?: string | null;
} = {}) => {
  const configs = { GROWTH_ENABLED: true, ...(options.configs ?? {}) };
  const accountBase = {
    id: 'account-1',
    userId: 'u1',
    pointsBalance: 0,
    growthValue: 0,
    currentLevelCode: options.currentLevelCode ?? null,
  };
  const tx: any = {
    growthLedger: {
      findUnique: jest.fn().mockResolvedValue(options.existingLedger ?? null),
      findMany: jest.fn().mockResolvedValue(options.ledgersToReverse ?? []),
      count: jest.fn().mockResolvedValue(options.limitCount ?? 0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { pointsDelta: options.earnedPoints ?? 0 } }),
      create: jest.fn(({ data }: any) => ({
        id: 'ledger-1',
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        ...data,
      })),
      update: jest.fn(({ data }: any) => ({ id: 'ledger-original', ...data })),
    },
    growthBehaviorRule: {
      findUnique: jest.fn().mockResolvedValue(options.rule ?? activeRule()),
    },
    memberProfile: {
      findUnique: jest.fn().mockResolvedValue(
        options.memberTier ? { userId: 'u1', tier: options.memberTier } : null,
      ),
    },
    growthAccount: {
      upsert: jest.fn(({ create, update }: any) => ({
        ...accountBase,
        pointsBalance: create?.pointsBalance ?? accountBase.pointsBalance + (update?.pointsBalance?.increment ?? 0),
        growthValue: create?.growthValue ?? accountBase.growthValue + (update?.growthValue?.increment ?? 0),
      })),
      update: jest.fn(({ data }: any) => ({
        ...accountBase,
        currentLevelCode: data.currentLevelCode ?? accountBase.currentLevelCode,
        growthValue: typeof data.growthValue === 'number' ? data.growthValue : accountBase.growthValue,
      })),
    },
    userProfile: {
      upsert: jest.fn().mockResolvedValue({ userId: 'u1' }),
    },
    ruleConfig: {
      findUnique: jest.fn(({ where }: any) => {
        if (!(where.key in configs)) return null;
        return { key: where.key, value: configs[where.key as keyof typeof configs] };
      }),
    },
    growthLevel: {
      findFirst: jest.fn().mockResolvedValue(
        options.resolvedLevelCode ? { code: options.resolvedLevelCode } : null,
      ),
    },
  };

  if (options.existingReverseLedger) {
    tx.growthLedger.findUnique.mockImplementation(({ where }: any) => {
      if (where.idempotencyKey === options.existingReverseLedger.idempotencyKey) {
        return Promise.resolve(options.existingReverseLedger);
      }
      return Promise.resolve(options.existingLedger ?? null);
    });
  }

  const prisma: any = {
    $transaction: jest.fn((callback: any, transactionOptions: any) =>
      callback(tx).then((result: any) => ({ result, transactionOptions })),
    ),
  };

  return { tx, prisma, service: new GrowthEventService(prisma) };
};

describe('GrowthEventService', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T00:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('treats a missing growth switch config as disabled', async () => {
    await expect(
      isGrowthEnabled({
        ruleConfig: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      }),
    ).resolves.toBe(false);
  });

  it('does not grant when the growth system switch is disabled', async () => {
    const { tx, service } = makeHarness({
      configs: { GROWTH_ENABLED: false },
    });

    const { result } = await service.receive({
      userId: 'u1',
      behaviorCode: 'CHECK_IN',
      idempotencyKey: 'CHECK_IN:u1:2026-07-03',
    }) as any;

    expect(result).toMatchObject({
      status: 'SKIPPED',
      reason: 'SYSTEM_DISABLED',
    });
    expect(tx.growthBehaviorRule.findUnique).not.toHaveBeenCalled();
    expect(tx.growthAccount.upsert).not.toHaveBeenCalled();
  });

  it('does not grant when the behavior rule is disabled', async () => {
    const { tx, service } = makeHarness({
      rule: activeRule({ enabled: false }),
    });

    const { result } = await service.receive({
      userId: 'u1',
      behaviorCode: 'CHECK_IN',
      idempotencyKey: 'CHECK_IN:u1:2026-07-03',
    }) as any;

    expect(result).toMatchObject({
      status: 'SKIPPED',
      reason: 'RULE_DISABLED',
    });
    expect(tx.growthAccount.upsert).not.toHaveBeenCalled();
    expect(tx.growthLedger.create).not.toHaveBeenCalled();
  });

  it('returns the existing ledger for a duplicate idempotency key', async () => {
    const existingLedger = { id: 'ledger-existing', idempotencyKey: 'dup-key' };
    const { tx, service } = makeHarness({ existingLedger });

    const { result } = await service.receive({
      userId: 'u1',
      behaviorCode: 'CHECK_IN',
      idempotencyKey: 'dup-key',
    }) as any;

    expect(result).toMatchObject({
      status: 'DUPLICATE',
      ledger: existingLedger,
    });
    expect(tx.growthBehaviorRule.findUnique).not.toHaveBeenCalled();
    expect(tx.growthAccount.upsert).not.toHaveBeenCalled();
  });

  it('enforces daily and lifetime limits before granting', async () => {
    const { tx, service } = makeHarness({
      rule: activeRule({ dailyLimit: 1, lifetimeLimit: 1 }),
      limitCount: 1,
    });

    const { result } = await service.receive({
      userId: 'u1',
      behaviorCode: 'CHECK_IN',
      idempotencyKey: 'limited-key',
    }) as any;

    expect(result).toMatchObject({
      status: 'SKIPPED',
      reason: 'DAILY_LIMIT',
    });
    expect(tx.growthLedger.count).toHaveBeenCalled();
    expect(tx.growthAccount.upsert).not.toHaveBeenCalled();
  });

  it('applies VIP multipliers and updates account and profile in a Serializable transaction', async () => {
    const { tx, prisma, service } = makeHarness({
      rule: activeRule({
        vipPointsMultiplier: 1.2,
        vipGrowthMultiplier: 1.5,
      }),
      memberTier: 'VIP',
    });

    const { result, transactionOptions } = await service.receive({
      userId: 'u1',
      behaviorCode: 'CHECK_IN',
      idempotencyKey: 'vip-key',
      refType: 'CHECK_IN',
      refId: '2026-07-03',
    }) as any;

    expect(transactionOptions).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(result).toMatchObject({
      status: 'GRANTED',
      pointsDelta: 12,
      growthDelta: 30,
    });
    expect(tx.growthAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      create: expect.objectContaining({
        pointsBalance: 12,
        pointsTotalEarned: 12,
        growthValue: 30,
      }),
      update: expect.objectContaining({
        pointsBalance: { increment: 12 },
        pointsTotalEarned: { increment: 12 },
        growthValue: { increment: 30 },
      }),
    }));
    expect(tx.userProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      create: expect.objectContaining({
        userId: 'u1',
        points: 12,
        growthPoints: 30,
      }),
      update: expect.objectContaining({
        points: { increment: 12 },
        growthPoints: { increment: 30 },
      }),
    }));
    expect(tx.growthLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'u1',
        accountId: 'account-1',
        behaviorCode: 'CHECK_IN',
        pointsDelta: 12,
        growthDelta: 30,
        idempotencyKey: 'vip-key',
        refType: 'CHECK_IN',
        refId: '2026-07-03',
        expiresAt: new Date('2027-07-03T00:00:00.000Z'),
      }),
    }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('uses configured point expiry and refreshes current growth level after granting', async () => {
    const { tx, service } = makeHarness({
      configs: { GROWTH_POINTS_EXPIRE_DAYS: 30 },
      resolvedLevelCode: 'SPROUT',
    });

    const { result } = await service.receive({
      userId: 'u1',
      behaviorCode: 'CHECK_IN',
      idempotencyKey: 'level-key',
    }) as any;

    expect(result).toMatchObject({ status: 'GRANTED', pointsDelta: 10, growthDelta: 20 });
    expect(tx.growthLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        expiresAt: new Date('2026-08-02T00:00:00.000Z'),
      }),
    }));
    expect(tx.growthAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { currentLevelCode: 'SPROUT' },
    });
  });

  it('clamps point rewards to the configured daily cap while preserving growth rewards', async () => {
    const { service } = makeHarness({
      configs: { GROWTH_DAILY_POINTS_CAP: 15 },
      earnedPoints: 10,
    });

    const { result } = await service.receive({
      userId: 'u1',
      behaviorCode: 'CHECK_IN',
      idempotencyKey: 'capped-key',
    }) as any;

    expect(result).toMatchObject({
      status: 'GRANTED',
      pointsDelta: 5,
      growthDelta: 20,
    });
  });

  it('reverses posted ledgers by ref without deleting the original ledger', async () => {
    const { tx, service } = makeHarness({
      ledgersToReverse: [
        {
          id: 'ledger-original',
          userId: 'u1',
          accountId: 'account-1',
          type: 'POINTS_EARN',
          behaviorCode: 'FIRST_ORDER_RECEIVED',
          pointsDelta: 100,
          growthDelta: 200,
          refType: 'ORDER',
          refId: 'order-1',
          meta: null,
        },
      ],
    });

    const { result } = await service.reverseByRef('ORDER', 'order-1') as any;

    expect(result).toMatchObject({
      reversedCount: 1,
      reversedPoints: 100,
      reversedGrowth: 200,
    });
    expect(tx.growthLedger.findMany).toHaveBeenCalledWith({
      where: {
        refType: 'ORDER',
        refId: 'order-1',
        status: 'POSTED',
      },
    });
    expect(tx.growthAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: {
        pointsBalance: { decrement: 100 },
        growthValue: { decrement: 200 },
      },
    });
    expect(tx.growthLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'POINTS_REVERSE',
        pointsDelta: -100,
        growthDelta: -200,
        idempotencyKey: 'GROWTH_REVERSE:ledger-original',
      }),
    }));
    expect(tx.growthLedger.update).toHaveBeenCalledWith({
      where: { id: 'ledger-original' },
      data: { status: 'REVERSED' },
    });
  });

  it('does not reverse the same ledger twice', async () => {
    const { tx, service } = makeHarness({
      existingReverseLedger: {
        id: 'reverse-existing',
        idempotencyKey: 'GROWTH_REVERSE:ledger-original',
      },
      ledgersToReverse: [
        {
          id: 'ledger-original',
          userId: 'u1',
          accountId: 'account-1',
          pointsDelta: 100,
          growthDelta: 200,
          refType: 'ORDER',
          refId: 'order-1',
        },
      ],
    });

    const { result } = await service.reverseByRef('ORDER', 'order-1') as any;

    expect(result).toMatchObject({
      reversedCount: 0,
      reversedPoints: 0,
      reversedGrowth: 0,
    });
    expect(tx.growthAccount.update).not.toHaveBeenCalled();
    expect(tx.growthLedger.create).not.toHaveBeenCalled();
  });

  it('skips reversal when refund reversal config is disabled', async () => {
    const { tx, service } = makeHarness({
      configs: { GROWTH_REFUND_REVERSAL_ENABLED: false },
      ledgersToReverse: [
        {
          id: 'ledger-original',
          userId: 'u1',
          accountId: 'account-1',
          pointsDelta: 100,
          growthDelta: 200,
          refType: 'ORDER',
          refId: 'order-1',
        },
      ],
    });

    const { result } = await service.reverseByRef('ORDER', 'order-1') as any;

    expect(result).toMatchObject({
      reversedCount: 0,
      skippedReason: 'REVERSAL_DISABLED',
    });
    expect(tx.growthLedger.findMany).not.toHaveBeenCalled();
    expect(tx.growthAccount.update).not.toHaveBeenCalled();
  });

  it('grants direct configured rewards without reading behavior rules', async () => {
    const { tx, service } = makeHarness();

    const { result, transactionOptions } = await service.grantDirect({
      userId: 'u1',
      behaviorCode: 'TASK_COMPLETE',
      pointsReward: 20,
      growthReward: 30,
      idempotencyKey: 'TASK:u1:task-1',
      refType: 'TASK',
      refId: 'task-1',
      meta: { taskTitle: '完善资料' },
    }) as any;

    expect(transactionOptions).toMatchObject({ isolationLevel: 'Serializable' });
    expect(tx.growthBehaviorRule.findUnique).not.toHaveBeenCalled();
    expect(tx.growthAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      create: expect.objectContaining({
        pointsBalance: 20,
        pointsTotalEarned: 20,
        growthValue: 30,
      }),
      update: expect.objectContaining({
        pointsBalance: { increment: 20 },
        pointsTotalEarned: { increment: 20 },
        growthValue: { increment: 30 },
      }),
    }));
    expect(tx.growthLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        behaviorCode: 'TASK_COMPLETE',
        pointsDelta: 20,
        growthDelta: 30,
        idempotencyKey: 'TASK:u1:task-1',
        refType: 'TASK',
        refId: 'task-1',
      }),
    });
    expect(result).toMatchObject({
      status: 'GRANTED',
      pointsDelta: 20,
      growthDelta: 30,
    });
  });
});
