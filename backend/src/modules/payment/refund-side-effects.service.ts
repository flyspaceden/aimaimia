import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import { DigitalAssetService } from '../digital-asset/digital-asset.service';
import { CaptainCommissionService } from '../captain/captain-commission.service';

type Tx = Prisma.TransactionClient;
type ProfitMode = 'V3' | 'LEGACY' | 'NOOP' | null;
const EFFECT_KINDS = [
  'DIGITAL_ASSET_REVERSAL',
  'CAPTAIN_COMMISSION_VOID',
] as const;
type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * 非售后自动退款的可靠副作用执行器。
 * Refund=REFUNDED 与 outbox 同一 Serializable 事务落库；
 * 租约 + CAS 确保多实例与进程崩溃后可安全重放。
 */
@Injectable()
export class RefundSideEffectsService {
  private readonly logger = new Logger(RefundSideEffectsService.name);
  private readonly leaseMs = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly digitalAssetService: DigitalAssetService,
    private readonly captainCommissionService: CaptainCommissionService,
  ) {}

  async enqueueInTransaction(
    tx: Tx,
    input: {
      refundId: string;
      orderId: string;
      refundAmount: number;
      profitMode: ProfitMode;
    },
  ): Promise<void> {
    const kinds: EffectKind[] = ['DIGITAL_ASSET_REVERSAL'];
    if (input.profitMode !== 'V3') kinds.push('CAPTAIN_COMMISSION_VOID');
    await tx.refundSideEffectOutbox.createMany({
      data: kinds.map((kind) => ({
        refundId: input.refundId,
        orderId: input.orderId,
        refundAmount: input.refundAmount,
        kind,
        source: 'AUTO_REFUND',
      })),
      skipDuplicates: true,
    });
  }

  kick(refundId: string): void {
    void this.processRefund(refundId).catch((error) => {
      const safe = sanitizeErrorForLog(error);
      this.logger.warn(`自动退款 outbox 立即执行失败: refundId=${refundId}; error=${safe.message}`);
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processPending(): Promise<void> {
    const now = new Date();
    const pending = await this.prisma.refundSideEffectOutbox.findMany({
      where: {
        runAt: { lte: now },
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
        ],
      },
      select: { refundId: true },
      distinct: ['refundId'],
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const row of pending) await this.processRefund(row.refundId);
  }

  async processRefund(refundId: string): Promise<void> {
    const rows = await this.prisma.refundSideEffectOutbox.findMany({
      where: { refundId, status: { not: 'SUCCEEDED' } },
    });
    const byKind = new Map(rows.map((row) => [row.kind as EffectKind, row]));
    // 两项副作用相互独立：一项失败不阻塞另一项。
    for (const kind of EFFECT_KINDS) {
      const row = byKind.get(kind);
      if (row) await this.processOne(row as any);
    }
  }

  private async processOne(row: {
    id: string;
    refundId: string;
    orderId: string;
    refundAmount: number;
    kind: EffectKind;
    attempts: number;
  }): Promise<void> {
    const now = new Date();
    const leaseToken = randomUUID();
    const claimed = await this.prisma.refundSideEffectOutbox.updateMany({
      where: {
        id: row.id,
        runAt: { lte: now },
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        processingAt: now,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
        lastError: null,
      },
    });
    if (claimed.count !== 1) return;

    try {
      const refund = await this.prisma.refund.findUnique({
        where: { id: row.refundId },
        select: {
          id: true,
          orderId: true,
          amount: true,
          status: true,
          afterSaleId: true,
          merchantRefundNo: true,
        },
      });
      const isAutoRefund = refund
        && refund.status === 'REFUNDED'
        && !refund.afterSaleId
        && !refund.merchantRefundNo.startsWith('AS-');
      if (!isAutoRefund) {
        await this.markSucceeded(row.id, leaseToken, '非已成功自动退款，副作用作废');
        return;
      }

      if (row.kind === 'DIGITAL_ASSET_REVERSAL') {
        // reverseRefund 内部使用 refund:* 唯一流水键。
        await this.digitalAssetService.reverseRefund(row.refundId);
      } else {
        // 防御性再检查：历史 backfill 或之后的对账若已有 READY V3 快照，
        // 团长冲正由 V3 来源级逻辑负责，不再跑 legacy 整单 void。
        const v3Snapshot = await this.prisma.orderProfitSnapshot.findFirst({
          where: { orderId: row.orderId, isCurrent: true, status: 'READY' },
          select: { id: true },
        });
        if (!v3Snapshot) {
          // voidForRefund 会先查同 refundId VOID 流水，并以
          // captain:void:order:refund:ledger 唯一键收敛崩溃重放。
          await this.captainCommissionService.voidForRefund(
            row.orderId,
            row.refundId,
            row.refundAmount,
          );
        }
      }
      await this.markSucceeded(row.id, leaseToken);
    } catch (error) {
      const safe = sanitizeErrorForLog(error);
      const attempts = row.attempts + 1;
      const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 7));
      await this.prisma.refundSideEffectOutbox.updateMany({
        where: { id: row.id, status: 'PROCESSING', leaseToken },
        data: {
          status: 'FAILED',
          runAt: new Date(Date.now() + delayMs),
          processingAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: safe.message.slice(0, 2000),
        },
      });
      this.logger.error(
        `自动退款副作用失败，已持久化重试: refundId=${row.refundId}; kind=${row.kind}; error=${safe.message}`,
        safe.stack,
      );
    }
  }

  private async markSucceeded(id: string, leaseToken: string, note?: string): Promise<void> {
    await this.prisma.refundSideEffectOutbox.updateMany({
      where: { id, status: 'PROCESSING', leaseToken },
      data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        processingAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: note ?? null,
      },
    });
  }
}
