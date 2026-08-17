import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProfitSafetySku } from '../profit/profit-safety-validator';

const PRICE_EPSILON = 0.000001;

type PricingReader = Pick<
  Prisma.TransactionClient,
  'product' | 'productSKU' | 'ruleConfig'
>;

export interface MarkupRepriceExample {
  productId: string;
  productTitle: string;
  skuId: string;
  skuTitle: string;
  cost: number;
  currentPrice: number;
  nextPrice: number;
  difference: number;
}

export interface MarkupRepricePreview {
  currentMarkupRate: number;
  nextMarkupRate: number;
  eligibleProductCount: number;
  eligibleSkuCount: number;
  affectedProductCount: number;
  affectedSkuCount: number;
  priceIncreaseCount: number;
  priceDecreaseCount: number;
  unchangedSkuCount: number;
  previewToken: string;
  examples: MarkupRepriceExample[];
}

interface MarkupRepriceItem extends MarkupRepriceExample {
  productStatus: string;
  skuStatus: string;
  companyId: string;
  categoryId: string | null;
  ordinary: boolean;
}

export interface MarkupRepricePlan {
  preview: MarkupRepricePreview;
  items: MarkupRepriceItem[];
  profitSafetySkus: ProfitSafetySku[];
}

@Injectable()
export class ProductPricingService {
  constructor(private readonly prisma: PrismaService) {}

  calculatePrice(cost: number, markupRate: number): number {
    return +(Number(cost) * Number(markupRate)).toFixed(2);
  }

  async getCurrentMarkupRate(reader: PricingReader = this.prisma): Promise<number> {
    const config = await reader.ruleConfig.findUnique({
      where: { key: 'MARKUP_RATE' },
      select: { value: true },
    });
    return this.readMarkupRate(config?.value);
  }

  async previewMarkupReprice(nextMarkupRate: number): Promise<MarkupRepricePreview> {
    return (await this.previewMarkupRepricePlan(nextMarkupRate)).preview;
  }

  async previewMarkupRepricePlan(nextMarkupRate: number): Promise<MarkupRepricePlan> {
    return this.prisma.$transaction(async (tx) => {
      return this.buildMarkupRepricePlan(tx, nextMarkupRate);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 15_000,
    });
  }

  async buildMarkupRepricePlan(
    reader: PricingReader,
    nextMarkupRate: number,
  ): Promise<MarkupRepricePlan> {
    if (!Number.isFinite(nextMarkupRate) || nextMarkupRate < 1 || nextMarkupRate > 10) {
      throw new BadRequestException('加价率必须在 1.00 到 10.00 之间');
    }

    const [currentMarkupRate, rows] = await Promise.all([
      this.getCurrentMarkupRate(reader),
      reader.productSKU.findMany({
        where: {
          cost: { gt: 0 },
          product: {
            status: { not: 'DRAFT' },
            company: { isPlatform: false },
          },
        },
        select: {
          id: true,
          title: true,
          price: true,
          cost: true,
          status: true,
          product: {
            select: {
              id: true,
              title: true,
              companyId: true,
              categoryId: true,
              status: true,
              lotteryPrizes: { select: { id: true }, take: 1 },
            },
          },
          vipGiftItems: { select: { id: true }, take: 1 },
        },
        orderBy: { id: 'asc' },
      }),
    ]);

    const items: MarkupRepriceItem[] = rows.map((row) => {
      const cost = Number(row.cost);
      const currentPrice = Number(row.price);
      const nextPrice = this.calculatePrice(cost, nextMarkupRate);
      return {
        productId: row.product.id,
        productTitle: row.product.title,
        skuId: row.id,
        skuTitle: row.title,
        cost,
        currentPrice,
        nextPrice,
        difference: +(nextPrice - currentPrice).toFixed(2),
        productStatus: row.product.status,
        skuStatus: row.status,
        companyId: row.product.companyId,
        categoryId: row.product.categoryId ?? null,
        ordinary:
          (row.product.lotteryPrizes?.length ?? 0) === 0
          && (row.vipGiftItems?.length ?? 0) === 0,
      };
    });

    const affected = items.filter(
      (item) => Math.abs(item.currentPrice - item.nextPrice) > PRICE_EPSILON,
    );
    const eligibleProductIds = new Set(items.map((item) => item.productId));
    const affectedProductIds = new Set(affected.map((item) => item.productId));
    const previewToken = this.createPreviewToken(currentMarkupRate, nextMarkupRate, items);
    const examples = [...affected]
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.skuId.localeCompare(b.skuId))
      .slice(0, 8)
      .map((item) => ({
        productId: item.productId,
        productTitle: item.productTitle,
        skuId: item.skuId,
        skuTitle: item.skuTitle,
        cost: item.cost,
        currentPrice: item.currentPrice,
        nextPrice: item.nextPrice,
        difference: item.difference,
      }));

    return {
      items,
      profitSafetySkus: items.map((item) => ({
        id: item.skuId,
        productId: item.productId,
        productTitle: item.productTitle,
        skuTitle: item.skuTitle,
        companyId: item.companyId,
        categoryId: item.categoryId,
        price: item.nextPrice,
        cost: item.cost,
        active: item.productStatus === 'ACTIVE' && item.skuStatus === 'ACTIVE',
        ordinary: item.ordinary,
        vipDiscountEligible: true,
      })),
      preview: {
        currentMarkupRate,
        nextMarkupRate,
        eligibleProductCount: eligibleProductIds.size,
        eligibleSkuCount: items.length,
        affectedProductCount: affectedProductIds.size,
        affectedSkuCount: affected.length,
        priceIncreaseCount: affected.filter((item) => item.difference > 0).length,
        priceDecreaseCount: affected.filter((item) => item.difference < 0).length,
        unchangedSkuCount: items.length - affected.length,
        previewToken,
        examples,
      },
    };
  }

  assertMarkupRepriceConfirmed(
    plan: MarkupRepricePlan,
    repriceExisting?: boolean,
    previewToken?: string,
  ): void {
    const requiresConfirmation =
      Math.abs(plan.preview.currentMarkupRate - plan.preview.nextMarkupRate) > PRICE_EPSILON
      || plan.preview.affectedSkuCount > 0;
    if (!requiresConfirmation) return;

    if (!repriceExisting || !previewToken) {
      throw new BadRequestException({
        code: 'MARKUP_REPRICE_CONFIRMATION_REQUIRED',
        message: '修改加价率会同步更新现有普通商品售价，请先预览并确认',
        preview: plan.preview,
      });
    }
    if (previewToken !== plan.preview.previewToken) {
      throw new BadRequestException({
        code: 'MARKUP_REPRICE_PREVIEW_STALE',
        message: '商品成本或价格已发生变化，请重新预览后再确认',
        preview: plan.preview,
      });
    }
  }

  async applyMarkupReprice(
    tx: Prisma.TransactionClient,
    plan: MarkupRepricePlan,
  ): Promise<MarkupRepricePreview> {
    const markupRate = plan.preview.nextMarkupRate;
    await tx.$executeRaw`
      UPDATE "ProductSKU" AS sku
      SET "price" = ROUND((sku."cost"::numeric * ${markupRate}::numeric), 2)::double precision,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM "Product" AS product
      JOIN "Company" AS company ON company."id" = product."companyId"
      WHERE sku."productId" = product."id"
        AND sku."cost" > 0
        AND product."status" <> 'DRAFT'
        AND company."isPlatform" = false
    `;
    await tx.$executeRaw`
      UPDATE "Product" AS product
      SET "basePrice" = rollup.min_price,
          "cost" = rollup.min_cost,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM (
        SELECT sku."productId",
               MIN(sku."price") AS min_price,
               MIN(sku."cost") AS min_cost
        FROM "ProductSKU" AS sku
        WHERE sku."status" = 'ACTIVE'
        GROUP BY sku."productId"
      ) AS rollup,
      "Company" AS company
      WHERE product."id" = rollup."productId"
        AND company."id" = product."companyId"
        AND product."status" <> 'DRAFT'
        AND company."isPlatform" = false
    `;
    return plan.preview;
  }

  private readMarkupRate(value: unknown): number {
    const raw = value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(value, 'value')
      ? (value as { value: unknown }).value
      : value;
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate < 1 || rate > 10) {
      throw new BadRequestException('MARKUP_RATE 配置缺失或不合法，已拒绝商品价格操作');
    }
    return rate;
  }

  private createPreviewToken(
    currentMarkupRate: number,
    nextMarkupRate: number,
    items: MarkupRepriceItem[],
  ): string {
    const canonical = {
      currentMarkupRate,
      nextMarkupRate,
      items: items.map((item) => [
        item.productId,
        item.skuId,
        item.cost,
        item.currentPrice,
        item.nextPrice,
      ]),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
}
