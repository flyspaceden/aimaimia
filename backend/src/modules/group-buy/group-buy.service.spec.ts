import { BadRequestException } from '@nestjs/common';
import { GroupBuyService } from './group-buy.service';

describe('GroupBuyService', () => {
  describe('assertTierBasisPointsTotal', () => {
    it('accepts tiers whose basis points total exactly 10000', () => {
      expect(() => GroupBuyService.assertTierBasisPointsTotal([1000, 2000, 7000])).not.toThrow();
    });

    it('rejects tiers whose basis points total is not exactly 10000', () => {
      expect(() => GroupBuyService.assertTierBasisPointsTotal([1000, 2000, 8000])).toThrow(
        BadRequestException,
      );
    });
  });

  describe('buyer activity and current-state APIs', () => {
    const buildPrisma = () => {
      const prisma = {
        groupBuyActivity: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'activity_1',
              title: '大龙虾团购',
              price: 1000,
              freeShipping: true,
              ruleSummary: '仅限直接推荐全新用户购买同款商品',
              product: {
                id: 'product_1',
                title: '大龙虾',
                media: [
                  { id: 'media_1', url: 'https://example.com/lobster.jpg', sortOrder: 0 },
                ],
              },
              sku: {
                id: 'sku_1',
                title: '一只装',
                stock: 12,
                weightGram: 1500,
              },
              tiers: [
                { sequence: 1, basisPoints: 1000, label: '第一位好友' },
                { sequence: 2, basisPoints: 2000, label: '第二位好友' },
                { sequence: 3, basisPoints: 7000, label: '第三位好友' },
              ],
            },
          ]),
        },
        groupBuyInstance: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      return { prisma, service: new (GroupBuyService as any)(prisma) as GroupBuyService };
    };

    const buildInstance = (status: string, overrides: Record<string, unknown> = {}) => ({
      id: 'instance_1',
      status,
      validReferralCount: 0,
      candidateCount: 0,
      createdAt: new Date('2026-06-22T00:00:00.000Z'),
      updatedAt: new Date('2026-06-22T00:00:00.000Z'),
      activity: {
        id: 'activity_1',
        title: '大龙虾团购',
        price: 1000,
        freeShipping: true,
        ruleSummary: '仅限直接推荐全新用户购买同款商品',
        product: {
          id: 'product_1',
          title: '大龙虾',
          media: [{ id: 'media_1', url: 'https://example.com/lobster.jpg', sortOrder: 0 }],
        },
        sku: { id: 'sku_1', title: '一只装', stock: 12, weightGram: 1500 },
        tiers: [
          { sequence: 1, basisPoints: 1000, label: '第一位好友' },
          { sequence: 2, basisPoints: 2000, label: '第二位好友' },
          { sequence: 3, basisPoints: 7000, label: '第三位好友' },
        ],
      },
      code: { code: 'GB123456', status: 'ACTIVE' },
      referrals: [],
      ...overrides,
    });

    it('returns active activities with product snapshots but without buyer-facing percentages', async () => {
      const { prisma, service } = buildPrisma();

      const result = await service.findActiveActivities();

      expect(prisma.groupBuyActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE', deletedAt: null }),
      }));
      expect(result.items[0]).toEqual(expect.objectContaining({
        id: 'activity_1',
        title: '大龙虾团购',
        product: expect.objectContaining({
          id: 'product_1',
          title: '大龙虾',
          imageUrl: 'https://example.com/lobster.jpg',
        }),
        sku: expect.objectContaining({ id: 'sku_1', title: '一只装' }),
        tiers: [
          { sequence: 1, label: '第一位好友' },
          { sequence: 2, label: '第二位好友' },
          { sequence: 3, label: '第三位好友' },
        ],
      }));
      expect(result.items[0].tiers[0]).not.toHaveProperty('basisPoints');
    });

    it('returns product tab state when the user has no current group-buy instance', async () => {
      const { service } = buildPrisma();

      const result = await service.getCurrentState('user_1');

      expect(result).toEqual({
        current: null,
        occupiesSlot: false,
        defaultTab: 'PRODUCTS',
        canBuyNew: true,
      });
    });

    it.each(['QUALIFICATION_PENDING', 'SHARING'])(
      'marks %s as occupying the user slot',
      async (status) => {
        const { prisma, service } = buildPrisma();
        prisma.groupBuyInstance.findFirst.mockResolvedValueOnce(buildInstance(status));

        const result = await service.getCurrentState('user_1');

        expect(result.occupiesSlot).toBe(true);
        expect(result.canBuyNew).toBe(false);
        expect(result.defaultTab).toBe('CURRENT');
        expect(result.current).toEqual(expect.objectContaining({ status }));
      },
    );

    it('keeps a terminated instance visible when referrals are still pending but frees the slot', async () => {
      const { prisma, service } = buildPrisma();
      prisma.groupBuyInstance.findFirst.mockResolvedValueOnce(
        buildInstance('TERMINATED', { candidateCount: 1, validReferralCount: 0 }),
      );

      const result = await service.getCurrentState('user_1');

      expect(result.occupiesSlot).toBe(false);
      expect(result.canBuyNew).toBe(true);
      expect(result.defaultTab).toBe('CURRENT');
      expect(result.current).toEqual(expect.objectContaining({
        status: 'TERMINATED',
        candidateCount: 1,
      }));
    });
  });
});
