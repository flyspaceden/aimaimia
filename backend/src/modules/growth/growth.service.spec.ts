import { GrowthService } from './growth.service';

describe('GrowthService', () => {
  it('returns empty account defaults when user has no growth account', async () => {
    const prisma: any = {
      growthAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      growthLevel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new GrowthService(prisma);

    await expect(service.getMe('u1')).resolves.toMatchObject({
      pointsBalance: 0,
      growthValue: 0,
      level: null,
      nextLevel: null,
    });
  });

  it('returns level progress from configured levels', async () => {
    const prisma: any = {
      growthAccount: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ga-1',
          userId: 'u1',
          pointsBalance: 120,
          pointsTotalEarned: 200,
          pointsTotalSpent: 80,
          growthValue: 450,
          currentLevelCode: 'SEEDLING',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        }),
      },
      growthLevel: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'SPROUT', name: '新芽会员', threshold: 0, enabled: true },
          { code: 'SEEDLING', name: '青苗会员', threshold: 300, enabled: true },
          { code: 'EAR', name: '青穗会员', threshold: 1000, enabled: true },
        ]),
      },
    };
    const service = new GrowthService(prisma);

    await expect(service.getMe('u1')).resolves.toMatchObject({
      pointsBalance: 120,
      growthValue: 450,
      level: { code: 'SEEDLING', name: '青苗会员', threshold: 300 },
      nextLevel: { code: 'EAR', name: '青穗会员', threshold: 1000 },
      levelProgress: {
        current: 150,
        required: 700,
        ratio: 0.2143,
      },
    });
  });
});
