import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  DeliveryPriceRuleScope,
  DeliveryPriceRuleType,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { CreateDeliveryPriceRuleDto } from './dto/create-delivery-price-rule.dto';
import { ListDeliveryPriceRulesQueryDto } from './dto/list-delivery-price-rules.query.dto';
import { UpdateDeliveryPriceRuleDto } from './dto/update-delivery-price-rule.dto';

export type DeliveryPricingRuleCandidate = {
  id: string;
  scope: DeliveryPriceRuleScope;
  ruleType: DeliveryPriceRuleType;
  minQuantity: number;
  maxQuantity: number | null;
  fixedPriceCents?: number | null;
  markupBps?: number | null;
  priority: number;
  isActive: boolean;
};

export type DeliveryPricingInput = {
  basePriceCents: number;
  quantity: number;
  fixedFinalPriceCents?: number | null;
  merchantDefaultMarkupBps?: number | null;
  rules: DeliveryPricingRuleCandidate[];
};

export type DeliveryPricingResult = {
  finalPriceCents: number;
  matchedSource:
    | 'SKU_FIXED_PRICE'
    | 'SKU_TIER_MARKUP'
    | 'PRODUCT_TIER_MARKUP'
    | 'MERCHANT_TIER_MARKUP'
    | 'MERCHANT_DEFAULT_MARKUP'
    | 'PLATFORM_DEFAULT_MARKUP'
    | 'BASE_PRICE';
  matchedRuleId: string | null;
  appliedMarkupBps: number | null;
};

type DeliveryNormalizedRuleInput = {
  scope: DeliveryPriceRuleScope;
  ruleType: DeliveryPriceRuleType;
  merchantId: string | null;
  productId: string | null;
  skuId: string | null;
  minQuantity: number;
  maxQuantity: number | null;
  fixedPriceCents: number | null;
  markupBps: number | null;
  priority: number;
  isActive: boolean;
  note: string | null;
};

@Injectable()
export class DeliveryPricingService {
  constructor(@Optional() private readonly deliveryPrisma?: DeliveryPrismaService) {}

  resolvePrice(input: DeliveryPricingInput): DeliveryPricingResult {
    const quantity = Math.max(1, Math.floor(input.quantity || 1));
    const basePriceCents = Math.max(0, Math.round(input.basePriceCents || 0));

    if (input.fixedFinalPriceCents !== undefined && input.fixedFinalPriceCents !== null) {
      return {
        finalPriceCents: Math.max(0, Math.round(input.fixedFinalPriceCents)),
        matchedSource: 'SKU_FIXED_PRICE',
        matchedRuleId: null,
        appliedMarkupBps: null,
      };
    }

    const skuFixedRule = this.findBestRule(
      input.rules,
      DeliveryPriceRuleScope.SKU,
      DeliveryPriceRuleType.FIXED_PRICE,
      quantity,
    );
    if (skuFixedRule?.fixedPriceCents !== undefined && skuFixedRule.fixedPriceCents !== null) {
      return {
        finalPriceCents: Math.max(0, Math.round(skuFixedRule.fixedPriceCents)),
        matchedSource: 'SKU_FIXED_PRICE',
        matchedRuleId: skuFixedRule.id,
        appliedMarkupBps: null,
      };
    }

    const skuMarkupRule = this.findBestRule(
      input.rules,
      DeliveryPriceRuleScope.SKU,
      DeliveryPriceRuleType.MARKUP_RATE,
      quantity,
    );
    if (skuMarkupRule?.markupBps !== undefined && skuMarkupRule.markupBps !== null) {
      return {
        finalPriceCents: this.applyMarkup(basePriceCents, skuMarkupRule.markupBps),
        matchedSource: 'SKU_TIER_MARKUP',
        matchedRuleId: skuMarkupRule.id,
        appliedMarkupBps: skuMarkupRule.markupBps,
      };
    }

    const productMarkupRule = this.findBestRule(
      input.rules,
      DeliveryPriceRuleScope.PRODUCT,
      DeliveryPriceRuleType.MARKUP_RATE,
      quantity,
    );
    if (productMarkupRule?.markupBps !== undefined && productMarkupRule.markupBps !== null) {
      return {
        finalPriceCents: this.applyMarkup(basePriceCents, productMarkupRule.markupBps),
        matchedSource: 'PRODUCT_TIER_MARKUP',
        matchedRuleId: productMarkupRule.id,
        appliedMarkupBps: productMarkupRule.markupBps,
      };
    }

    const merchantMarkupRule = this.findBestRule(
      input.rules,
      DeliveryPriceRuleScope.MERCHANT,
      DeliveryPriceRuleType.MARKUP_RATE,
      quantity,
    );
    if (merchantMarkupRule?.markupBps !== undefined && merchantMarkupRule.markupBps !== null) {
      return {
        finalPriceCents: this.applyMarkup(basePriceCents, merchantMarkupRule.markupBps),
        matchedSource: 'MERCHANT_TIER_MARKUP',
        matchedRuleId: merchantMarkupRule.id,
        appliedMarkupBps: merchantMarkupRule.markupBps,
      };
    }

    if (
      input.merchantDefaultMarkupBps !== undefined &&
      input.merchantDefaultMarkupBps !== null &&
      input.merchantDefaultMarkupBps >= 0
    ) {
      return {
        finalPriceCents: this.applyMarkup(basePriceCents, input.merchantDefaultMarkupBps),
        matchedSource: 'MERCHANT_DEFAULT_MARKUP',
        matchedRuleId: null,
        appliedMarkupBps: input.merchantDefaultMarkupBps,
      };
    }

    const platformMarkupRule = this.findBestRule(
      input.rules,
      DeliveryPriceRuleScope.PLATFORM,
      DeliveryPriceRuleType.MARKUP_RATE,
      quantity,
    );
    if (platformMarkupRule?.markupBps !== undefined && platformMarkupRule.markupBps !== null) {
      return {
        finalPriceCents: this.applyMarkup(basePriceCents, platformMarkupRule.markupBps),
        matchedSource: 'PLATFORM_DEFAULT_MARKUP',
        matchedRuleId: platformMarkupRule.id,
        appliedMarkupBps: platformMarkupRule.markupBps,
      };
    }

    return {
      finalPriceCents: basePriceCents,
      matchedSource: 'BASE_PRICE',
      matchedRuleId: null,
      appliedMarkupBps: null,
    };
  }

  async listRules(query: ListDeliveryPriceRulesQueryDto) {
    return {
      items: await this.prisma.deliveryPriceRule.findMany({
        where: {
          ...(query.scope ? { scope: query.scope } : {}),
          ...(query.ruleType ? { ruleType: query.ruleType } : {}),
          ...(query.merchantId ? { merchantId: query.merchantId } : {}),
          ...(query.productId ? { productId: query.productId } : {}),
          ...(query.skuId ? { skuId: query.skuId } : {}),
          ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
        },
        orderBy: [{ scope: 'asc' }, { priority: 'desc' }, { minQuantity: 'asc' }, { createdAt: 'desc' }],
      }),
    };
  }

  async createRule(dto: CreateDeliveryPriceRuleDto, deliveryAdminUserId?: string) {
    const data = await this.normalizeRuleInput(dto);
    const created = await this.prisma.deliveryPriceRule.create({
      data: {
        ...data,
      },
    });
    await this.writeAdminAuditLog(deliveryAdminUserId, {
      action: 'CREATE_RULE',
      targetId: created.id,
      before: null,
      after: created,
      summary: '创建配送定价规则',
    });
    return created;
  }

  async updateRule(id: string, dto: UpdateDeliveryPriceRuleDto, deliveryAdminUserId?: string) {
    const existing = await this.prisma.deliveryPriceRule.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('配送定价规则不存在');
    }

    const data = await this.normalizeRuleInput({
      scope: dto.scope ?? existing.scope,
      ruleType: dto.ruleType ?? existing.ruleType,
      merchantId: dto.merchantId ?? existing.merchantId ?? undefined,
      productId: dto.productId ?? existing.productId ?? undefined,
      skuId: dto.skuId ?? existing.skuId ?? undefined,
      minQuantity: dto.minQuantity ?? existing.minQuantity,
      maxQuantity:
        dto.maxQuantity === undefined ? existing.maxQuantity ?? undefined : dto.maxQuantity ?? undefined,
      fixedPriceCents:
        dto.fixedPriceCents === undefined
          ? existing.fixedPriceCents ?? undefined
          : dto.fixedPriceCents ?? undefined,
      markupBps:
        dto.markupBps === undefined ? existing.markupBps ?? undefined : dto.markupBps ?? undefined,
      priority: dto.priority ?? existing.priority,
      isActive: dto.isActive ?? existing.isActive,
      note: dto.note === undefined ? existing.note ?? undefined : dto.note ?? undefined,
    });

    const updated = await this.prisma.deliveryPriceRule.update({
      where: { id },
      data: {
        ...data,
      },
    });
    await this.writeAdminAuditLog(deliveryAdminUserId, {
      action: 'UPDATE_RULE',
      targetId: updated.id,
      before: existing,
      after: updated,
      summary: '更新配送定价规则',
    });
    return updated;
  }

  private async writeAdminAuditLog(
    deliveryAdminUserId: string | undefined,
    input: {
      action: string;
      targetId: string;
      before: unknown;
      after: unknown;
      summary: string;
    },
  ) {
    if (!deliveryAdminUserId) {
      return;
    }

    await this.prisma.deliveryAuditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: deliveryAdminUserId,
        module: 'pricing',
        action: input.action,
        targetType: 'DeliveryPriceRule',
        targetId: input.targetId,
        summary: input.summary,
        before: this.toAuditJson(input.before),
        after: this.toAuditJson(input.after),
      },
    });
  }

  private toAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private findBestRule(
    rules: DeliveryPricingRuleCandidate[],
    scope: DeliveryPriceRuleScope,
    ruleType: DeliveryPriceRuleType,
    quantity: number,
  ) {
    return rules
      .filter(
        (rule) =>
          rule.scope === scope &&
          rule.ruleType === ruleType &&
          rule.isActive &&
          quantity >= rule.minQuantity &&
          (rule.maxQuantity === null || quantity <= rule.maxQuantity),
      )
      .sort((left, right) => {
        if (right.priority !== left.priority) {
          return right.priority - left.priority;
        }
        if (right.minQuantity !== left.minQuantity) {
          return right.minQuantity - left.minQuantity;
        }
        return left.id.localeCompare(right.id);
      })[0];
  }

  private applyMarkup(basePriceCents: number, markupBps: number) {
    return Math.max(0, Math.round((basePriceCents * (10000 + markupBps)) / 10000));
  }

  private async normalizeRuleInput(
    input: CreateDeliveryPriceRuleDto | Omit<DeliveryNormalizedRuleInput, 'merchantId' | 'productId' | 'skuId'> & {
      merchantId?: string;
      productId?: string;
      skuId?: string;
      note?: string;
    },
  ): Promise<DeliveryNormalizedRuleInput> {
    if (input.maxQuantity !== undefined && input.maxQuantity !== null && input.maxQuantity < input.minQuantity) {
      throw new BadRequestException('最大数量不能小于最小数量');
    }

    if (input.ruleType === DeliveryPriceRuleType.FIXED_PRICE) {
      if (input.fixedPriceCents === undefined || input.fixedPriceCents === null) {
        throw new BadRequestException('固定售价规则必须提供 fixedPriceCents');
      }
    } else if (input.markupBps === undefined || input.markupBps === null) {
      throw new BadRequestException('加价率规则必须提供 markupBps');
    }

    const relation = await this.resolveRuleRelation(input.scope, input.merchantId, input.productId, input.skuId);

    return {
      scope: input.scope,
      ruleType: input.ruleType,
      merchantId: relation.merchantId,
      productId: relation.productId,
      skuId: relation.skuId,
      minQuantity: input.minQuantity,
      maxQuantity: input.maxQuantity ?? null,
      fixedPriceCents:
        input.ruleType === DeliveryPriceRuleType.FIXED_PRICE ? input.fixedPriceCents ?? null : null,
      markupBps: input.ruleType === DeliveryPriceRuleType.MARKUP_RATE ? input.markupBps ?? null : null,
      priority: input.priority ?? 0,
      isActive: input.isActive ?? true,
      note: input.note?.trim() || null,
    };
  }

  private async resolveRuleRelation(
    scope: DeliveryPriceRuleScope,
    merchantId?: string,
    productId?: string,
    skuId?: string,
  ) {
    switch (scope) {
      case DeliveryPriceRuleScope.PLATFORM:
        return {
          merchantId: null,
          productId: null,
          skuId: null,
        };
      case DeliveryPriceRuleScope.MERCHANT: {
        if (!merchantId) {
          throw new BadRequestException('商家级定价规则必须指定 merchantId');
        }
        const merchant = await this.prisma.deliveryMerchant.findUnique({
          where: { id: merchantId },
          select: { id: true },
        });
        if (!merchant) {
          throw new NotFoundException('配送商家不存在');
        }
        return {
          merchantId: merchant.id,
          productId: null,
          skuId: null,
        };
      }
      case DeliveryPriceRuleScope.PRODUCT: {
        if (!productId) {
          throw new BadRequestException('商品级定价规则必须指定 productId');
        }
        const product = await this.prisma.deliveryProduct.findUnique({
          where: { id: productId },
          select: { id: true, merchantId: true },
        });
        if (!product) {
          throw new NotFoundException('配送商品不存在');
        }
        return {
          merchantId: product.merchantId,
          productId: product.id,
          skuId: null,
        };
      }
      case DeliveryPriceRuleScope.SKU: {
        if (!skuId) {
          throw new BadRequestException('SKU 级定价规则必须指定 skuId');
        }
        const sku = await this.prisma.deliveryProductSku.findUnique({
          where: { id: skuId },
          select: {
            id: true,
            productId: true,
            product: {
              select: {
                merchantId: true,
              },
            },
          },
        });
        if (!sku) {
          throw new NotFoundException('配送 SKU 不存在');
        }
        return {
          merchantId: sku.product.merchantId,
          productId: sku.productId,
          skuId: sku.id,
        };
      }
      default:
        throw new BadRequestException('不支持的定价规则范围');
    }
  }

  private get prisma() {
    if (!this.deliveryPrisma) {
      throw new Error('DeliveryPricingService requires DeliveryPrismaService for persistence operations');
    }
    return this.deliveryPrisma;
  }
}
