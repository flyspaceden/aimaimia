import { BadRequestException } from '@nestjs/common';
import { GroupBuyService } from './group-buy.service';

describe('GroupBuyService', () => {
  describe('assertTierBasisPointsTotal', () => {
    it('accepts any positive configured tier total', () => {
      expect(() => GroupBuyService.assertTierBasisPointsTotal([1000, 2000, 7000])).not.toThrow();
      expect(() => GroupBuyService.assertTierBasisPointsTotal([1000, 2000, 8000])).not.toThrow();
      expect(() => GroupBuyService.assertTierBasisPointsTotal([2500, 2500])).not.toThrow();
    });

    it('rejects tiers whose basis points total is not positive', () => {
      expect(() => GroupBuyService.assertTierBasisPointsTotal([])).toThrow(
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
              description: '鲜活大龙虾冷链配送到家',
              price: 1000,
              freeShipping: true,
              status: 'ACTIVE',
              startAt: null,
              endAt: null,
              deletedAt: null,
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
        groupBuyCode: {
          findUnique: jest.fn(),
        },
        groupBuyReferral: {
          count: jest.fn().mockResolvedValue(0),
        },
      };

      return { prisma, service: new (GroupBuyService as any)(prisma) as GroupBuyService };
    };

    it('does not expose rule summary in buyer activity payloads', async () => {
      const { service } = buildPrisma();

      const result = await service.findActiveActivities();

      expect(result.items[0]).not.toHaveProperty('ruleSummary');
    });

    const buildInstance = (status: string, overrides: Record<string, unknown> = {}) => ({
      id: 'instance_1',
      status,
      validReferralCount: 0,
      candidateCount: 0,
      tierSnapshot: [
        { sequence: 1, basisPoints: 1000, label: '第一位好友' },
        { sequence: 2, basisPoints: 2000, label: '第二位好友' },
        { sequence: 3, basisPoints: 7000, label: '第三位好友' },
      ],
      createdAt: new Date('2026-06-22T00:00:00.000Z'),
      updatedAt: new Date('2026-06-22T00:00:00.000Z'),
      activity: {
        id: 'activity_1',
        title: '大龙虾团购',
        description: '鲜活大龙虾冷链配送到家',
        price: 1000,
        freeShipping: true,
        status: 'ACTIVE',
        startAt: null,
        endAt: null,
        deletedAt: null,
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
        description: '鲜活大龙虾冷链配送到家',
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

    it('returns normalized group-buy item summaries and availability for multi-item activities', async () => {
      const { prisma, service } = buildPrisma();
      prisma.groupBuyActivity.findMany.mockResolvedValueOnce([
        {
          ...buildInstance('SHARING').activity,
          items: [
            {
              productId: 'product_1',
              skuId: 'sku_1',
              quantity: 1,
              sortOrder: 0,
              product: {
                id: 'product_1',
                title: '大龙虾',
                media: [{ id: 'media_1', url: 'https://example.com/lobster.jpg', sortOrder: 0 }],
              },
              sku: { id: 'sku_1', title: '一只装', stock: 8, weightGram: 1500 },
            },
            {
              productId: 'product_2',
              skuId: 'sku_2',
              quantity: 2,
              sortOrder: 1,
              product: {
                id: 'product_2',
                title: '鲍鱼',
                media: [{ id: 'media_2', url: 'https://example.com/abalone.jpg', sortOrder: 0 }],
              },
              sku: { id: 'sku_2', title: '六只装', stock: 5, weightGram: 500 },
            },
          ],
        },
      ]);

      const result = await service.findActiveActivities();

      expect(result.items[0]).toEqual(expect.objectContaining({
        itemSummary: '大龙虾 x1、鲍鱼 x2',
        availableStock: 2,
        totalWeightGram: 2500,
      }));
      expect(result.items[0].items).toEqual([
        expect.objectContaining({ productId: 'product_1', skuId: 'sku_1', quantity: 1 }),
        expect.objectContaining({ productId: 'product_2', skuId: 'sku_2', quantity: 2 }),
      ]);
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

    it('prefers the occupying instance even when older terminated referrals may still be pending', async () => {
      const { prisma, service } = buildPrisma();
      prisma.groupBuyInstance.findFirst.mockResolvedValueOnce(
        buildInstance('SHARING', { id: 'active_instance' }),
      );

      const result = await service.getCurrentState('user_1');

      expect(prisma.groupBuyInstance.findFirst).toHaveBeenCalledTimes(1);
      expect(result.occupiesSlot).toBe(true);
      expect(result.current).toEqual(expect.objectContaining({
        id: 'active_instance',
        status: 'SHARING',
      }));
    });

    it('keeps a terminated instance visible when referrals are still pending but frees the slot', async () => {
      const { prisma, service } = buildPrisma();
      prisma.groupBuyInstance.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(buildInstance('TERMINATED', { candidateCount: 1, validReferralCount: 1 }));

      const result = await service.getCurrentState('user_1');

      expect(prisma.groupBuyInstance.findFirst).toHaveBeenCalledTimes(2);
      expect(result.occupiesSlot).toBe(false);
      expect(result.canBuyNew).toBe(true);
      expect(result.defaultTab).toBe('CURRENT');
      expect(result.current).toEqual(expect.objectContaining({
        status: 'TERMINATED',
        candidateCount: 1,
      }));
    });

    it('returns landing info for an active share code without buyer-facing percentages', async () => {
      const { prisma, service } = buildPrisma();
      prisma.groupBuyCode.findUnique.mockResolvedValueOnce({
        code: 'GB123456',
        status: 'ACTIVE',
        instance: {
          id: 'instance_1',
          userId: 'user_sharer',
          status: 'SHARING',
          validReferralCount: 1,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '第一位好友' },
            { sequence: 2, basisPoints: 2000, label: '第二位好友' },
            { sequence: 3, basisPoints: 7000, label: '第三位好友' },
          ],
          activity: buildInstance('SHARING').activity,
          user: {
            id: 'user_sharer',
            buyerNo: 'AIMM202606220001',
            profile: { nickname: '分享用户' },
          },
        },
      });

      const result = await service.getLandingByCode('GB123456');

      expect(result).toEqual(expect.objectContaining({
        code: 'GB123456',
        valid: true,
        inviter: {
          userId: 'user_sharer',
          nickname: '分享用户',
          buyerNo: 'AIMM202606220001',
        },
      }));
      expect(result.activity).toEqual(expect.objectContaining({
        id: 'activity_1',
        tiers: [
          { sequence: 1, label: '第一位好友' },
          { sequence: 2, label: '第二位好友' },
          { sequence: 3, label: '第三位好友' },
        ],
      }));
      expect(result.activity?.tiers[0]).not.toHaveProperty('basisPoints');
    });

    it('uses direct referral records to reject a share landing when all slots are occupied', async () => {
      const { prisma, service } = buildPrisma();
      prisma.groupBuyCode.findUnique.mockResolvedValueOnce({
        code: 'GB123456',
        status: 'ACTIVE',
        instance: {
          id: 'instance_1',
          userId: 'user_sharer',
          status: 'SHARING',
          validReferralCount: 2,
          candidateCount: 0,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '第一位好友' },
            { sequence: 2, basisPoints: 2000, label: '第二位好友' },
            { sequence: 3, basisPoints: 7000, label: '第三位好友' },
          ],
          activity: buildInstance('SHARING').activity,
          user: {
            id: 'user_sharer',
            buyerNo: 'AIMM202606220001',
            profile: { nickname: '分享用户' },
          },
        },
      });
      prisma.groupBuyReferral.count.mockResolvedValueOnce(3);

      const result = await service.getLandingByCode('GB123456');

      expect(prisma.groupBuyReferral.count).toHaveBeenCalledWith({
        where: {
          instanceId: 'instance_1',
          status: { in: ['CANDIDATE', 'VALID'] },
        },
      });
      expect(result).toEqual({
        code: 'GB123456',
        valid: false,
        activity: null,
        inviter: null,
        reason: '团购推荐码名额已满',
      });
    });

    it('uses the referrer locked tier snapshot instead of current activity tiers when checking share landing slots', async () => {
      const { prisma, service } = buildPrisma();
      prisma.groupBuyCode.findUnique.mockResolvedValueOnce({
        code: 'GB123456',
        status: 'ACTIVE',
        instance: {
          id: 'instance_1',
          userId: 'user_sharer',
          status: 'SHARING',
          validReferralCount: 2,
          candidateCount: 0,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '第一位好友' },
            { sequence: 2, basisPoints: 2000, label: '第二位好友' },
            { sequence: 3, basisPoints: 7000, label: '第三位好友' },
          ],
          activity: {
            ...buildInstance('SHARING').activity,
            tiers: [
              { sequence: 1, basisPoints: 5000, label: '第一位好友' },
              { sequence: 2, basisPoints: 5000, label: '第二位好友' },
            ],
          },
          user: {
            id: 'user_sharer',
            buyerNo: 'AIMM202606220001',
            profile: { nickname: '分享用户' },
          },
        },
      });
      prisma.groupBuyReferral.count.mockResolvedValueOnce(2);

      const result = await service.getLandingByCode('GB123456');

      expect(result.valid).toBe(true);
      expect(result.inviter?.userId).toBe('user_sharer');
    });

    it('returns invalid landing info when the share code is completed or not sharing', async () => {
      const { prisma, service } = buildPrisma();
      prisma.groupBuyCode.findUnique.mockResolvedValueOnce({
        code: 'GB123456',
        status: 'COMPLETED',
        instance: {
          id: 'instance_1',
          userId: 'user_sharer',
          status: 'COMPLETED',
          validReferralCount: 3,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '第一位好友' },
            { sequence: 2, basisPoints: 2000, label: '第二位好友' },
            { sequence: 3, basisPoints: 7000, label: '第三位好友' },
          ],
          activity: buildInstance('SHARING').activity,
          user: {
            id: 'user_sharer',
            buyerNo: 'AIMM202606220001',
            profile: { nickname: '分享用户' },
          },
        },
      });

      const result = await service.getLandingByCode('GB123456');

      expect(result).toEqual({
        code: 'GB123456',
        valid: false,
        activity: null,
        inviter: null,
        reason: '团购推荐码已完成或不可用',
      });
    });
  });
});
