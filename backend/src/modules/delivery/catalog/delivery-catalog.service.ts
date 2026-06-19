import { Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryPriceRuleScope, Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryPricingService } from '../pricing/delivery-pricing.service';
import { ListDeliveryCatalogProductsQueryDto } from './dto/list-delivery-catalog-products.query.dto';

const catalogProductInclude = {
  merchant: {
    select: {
      id: true,
      name: true,
      defaultMarkupBps: true,
    },
  },
  category: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  priceRules: {
    where: {
      isActive: true,
      scope: 'PRODUCT',
    },
  },
  skus: {
    where: {
      isActive: true,
    },
    include: {
      priceRules: {
        where: {
          isActive: true,
          scope: 'SKU',
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  },
} satisfies Prisma.DeliveryProductInclude;

type CatalogProductPayload = Prisma.DeliveryProductGetPayload<{
  include: typeof catalogProductInclude;
}>;

@Injectable()
export class DeliveryCatalogService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryPricingService: DeliveryPricingService,
  ) {}

  async listCategories() {
    return {
      items: await this.deliveryPrisma.deliveryCategory.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    };
  }

  async listProducts(query: ListDeliveryCatalogProductsQueryDto) {
    const quantity = query.quantity ?? 1;
    const [platformRules, products] = await Promise.all([
      this.listActivePriceRules({ scope: DeliveryPriceRuleScope.PLATFORM }),
      this.deliveryPrisma.deliveryProduct.findMany({
        where: this.buildCatalogWhere(query),
        include: catalogProductInclude,
        orderBy: [{ updatedAt: 'desc' }],
      }),
    ]);
    const merchantRulesByMerchantId = await this.loadMerchantRulesByMerchantId(
      products.map((product) => product.merchant.id),
    );

    return {
      items: products.map((product) =>
        this.mapCatalogProduct(
          product,
          platformRules,
          merchantRulesByMerchantId.get(product.merchant.id) ?? [],
          quantity,
        ),
      ),
    };
  }

  async getProductDetail(productId: string, quantity = 1) {
    const [platformRules, product] = await Promise.all([
      this.listActivePriceRules({ scope: DeliveryPriceRuleScope.PLATFORM }),
      this.deliveryPrisma.deliveryProduct.findFirst({
        where: {
          id: productId,
          ...this.buildCatalogWhere({}),
        },
        include: catalogProductInclude,
      }),
    ]);

    if (!product) {
      throw new NotFoundException('配送商品不存在或未上架');
    }

    const merchantRulesByMerchantId = await this.loadMerchantRulesByMerchantId([product.merchant.id]);

    return this.mapCatalogProduct(
      product,
      platformRules,
      merchantRulesByMerchantId.get(product.merchant.id) ?? [],
      quantity,
    );
  }

  private buildCatalogWhere(query: Pick<ListDeliveryCatalogProductsQueryDto, 'categoryId' | 'keyword'>) {
    const keyword = query.keyword?.trim();
    const andConditions: Prisma.DeliveryProductWhereInput[] = [
      {
        OR: [{ categoryId: null }, { category: { status: 'ACTIVE' } }],
      },
    ];

    if (query.categoryId) {
      andConditions.push({
        categoryId: query.categoryId,
        category: {
          status: 'ACTIVE',
        },
      });
    }

    if (keyword) {
      andConditions.push({
        OR: [
          {
            title: {
              contains: keyword,
              mode: 'insensitive',
            },
          },
          {
            subtitle: {
              contains: keyword,
              mode: 'insensitive',
            },
          },
          {
            searchKeywords: {
              has: keyword,
            },
          },
        ],
      });
    }

    return {
      status: 'ACTIVE',
      auditStatus: 'APPROVED',
      merchant: {
        status: 'ACTIVE',
      },
      skus: {
        some: {
          isActive: true,
        },
      },
      AND: andConditions,
    } satisfies Prisma.DeliveryProductWhereInput;
  }

  private mapCatalogProduct(
    product: CatalogProductPayload,
    platformRules: any[],
    merchantRules: any[],
    quantity: number,
  ) {
    const skus = product.skus.map((sku) => {
      const pricing = this.deliveryPricingService.resolvePrice({
        basePriceCents: sku.basePriceCents,
        fixedFinalPriceCents: sku.fixedFinalPriceCents,
        quantity,
        merchantDefaultMarkupBps: product.merchant.defaultMarkupBps,
        rules: [...platformRules, ...merchantRules, ...product.priceRules, ...sku.priceRules],
      });

      return {
        id: sku.id,
        title: sku.title,
        imageUrl: sku.imageUrl,
        stock: sku.stock,
        minOrderQuantity: sku.minOrderQuantity,
        orderStepQuantity: sku.orderStepQuantity,
        finalPriceCents: pricing.finalPriceCents,
        pricingSource: pricing.matchedSource,
      };
    });

    const minFinalPriceCents = skus.length
      ? Math.min(...skus.map((sku) => sku.finalPriceCents))
      : null;

    return {
      id: product.id,
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      detailRich: product.detailRich,
      media: product.media,
      attributes: product.attributes,
      unitName: product.unitName,
      minOrderQuantity: product.minOrderQuantity,
      orderStepQuantity: product.orderStepQuantity,
      merchant: product.merchant,
      category: product.category,
      minFinalPriceCents,
      skus,
    };
  }

  private async loadMerchantRulesByMerchantId(merchantIds: string[]) {
    const uniqueMerchantIds = Array.from(new Set(merchantIds.filter(Boolean)));
    if (!uniqueMerchantIds.length) {
      return new Map<string, any[]>();
    }

    const merchantRules = await this.listActivePriceRules({
      scope: DeliveryPriceRuleScope.MERCHANT,
      merchantId: {
        in: uniqueMerchantIds,
      },
    });

    return merchantRules.reduce((map, rule) => {
      if (!rule.merchantId) {
        return map;
      }

      const existingRules = map.get(rule.merchantId) ?? [];
      existingRules.push(rule);
      map.set(rule.merchantId, existingRules);
      return map;
    }, new Map<string, typeof merchantRules>());
  }

  private listActivePriceRules(where: Prisma.DeliveryPriceRuleWhereInput) {
    return this.deliveryPrisma.deliveryPriceRule.findMany({
      where: {
        ...where,
        isActive: true,
      },
      orderBy: [{ priority: 'desc' }, { minQuantity: 'asc' }, { createdAt: 'desc' }],
    });
  }
}
