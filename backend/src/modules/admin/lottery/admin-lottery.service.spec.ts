import { AdminLotteryService } from './admin-lottery.service';

describe('AdminLotteryService no-prize display counts', () => {
  const buildService = () => {
    const prisma = {
      lotteryPrize: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prize-real',
            name: '1元白酒',
            type: 'DISCOUNT_BUY',
            wonCount: 8,
          },
          {
            id: 'prize-none',
            name: '谢谢参与',
            type: 'NO_PRIZE',
            wonCount: 0,
          },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      lotteryRecord: {
        count: jest.fn().mockResolvedValue(37),
      },
    };

    return {
      prisma,
      service: new AdminLotteryService(prisma as any, { invalidateCache: jest.fn() } as any),
    };
  };

  it('shows NO_PRIZE row wonCount from no-prize draw records instead of LotteryPrize.wonCount', async () => {
    const { prisma, service } = buildService();

    const result = await service.findPrizes();

    expect(prisma.lotteryRecord.count).toHaveBeenCalledWith({
      where: { result: 'NO_PRIZE' },
    });
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'prize-real', wonCount: 8 }),
      expect.objectContaining({ id: 'prize-none', wonCount: 37 }),
    ]);
  });

  it('shows NO_PRIZE stats from no-prize draw records', async () => {
    const prisma = {
      lotteryRecord: {
        count: jest.fn(({ where }) => {
          if (where?.result === 'NO_PRIZE' && where?.drawDate) return Promise.resolve(5);
          if (where?.result === 'NO_PRIZE') return Promise.resolve(37);
          if (where?.result === 'WON') return Promise.resolve(3);
          return Promise.resolve(8);
        }),
        groupBy: jest.fn().mockResolvedValue([
          { prizeId: 'prize-real', _count: { id: 3 } },
        ]),
      },
      lotteryPrize: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'prize-real',
            name: '1元白酒',
            type: 'DISCOUNT_BUY',
            wonCount: 8,
            totalLimit: 50,
            dailyLimit: 3,
          },
          {
            id: 'prize-none',
            name: '谢谢参与',
            type: 'NO_PRIZE',
            wonCount: 0,
            totalLimit: null,
            dailyLimit: null,
          },
        ]),
      },
    };
    const service = new AdminLotteryService(prisma as any, { invalidateCache: jest.fn() } as any);

    const stats = await service.getStats();

    expect(prisma.lotteryRecord.count).toHaveBeenCalledWith({
      where: { result: 'NO_PRIZE' },
    });
    expect(prisma.lotteryRecord.count).toHaveBeenCalledWith({
      where: { drawDate: expect.any(String), result: 'NO_PRIZE' },
    });
    expect(stats.prizes).toEqual([
      expect.objectContaining({ id: 'prize-real', todayWon: 3, totalWon: 8 }),
      expect.objectContaining({ id: 'prize-none', todayWon: 5, totalWon: 37 }),
    ]);
  });
});
