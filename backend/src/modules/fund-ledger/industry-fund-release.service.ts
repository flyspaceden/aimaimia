import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IndustryFundError, IndustryFundService } from './industry-fund.service';

/** 独立于旧个人 Reward 解冻任务，新账单条事务失败不阻塞整个批次。 */
@Injectable()
export class IndustryFundReleaseService {
  private readonly logger = new Logger(IndustryFundReleaseService.name);
  private cursor: string | undefined;
  private upperBound: string | undefined;
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly funds: IndustryFundService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async releaseMatured() {
    if (this.running) return;
    this.running = true;
    try {
      // 固定一轮扫描上界；新流入不能无限推迟对失败记录的下一轮重试。
      if (!this.upperBound) {
        const last = await this.prisma.industryFundAccrual.findFirst({ where: { frozenAmount: { gt: 0 }, order: { returnWindowExpiresAt: { lte: new Date() } } }, orderBy: { id: 'desc' }, select: { id: true } });
        if (!last) return;
        this.upperBound = last.id;
      }
      const rows = await this.prisma.industryFundAccrual.findMany({
        where: { frozenAmount: { gt: 0 }, id: { lte: this.upperBound, ...(this.cursor ? { gt: this.cursor } : {}) }, order: { returnWindowExpiresAt: { lte: new Date() } } },
        orderBy: { id: 'asc' }, take: 200, select: { id: true, orderId: true },
      });
      for (const row of rows) {
        try {
          await this.prisma.$transaction(async tx => {
            const success = await tx.afterSaleRequest.findFirst({ where: { orderId: row.orderId, status: { in: ['REFUNDED', 'COMPLETED'] } }, select: { id: true } });
            if (success) await this.funds.reverseOrderInTransaction(tx, row.orderId, 'AFTER_SALE_SUCCESS', success.id);
            else await this.funds.releaseAccrual(tx, { accrualId: row.id, idempotencyKey: `industry-fund:release:${row.id}`, actorType: 'SYSTEM' });
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
        } catch (error) {
          const code = error instanceof IndustryFundError ? error.code : 'TRANSACTION_FAILED';
          this.logger.warn(`公司产业基金待重试：accrual=${row.id}, code=${code}`);
        }
        this.cursor = row.id;
      }
      if (rows.length < 200 || this.cursor === this.upperBound) { this.cursor = undefined; this.upperBound = undefined; }
    } finally { this.running = false; }
  }
}
