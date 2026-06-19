import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeliveryPriceRuleScope,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryPricingService } from '../pricing/delivery-pricing.service';
import { CreateDeliveryCartItemDto } from './dto/create-delivery-cart-item.dto';
import { UpdateDeliveryCartItemDto } from './dto/update-delivery-cart-item.dto';

const cartItemInclude = {
  sku: {
    include: {
      priceRules: {
        where: {
          isActive: true,
          scope: DeliveryPriceRuleScope.SKU,
        },
      },
      product: {
        include: {
          merchant: {
            select: {
              id: true,
              name: true,
              defaultMarkupBps: true,
              status: true,
            },
          },
          priceRules: {
            where: {
              isActive: true,
              scope: DeliveryPriceRuleScope.PRODUCT,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DeliveryCartItemInclude;

const orderableSkuInclude = {
  priceRules: {
    where: {
      isActive: true,
      scope: DeliveryPriceRuleScope.SKU,
    },
  },
  product: {
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          defaultMarkupBps: true,
          status: true,
        },
      },
      priceRules: {
        where: {
          isActive: true,
          scope: DeliveryPriceRuleScope.PRODUCT,
        },
      },
    },
  },
} satisfies Prisma.DeliveryProductSkuInclude;

type CartItemWithRelations = Prisma.DeliveryCartItemGetPayload<{
  include: typeof cartItemInclude;
}>;

type OrderableSku = Prisma.DeliveryProductSkuGetPayload<{
  include: typeof orderableSkuInclude;
}>;

@Injectable()
export class DeliveryCartService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly deliveryPricingService: DeliveryPricingService,
  ) {}

  async getCart(deliveryUserId: string) {
    const currentUnitId = await this.requireCurrentUnitId(deliveryUserId);
    const [platformRules, items] = await Promise.all([
      this.listActivePriceRules({ scope: DeliveryPriceRuleScope.PLATFORM }),
      this.deliveryPrisma.deliveryCartItem.findMany({
        where: {
          userId: deliveryUserId,
          unitId: currentUnitId,
        },
        include: cartItemInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);
    const merchantRulesByMerchantId = await this.loadMerchantRulesByMerchantId(
      items.map((item) => item.sku.product.merchant.id),
    );

    const mappedItems = items.map((item) => {
      const quantityRule = this.resolveQuantityRule(item.sku, item.sku.product);
      const pricing = this.deliveryPricingService.resolvePrice({
        basePriceCents: item.sku.basePriceCents,
        fixedFinalPriceCents: item.sku.fixedFinalPriceCents,
        quantity: item.quantity,
        merchantDefaultMarkupBps: item.sku.product.merchant.defaultMarkupBps ?? null,
        rules: [
          ...platformRules,
          ...(merchantRulesByMerchantId.get(item.sku.product.merchant.id) ?? []),
          ...item.sku.product.priceRules,
          ...item.sku.priceRules,
        ],
      });
      const lineAmountCents = pricing.finalPriceCents * item.quantity;

      return {
        id: item.id,
        skuId: item.skuId,
        quantity: item.quantity,
        isSelected: item.isSelected,
        productId: item.sku.product.id,
        productTitle: item.sku.product.title,
        skuTitle: item.sku.title,
        imageUrl: item.sku.imageUrl,
        unitName: item.sku.product.unitName,
        merchant: item.sku.product.merchant,
        stock: item.sku.stock,
        minOrderQuantity: quantityRule.minOrderQuantity,
        orderStepQuantity: quantityRule.orderStepQuantity,
        finalPriceCents: pricing.finalPriceCents,
        lineAmountCents,
        pricingSource: pricing.matchedSource,
      };
    });

    return {
      currentUnitId,
      items: mappedItems,
      summary: {
        selectedGoodsAmountCents: mappedItems
          .filter((item) => item.isSelected)
          .reduce((sum, item) => sum + item.lineAmountCents, 0),
      },
    };
  }

  async addItem(deliveryUserId: string, dto: CreateDeliveryCartItemDto) {
    const currentUnitId = await this.requireCurrentUnitId(deliveryUserId);
    const sku = await this.loadOrderableSku(dto.skuId);
    this.assertSkuEligible(sku);
    this.assertQuantityValid(dto.quantity, sku);
    this.assertStockEnough(dto.quantity, sku.stock);

    return this.deliveryPrisma.$transaction(
      async (tx) => {
        const latestSku = await tx.deliveryProductSku.findUnique({
          where: { id: dto.skuId },
          include: orderableSkuInclude,
        });
        if (!latestSku) {
          throw new NotFoundException('配送 SKU 不存在');
        }
        this.assertSkuEligible(latestSku);

        const existing = await tx.deliveryCartItem.findUnique({
          where: {
            userId_unitId_skuId: {
              userId: deliveryUserId,
              unitId: currentUnitId,
              skuId: dto.skuId,
            },
          },
        });
        const nextQuantity = (existing?.quantity ?? 0) + dto.quantity;

        this.assertQuantityValid(nextQuantity, latestSku);
        this.assertStockEnough(nextQuantity, latestSku.stock);

        const item = existing
          ? await tx.deliveryCartItem.update({
              where: { id: existing.id },
              data: {
                quantity: nextQuantity,
                isSelected: true,
              },
            })
          : await tx.deliveryCartItem.create({
              data: {
                userId: deliveryUserId,
                unitId: currentUnitId,
                skuId: dto.skuId,
                quantity: dto.quantity,
                isSelected: true,
              },
            });

        return { item };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async updateItem(deliveryUserId: string, cartItemId: string, dto: UpdateDeliveryCartItemDto) {
    const currentUnitId = await this.requireCurrentUnitId(deliveryUserId);
    if (dto.quantity === undefined && dto.isSelected === undefined) {
      throw new BadRequestException('至少提供一个可更新字段');
    }

    const item = await this.deliveryPrisma.deliveryCartItem.findUnique({
      where: { id: cartItemId },
      include: cartItemInclude,
    });
    if (!item) {
      throw new NotFoundException('配送购物车商品不存在');
    }
    this.assertCartItemScope(item, deliveryUserId, currentUnitId);

    if (dto.quantity !== undefined) {
      this.assertSkuEligible(item.sku);
      this.assertQuantityValid(dto.quantity, item.sku);
      this.assertStockEnough(dto.quantity, item.sku.stock);
    }

    return {
      item: await this.deliveryPrisma.deliveryCartItem.update({
        where: { id: cartItemId },
        data: {
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.isSelected !== undefined ? { isSelected: dto.isSelected } : {}),
        },
      }),
    };
  }

  async removeItem(deliveryUserId: string, cartItemId: string) {
    const currentUnitId = await this.requireCurrentUnitId(deliveryUserId);
    const item = await this.deliveryPrisma.deliveryCartItem.findUnique({
      where: { id: cartItemId },
    });
    if (!item) {
      throw new NotFoundException('配送购物车商品不存在');
    }
    this.assertCartItemScope(item, deliveryUserId, currentUnitId);

    await this.deliveryPrisma.deliveryCartItem.delete({
      where: { id: cartItemId },
    });

    return {
      removedId: cartItemId,
    };
  }

  private async requireCurrentUnitId(deliveryUserId: string) {
    const user = await this.deliveryPrisma.deliveryUser.findUnique({
      where: { id: deliveryUserId },
      select: { currentUnitId: true },
    });

    if (!user) {
      throw new NotFoundException('配送用户不存在');
    }
    if (!user.currentUnitId) {
      throw new BadRequestException('请先选择配送单位');
    }

    return user.currentUnitId;
  }

  private async loadOrderableSku(skuId: string) {
    const sku = await this.deliveryPrisma.deliveryProductSku.findUnique({
      where: { id: skuId },
      include: orderableSkuInclude,
    });

    if (!sku) {
      throw new NotFoundException('配送 SKU 不存在');
    }

    return sku;
  }

  private assertSkuEligible(sku: OrderableSku) {
    if (!sku.isActive) {
      throw new BadRequestException('配送 SKU 已下架');
    }
    if (sku.product.status !== 'ACTIVE' || sku.product.auditStatus !== 'APPROVED') {
      throw new BadRequestException('配送商品不存在或未上架');
    }
    if (sku.product.merchant.status !== 'ACTIVE') {
      throw new BadRequestException('配送商家当前不可下单');
    }
  }

  private assertQuantityValid(quantity: number, sku: Pick<OrderableSku, 'minOrderQuantity' | 'orderStepQuantity'> & {
    product: Pick<OrderableSku['product'], 'minOrderQuantity' | 'orderStepQuantity'>;
  }) {
    const { minOrderQuantity, orderStepQuantity } = this.resolveQuantityRule(sku, sku.product);

    if (quantity < minOrderQuantity) {
      throw new BadRequestException(`购买数量不能低于起订量 ${minOrderQuantity}`);
    }
    if ((quantity - minOrderQuantity) % orderStepQuantity !== 0) {
      throw new BadRequestException(`购买数量必须按 ${orderStepQuantity} 的步长递增`);
    }
  }

  private assertStockEnough(quantity: number, stock: number) {
    if (stock < quantity) {
      throw new BadRequestException('库存不足');
    }
  }

  private resolveQuantityRule(
    sku: Pick<OrderableSku, 'minOrderQuantity' | 'orderStepQuantity'>,
    product: Pick<OrderableSku['product'], 'minOrderQuantity' | 'orderStepQuantity'>,
  ) {
    return {
      minOrderQuantity: sku.minOrderQuantity ?? product.minOrderQuantity ?? 1,
      orderStepQuantity: sku.orderStepQuantity ?? product.orderStepQuantity ?? 1,
    };
  }

  private assertCartItemScope(
    item: Pick<CartItemWithRelations, 'userId' | 'unitId'>,
    deliveryUserId: string,
    currentUnitId: string,
  ) {
    if (item.userId !== deliveryUserId || item.unitId !== currentUnitId) {
      throw new ForbiddenException('当前配送单位下无权操作该购物车商品');
    }
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
