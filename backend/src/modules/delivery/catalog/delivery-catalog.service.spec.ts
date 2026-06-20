import { DeliveryPriceRuleScope, DeliveryPriceRuleType } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryPricingService } from '../pricing/delivery-pricing.service';
import { DeliveryCatalogService } from './delivery-catalog.service';

describe('DeliveryCatalogService', () => {
  let deliveryPrisma: any;
  let pricingService: { resolvePrice: jest.Mock };
  let service: DeliveryCatalogService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryCategory: {
        findMany: jest.fn(),
      },
      deliveryPriceRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'platform-rule',
            scope: DeliveryPriceRuleScope.PLATFORM,
            ruleType: DeliveryPriceRuleType.MARKUP_RATE,
            markupBps: 1800,
            minQuantity: 1,
            maxQuantity: null,
            priority: 1,
            isActive: true,
          },
        ]),
      },
      deliveryProduct: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    pricingService = {
      resolvePrice: jest.fn().mockReturnValue({
        finalPriceCents: 11800,
        matchedSource: 'PLATFORM_DEFAULT_MARKUP',
        matchedRuleId: 'platform-rule',
      }),
    };
    service = new DeliveryCatalogService(
      deliveryPrisma as DeliveryPrismaService,
      pricingService as any,
    );
  });

  it('lists only active categories ordered for buyer browsing', async () => {
    deliveryPrisma.deliveryCategory.findMany.mockResolvedValue([
      { id: 'cat_1', name: '蔬菜', status: 'ACTIVE', sortOrder: 1 },
    ]);

    await expect(service.listCategories()).resolves.toEqual({
      items: [{ id: 'cat_1', name: '蔬菜', status: 'ACTIVE', sortOrder: 1 }],
    });

    expect(deliveryPrisma.deliveryCategory.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('filters buyer catalog to approved active delivery products and computes final prices', async () => {
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([
      {
        id: 'PSSP0000000000001',
        title: '冷鲜牛腩',
        subtitle: '当天现切',
        unitName: '箱',
        merchant: {
          id: 'merchant_1',
          name: '华南仓',
          defaultMarkupBps: 2200,
        },
        category: {
          id: 'cat_1',
          name: '肉类',
        },
        priceRules: [],
        skus: [
          {
            id: 'sku_1',
            title: '5kg/箱',
            imageUrl: null,
            basePriceCents: 10000,
            stock: 10,
            minOrderQuantity: 1,
            orderStepQuantity: 1,
            isActive: true,
            fixedFinalPriceCents: null,
            priceRules: [],
          },
        ],
      },
    ]);

    const result = await service.listProducts({
      quantity: 3,
    });

    expect(deliveryPrisma.deliveryProduct.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: { status: 'ACTIVE' },
          skus: { some: { isActive: true } },
        }),
      }),
    );
    expect(pricingService.resolvePrice).toHaveBeenCalledWith(
      expect.objectContaining({
        basePriceCents: 10000,
        quantity: 3,
        merchantDefaultMarkupBps: 2200,
      }),
    );
    expect(result.items[0]).toMatchObject({
      id: 'PSSP0000000000001',
      minFinalPriceCents: 11800,
    });
    expect(result.items[0].skus[0]).toMatchObject({
      id: 'sku_1',
      finalPriceCents: 11800,
    });
  });

  it('uses merchant tier rules in buyer catalog pricing before merchant default and platform default', async () => {
    const realPricingService = new DeliveryPricingService();
    const catalogService = new DeliveryCatalogService(
      deliveryPrisma as DeliveryPrismaService,
      realPricingService,
    );

    deliveryPrisma.deliveryPriceRule.findMany.mockImplementation(({ where }: any) => {
      if (where.scope === DeliveryPriceRuleScope.PLATFORM) {
        return Promise.resolve([
          {
            id: 'platform-rule',
            scope: DeliveryPriceRuleScope.PLATFORM,
            ruleType: DeliveryPriceRuleType.MARKUP_RATE,
            markupBps: 1500,
            minQuantity: 1,
            maxQuantity: null,
            priority: 1,
            isActive: true,
          },
        ]);
      }

      if (where.scope === DeliveryPriceRuleScope.MERCHANT) {
        return Promise.resolve([
          {
            id: 'merchant-tier-rule',
            scope: DeliveryPriceRuleScope.MERCHANT,
            ruleType: DeliveryPriceRuleType.MARKUP_RATE,
            markupBps: 3500,
            minQuantity: 3,
            maxQuantity: null,
            priority: 9,
            isActive: true,
            merchantId: 'merchant_1',
          },
        ]);
      }

      return Promise.resolve([]);
    });
    deliveryPrisma.deliveryProduct.findMany.mockResolvedValue([
      {
        id: 'PSSP0000000000001',
        title: '冷鲜牛腩',
        subtitle: '当天现切',
        description: null,
        detailRich: null,
        media: null,
        attributes: null,
        unitName: '箱',
        minOrderQuantity: 1,
        orderStepQuantity: 1,
        merchant: {
          id: 'merchant_1',
          name: '华南仓',
          defaultMarkupBps: 2200,
        },
        category: {
          id: 'cat_1',
          name: '肉类',
          status: 'ACTIVE',
        },
        priceRules: [],
        skus: [
          {
            id: 'sku_1',
            title: '5kg/箱',
            imageUrl: null,
            basePriceCents: 10000,
            stock: 10,
            minOrderQuantity: 1,
            orderStepQuantity: 1,
            isActive: true,
            fixedFinalPriceCents: null,
            priceRules: [],
          },
        ],
      },
    ]);

    const result = await catalogService.listProducts({
      quantity: 3,
    });

    expect(deliveryPrisma.deliveryPriceRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope: DeliveryPriceRuleScope.MERCHANT,
          merchantId: {
            in: ['merchant_1'],
          },
          isActive: true,
        }),
      }),
    );
    expect(result.items[0].minFinalPriceCents).toBe(13500);
    expect(result.items[0].skus[0]).toMatchObject({
      id: 'sku_1',
      finalPriceCents: 13500,
    });
    expect(result.items[0].skus[0]).not.toHaveProperty('pricingSource');
    expect(result.items[0].merchant).not.toHaveProperty('defaultMarkupBps');
  });

  it('returns product detail with active skus only', async () => {
    deliveryPrisma.deliveryProduct.findFirst.mockResolvedValue({
      id: 'PSSP0000000000001',
      title: '冷鲜牛腩',
      description: '适合团餐',
      unitName: '箱',
      merchant: {
        id: 'merchant_1',
        name: '华南仓',
        defaultMarkupBps: 2200,
      },
      category: {
        id: 'cat_1',
        name: '肉类',
      },
      priceRules: [],
      skus: [
        {
          id: 'sku_1',
          title: '5kg/箱',
          imageUrl: null,
          basePriceCents: 10000,
          stock: 10,
          minOrderQuantity: 1,
          orderStepQuantity: 1,
          isActive: true,
          fixedFinalPriceCents: null,
          priceRules: [],
        },
      ],
    });

    const result = await service.getProductDetail('PSSP0000000000001', 2);

    expect(result.skus).toEqual([
      expect.objectContaining({
        id: 'sku_1',
        finalPriceCents: 11800,
      }),
    ]);
  });
});
