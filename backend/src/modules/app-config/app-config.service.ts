import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD = 10;

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPublicConfig() {
    const row = await this.prisma.ruleConfig.findUnique({
      where: { key: 'LOW_STOCK_DISPLAY_THRESHOLD' },
      select: { value: true },
    });
    const raw = this.unwrap(row?.value, DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD);
    const valid = Number.isInteger(raw) && raw >= 0 && raw <= 999;
    const lowStockDisplayThreshold = valid ? raw : DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD;

    // 仅在管理员已经存过值但解析/校验失败时告警；首次部署无 row 是预期默认值，不刷日志。
    if (row != null && !valid) {
      this.logger.warn(
        `LOW_STOCK_DISPLAY_THRESHOLD 解析无效已回退默认 ${DEFAULT_LOW_STOCK_DISPLAY_THRESHOLD}: rawValue=${JSON.stringify(row.value)}`,
      );
    }

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
