import { Prisma } from '@prisma/client';
import { GrowthEventService } from './growth-event.service';

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
  limitCount?: number;
  memberTier?: 'NORMAL' | 'VIP' | null;
} = {}) => {
  const tx: any = {
    growthLedger: {
      findUnique: jest.fn().mockResolvedValue(options.existingLedger ?? null),
      count: jest.fn().mockResolvedValue(options.limitCount ?? 0),
      create: jest.fn(({ data }: any) => ({
        id: 'ledger-1',
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        ...data,
      })),
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
        id: 'account-1',
        userId: 'u1',
        pointsBalance: create?.pointsBalance ?? update?.pointsBalance?.increment ?? 0,
        growthValue: create?.growthValue ?? update?.growthValue?.increment ?? 0,
      })),
    },
    userProfile: {
      upsert: jest.fn().mockResolvedValue({ userId: 'u1' }),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((callback: any, transactionOptions: any) =>
      callback(tx).then((result: any) => ({ result, transactionOptions })),
    ),
  };

  return { tx, prisma, service: new GrowthEventService(prisma) };
};

describe('GrowthEventService', () => {
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
      }),
    }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
