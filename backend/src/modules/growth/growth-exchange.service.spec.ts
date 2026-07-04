import { BadRequestException } from '@nestjs/common';
import { GrowthExchangeService } from './growth-exchange.service';

const activeItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  type: 'COUPON',
  name: '5元红包',
  description: '积分兑换红包',
  pointsCost: 100,
  couponCampaignId: 'campaign-1',
  stockTotal: null,
  stockDaily: null,
  issuedTotal: 0,
  issuedToday: 0,
  issuedTodayDate: null,
  perUserDailyLimit: null,
  perUserMonthlyLimit: null,
  requiredLevelCode: null,
  requiredLevel: null,
  startAt: null,
  endAt: null,
  status: 'ACTIVE',
  sortOrder: 0,
  ...overrides,
});

const activeAccount = (overrides: Record<string, unknown> = {}) => ({
  id: 'account-1',
  userId: 'user-1',
  pointsBalance: 500,
  pointsTotalSpent: 0,
  growthValue: 1000,
  ...overrides,
});

const makeHarness = (options: {
  existingRecord?: any;
  item?: any;
  account?: any;
  limitCount?: number;
  couponIssueError?: Error;
  configs?: Record<string, unknown>;
} = {}) => {
  const configs = { GROWTH_ENABLED: true, ...(options.configs ?? {}) };
  const tx: any = {
    growthExchangeRecord: {
      findUnique: jest.fn().mockResolvedValue(options.existingRecord ?? null),
      count: jest.fn().mockResolvedValue(options.limitCount ?? 0),
      create: jest.fn(({ data }: any) => ({
        id: 'exchange-record-1',
        ...data,
      })),
      update: jest.fn(({ data }: any) => ({
        id: 'exchange-record-1',
        ...data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    growthExchangeItem: {
      findUnique: jest.fn().mockResolvedValue(options.item ?? activeItem()),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(({ data }: any) => ({
        id: 'item-1',
        ...data,
      })),
    },
    growthAccount: {
      findUnique: jest.fn().mockResolvedValue(options.account ?? activeAccount()),
      update: jest.fn().mockResolvedValue({ id: 'account-1' }),
    },
    userProfile: {
      upsert: jest.fn().mockResolvedValue({ userId: 'user-1' }),
    },
    growthLedger: {
      create: jest.fn(({ data }: any) => ({
        id: 'ledger-1',
        ...data,
      })),
    },
    ruleConfig: {
      findUnique: jest.fn(({ where }: any) => {
        if (!(where.key in configs)) return null;
        return { key: where.key, value: configs[where.key as keyof typeof configs] };
      }),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((callback: any, transactionOptions: any) =>
      callback(tx).then((result: any) => ({ result, transactionOptions })),
    ),
  };
  const couponAdapter = {
    issueExchangeCoupon: jest.fn().mockImplementation(() => {
      if (options.couponIssueError) {
        return Promise.reject(options.couponIssueError);
      }
      return Promise.resolve({ id: 'coupon-instance-1' });
    }),
  };

  return {
    tx,
    prisma,
    couponAdapter,
    service: new GrowthExchangeService(prisma, couponAdapter as any),
  };
};

describe('GrowthExchangeService', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T04:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('exchanges points for a configured coupon item in one Serializable transaction', async () => {
    const { service, tx, couponAdapter } = makeHarness();

    const { result, transactionOptions } = await service.exchange('user-1', 'item-1', {
      idempotencyKey: 'request-1',
    }) as any;

    expect(transactionOptions).toMatchObject({ isolationLevel: 'Serializable' });
    expect(tx.growthExchangeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        accountId: 'account-1',
        itemId: 'item-1',
        pointsCost: 100,
        status: 'PENDING',
        idempotencyKey: 'GROWTH_EXCHANGE:user-1:request-1',
      }),
    });
    expect(tx.growthAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: {
        pointsBalance: { decrement: 100 },
        pointsTotalSpent: { increment: 100 },
      },
    });
    expect(tx.growthLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        accountId: 'account-1',
        type: 'POINTS_SPEND',
        pointsDelta: -100,
        growthDelta: 0,
        refType: 'GROWTH_EXCHANGE',
        refId: 'exchange-record-1',
        idempotencyKey: 'GROWTH_EXCHANGE:user-1:request-1:LEDGER',
      }),
    });
    expect(couponAdapter.issueExchangeCoupon).toHaveBeenCalledWith({
      userId: 'user-1',
      campaignId: 'campaign-1',
      tx,
      source: { type: 'GROWTH_EXCHANGE', id: 'exchange-record-1' },
    });
    expect(tx.growthExchangeItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: {
        issuedTotal: { increment: 1 },
        issuedToday: 1,
        issuedTodayDate: '2026-07-03',
      },
    });
    expect(tx.growthExchangeRecord.update).toHaveBeenCalledWith({
      where: { id: 'exchange-record-1' },
      data: {
        status: 'SUCCESS',
        couponInstanceId: 'coupon-instance-1',
      },
    });
    expect(result).toMatchObject({
      id: 'exchange-record-1',
      status: 'SUCCESS',
      couponInstanceId: 'coupon-instance-1',
    });
  });

  it('returns an existing record for the same idempotency key without spending again', async () => {
    const { service, tx, couponAdapter } = makeHarness({
      existingRecord: {
        id: 'exchange-record-existing',
        status: 'SUCCESS',
        idempotencyKey: 'GROWTH_EXCHANGE:user-1:request-1',
      },
    });

    const { result } = await service.exchange('user-1', 'item-1', {
      idempotencyKey: 'request-1',
    }) as any;

    expect(result).toMatchObject({ id: 'exchange-record-existing' });
    expect(tx.growthAccount.update).not.toHaveBeenCalled();
    expect(couponAdapter.issueExchangeCoupon).not.toHaveBeenCalled();
  });

  it('rejects exchange when points are insufficient', async () => {
    const { service, couponAdapter } = makeHarness({
      account: activeAccount({ pointsBalance: 50 }),
    });

    await expect(
      service.exchange('user-1', 'item-1', { idempotencyKey: 'request-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(couponAdapter.issueExchangeCoupon).not.toHaveBeenCalled();
  });

  it('rejects exchange when the growth system switch is disabled before spending points', async () => {
    const { service, tx, couponAdapter } = makeHarness({
      configs: { GROWTH_ENABLED: false },
    });

    await expect(
      service.exchange('user-1', 'item-1', { idempotencyKey: 'request-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.growthExchangeRecord.create).not.toHaveBeenCalled();
    expect(tx.growthAccount.update).not.toHaveBeenCalled();
    expect(couponAdapter.issueExchangeCoupon).not.toHaveBeenCalled();
  });

  it('rejects exchange types that do not have a fulfillment channel', async () => {
    const { service, tx, couponAdapter } = makeHarness({
      item: activeItem({ type: 'LOTTERY_CHANCE', couponCampaignId: null }),
    });

    await expect(
      service.exchange('user-1', 'item-1', { idempotencyKey: 'request-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.growthExchangeRecord.create).not.toHaveBeenCalled();
    expect(tx.growthAccount.update).not.toHaveBeenCalled();
    expect(couponAdapter.issueExchangeCoupon).not.toHaveBeenCalled();
  });

  it('rejects exchange when required level threshold is not reached', async () => {
    const { service, couponAdapter } = makeHarness({
      account: activeAccount({ growthValue: 800 }),
      item: activeItem({
        requiredLevelCode: 'HARVEST',
        requiredLevel: { code: 'HARVEST', threshold: 1000, name: '丰收会员' },
      }),
    });

    await expect(
      service.exchange('user-1', 'item-1', { idempotencyKey: 'request-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(couponAdapter.issueExchangeCoupon).not.toHaveBeenCalled();
  });

  it('enforces per-user daily exchange limits', async () => {
    const { service, couponAdapter } = makeHarness({
      item: activeItem({ perUserDailyLimit: 1 }),
      limitCount: 1,
    });

    await expect(
      service.exchange('user-1', 'item-1', { idempotencyKey: 'request-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(couponAdapter.issueExchangeCoupon).not.toHaveBeenCalled();
  });

  it('enforces total stock limits', async () => {
    const { service, couponAdapter } = makeHarness({
      item: activeItem({ stockTotal: 10, issuedTotal: 10 }),
    });

    await expect(
      service.exchange('user-1', 'item-1', { idempotencyKey: 'request-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(couponAdapter.issueExchangeCoupon).not.toHaveBeenCalled();
  });

  it('propagates coupon issue failure and does not mark the exchange successful', async () => {
    const { service, tx } = makeHarness({
      couponIssueError: new Error('coupon quota exhausted'),
    });

    await expect(
      service.exchange('user-1', 'item-1', { idempotencyKey: 'request-1' }),
    ).rejects.toThrow('coupon quota exhausted');
    expect(tx.growthExchangeRecord.update).not.toHaveBeenCalled();
    expect(tx.growthExchangeItem.update).not.toHaveBeenCalled();
  });
});
