import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminInvoicesService } from '../admin/invoices/admin-invoices.service';

const RETRY_BATCH_SIZE = 20;
const MIN_AGE_MS = 10 * 60 * 1000; // 距上次尝试至少 10 分钟

@Injectable()
export class InvoiceAutoIssueRetryService {
  private readonly logger = new Logger(InvoiceAutoIssueRetryService.name);

  constructor(
    private prisma: PrismaService,
    private adminInvoicesService: AdminInvoicesService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleRetries() {
    try {
      const settings = await this.adminInvoicesService.getInvoiceSettings();
      if (!settings.autoIssue) return;

      const cutoff = new Date(Date.now() - MIN_AGE_MS);

      // Soft-failed candidates: failedAttempts ∈ [1, max-1], cooldown elapsed
      const candidates = await this.prisma.invoice.findMany({
        where: {
          status: 'REQUESTED',
          providerRequestId: null,
          failedAttempts: { gt: 0, lt: settings.autoIssueMaxAttempts },
          OR: [
            { lastAutoIssueAttemptAt: null },
            { lastAutoIssueAttemptAt: { lt: cutoff } },
          ],
        },
        select: { id: true },
        take: RETRY_BATCH_SIZE,
        orderBy: { lastAutoIssueAttemptAt: 'asc' },
      });

      for (const inv of candidates) {
        try {
          await this.adminInvoicesService.issueInvoice(
            inv.id,
            { mode: settings.providerMode },
            null,
          );
        } catch (e: any) {
          this.logger.warn(`[auto-issue-retry] ${inv.id} retry failed: ${e?.message}`);
        }
      }

      // Exhausted candidates: failedAttempts >= max → force FAILED
      const exhausted = await this.prisma.invoice.findMany({
        where: {
          status: 'REQUESTED',
          providerRequestId: null,
          failedAttempts: { gte: settings.autoIssueMaxAttempts },
        },
        select: { id: true },
        take: RETRY_BATCH_SIZE,
      });

      for (const inv of exhausted) {
        try {
          await this.adminInvoicesService.markAutoIssueRetryExhausted(inv.id);
        } catch (e: any) {
          this.logger.warn(`[auto-issue-retry] ${inv.id} exhaust failed: ${e?.message}`);
        }
      }
    } catch (e: any) {
      this.logger.error('[auto-issue-retry] cycle failed', e);
    }
  }
}
