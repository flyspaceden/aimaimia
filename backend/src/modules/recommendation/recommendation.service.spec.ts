import { RecommendationService } from './recommendation.service';

describe('RecommendationService buyer visibility', () => {
  it('only recommends approved products from active non-platform companies', async () => {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new RecommendationService(prisma as any);

    await service.getForUser('buyer-1');

    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        company: { status: 'ACTIVE', isPlatform: false },
      },
    }));
  });
});
