import { LotteryService } from './lottery.service';

describe('LotteryService — 公开抽奖 dailyLimit 补偿', () => {
  const prize = {
    id: 'prize-1',
    type: 'PRODUCT',
    probability: 100,
    dailyLimit: 5,
    totalLimit: 10,
    wonCount: 1,
    expirationHours: null,
    prizePrice: 9.9,
    originalPrice: 19.9,
    skuId: null,
    threshold: null,
    prizeQuantity: 1,
    sortOrder: 1,
    isActive: true,
    name: '测试奖品',
    productId: null,
  };

  function createService() {
    const prisma = {
      lotteryPrize: {
        findMany: jest.fn().mockResolvedValue([prize]),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ price: 19.9 }),
      },
      $transaction: jest.fn(),
    };
    const bonusConfig = {
      getSystemConfig: jest.fn().mockResolvedValue({ lotteryEnabled: true }),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    };
    const redisCoord = {
      consumeFixedWindow: jest.fn(),
      rollbackFixedWindow: jest.fn().mockResolvedValue(true),
      set: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
    };

    const service = new LotteryService(
      prisma as any,
      bonusConfig as any,
      config as any,
      redisCoord as any,
    );

    return { service, prisma, redisCoord };
  }

  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('事务内发现 totalLimit 已满时，应回滚已占用的奖品日额度', async () => {
    const { service, prisma, redisCoord } = createService();
    redisCoord.consumeFixedWindow
      .mockResolvedValueOnce({ allowed: true, count: 1, ttlSec: 60 })
      .mockResolvedValueOnce({ allowed: true, count: 1, ttlSec: 86400 })
      .mockResolvedValueOnce({ allowed: true, count: 1, ttlSec: 86400 })
      .mockResolvedValueOnce({ allowed: true, count: 1, ttlSec: 86400 });
    prisma.$transaction.mockResolvedValue(-1);

    await expect(
      service.publicDraw('fingerprint-12345678', '127.0.0.1'),
    ).resolves.toEqual({ result: 'NO_PRIZE' });

    expect(redisCoord.rollbackFixedWindow).toHaveBeenCalledWith(
      expect.stringContaining(`lottery:prize:${prize.id}:daily:`),
      86400,
    );
  });

  it('claim token 缓存失败时，应同时回滚 wonCount 和奖品日额度', async () => {
    const { service, prisma, redisCoord } = createService();
    redisCoord.consumeFixedWindow
      .mockResolvedValueOnce({ allowed: true, count: 1, ttlSec: 60 })
      .mockResolvedValueOnce({ allowed: true, count: 1, ttlSec: 86400 })
      .mockResolvedValueOnce({ allowed: true, count: 1, ttlSec: 86400 })
      .mockResolvedValueOnce({ allowed: true, count: 1, ttlSec: 86400 });
    prisma.$transaction.mockResolvedValue(1);
    redisCoord.set.mockResolvedValue(false);

    await expect(
      service.publicDraw('fingerprint-12345678', '127.0.0.1'),
    ).resolves.toEqual({ result: 'NO_PRIZE' });

    expect(prisma.lotteryPrize.update).toHaveBeenCalledWith({
      where: { id: prize.id },
      data: { wonCount: { decrement: 1 } },
    });
    expect(redisCoord.rollbackFixedWindow).toHaveBeenCalledWith(
      expect.stringContaining(`lottery:prize:${prize.id}:daily:`),
      86400,
    );
  });
});
