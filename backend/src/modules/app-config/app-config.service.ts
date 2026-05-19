import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD = 10;

@Injectable()
export class AppConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicConfig() {
    const row = await this.prisma.ruleConfig.findUnique({
      where: { key: 'LOW_STOCK_DISPLAY_THRESHOLD' },
      select: { value: true },
    });
    const raw = this.unwrap(row?.value, DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD);
    const lowStockDisplayThreshold =
      Number.isInteger(raw) && raw >= 0 && raw <= 999
        ? raw
        : DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD;

    return { lowStockDisplayThreshold };
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
