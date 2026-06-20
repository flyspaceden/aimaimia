import { Injectable, Logger } from '@nestjs/common';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';

const DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD = 10;

@Injectable()
export class DeliverySellerPublicService {
  private readonly logger = new Logger(DeliverySellerPublicService.name);

  constructor(private readonly deliveryPrisma: DeliveryPrismaService) {}

  async getPublicConfig() {
    const row = await this.deliveryPrisma.deliveryConfig.findUnique({
      where: { key: 'LOW_STOCK_DISPLAY_THRESHOLD' },
      select: { value: true },
    });

    const raw = this.unwrap(row?.value, DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD);
    const valid = Number.isInteger(raw) && raw >= 0 && raw <= 999;
    if (row != null && !valid) {
      this.logger.warn(
        `Delivery LOW_STOCK_DISPLAY_THRESHOLD invalid; falling back to ${DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD}: rawValue=${JSON.stringify(row.value)}`,
      );
    }

    return {
      lowStockDisplayThreshold: valid ? raw : DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD,
    };
  }

  async listProductUnits() {
    return this.deliveryPrisma.deliveryProductUnit.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sortOrder: true },
    });
  }

  async listCategories() {
    return this.deliveryPrisma.deliveryCategory.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        parentId: true,
        level: true,
        sortOrder: true,
        path: true,
      },
    });
  }

  async listTagCategories(_scope?: string) {
    // Delivery tags are not modeled in the delivery schema yet, so keep this isolated
    // from the main commerce tag tables and return an empty seller-facing dictionary.
    return [];
  }

  private unwrap(raw: unknown, fallback: number): number {
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      Object.prototype.hasOwnProperty.call(raw, 'value')
    ) {
      return Number((raw as { value?: unknown }).value);
    }
    return raw === undefined || raw === null ? fallback : Number(raw);
  }
}
