import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationRegistry } from './notification.registry';
import { NotificationEvent } from './notification.types';
import { MiniProgramSubscriptionService } from '../mini-program/mini-program-subscription.service';

type OutboxRow = {
  id: string;
  payload: unknown;
  status: 'PENDING' | 'PROCESSING' | 'FAILED';
  attempts: number;
  runAt: Date;
  updatedAt: Date;
};

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private readonly staleProcessingMs = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationRegistry,
    @Optional() private readonly miniProgramSubscriptions?: MiniProgramSubscriptionService,
  ) {}

  @Cron('*/10 * * * * *')
  async dispatchCron() {
    await this.dispatchPending(50);
  }

  async dispatchPending(limit = 50) {
    const now = new Date();
    const staleProcessingBefore = new Date(now.getTime() - this.staleProcessingMs);
    const batchSize =
      Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : 50;
    // 大批次给 FAILED 保留不超过 10% 的重驱配额，确保依赖恢复后能自愈；
    // 单条批次始终优先新消息，避免永久“毒消息”饿死新红包。
    const failedQuota =
      batchSize > 1
        ? Math.max(1, Math.floor(batchSize * 0.1))
        : 0;
    const failedCandidates =
      await this.prisma.notificationOutbox.findMany({
        where: {
          status: 'FAILED',
          runAt: { lte: now },
        },
        orderBy: { createdAt: 'asc' },
        take: batchSize,
      });
    const failedRows =
      failedCandidates.slice(0, failedQuota);
    const primaryRows = await this.prisma.notificationOutbox.findMany({
      where: {
        OR: [
          { status: 'PENDING', runAt: { lte: now } },
          { status: 'PROCESSING', processingAt: { lt: staleProcessingBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize - failedRows.length,
    });
    const remaining =
      batchSize - primaryRows.length - failedRows.length;
    // 主队列没有填满时继续使用 FAILED 候选补齐整批，不能因为已经
    // 取到一条保留配额就让其余容量闲置。
    const fallbackFailedRows =
      remaining > 0
        ? failedCandidates.slice(
            failedRows.length,
            failedRows.length + remaining,
          )
        : [];
    const rows = [
      ...primaryRows,
      ...failedRows,
      ...fallbackFailedRows,
    ];

    for (const row of rows) {
      await this.dispatchOne(row as OutboxRow);
    }
  }

  private async dispatchOne(row: OutboxRow) {
    const previousAttempts = row.attempts;
    const claimedAt = new Date();
    const claimResult = await this.prisma.notificationOutbox.updateMany({
      where: {
        id: row.id,
        status: row.status,
        attempts: previousAttempts,
        runAt: row.runAt,
        updatedAt: row.updatedAt,
      },
      data: {
        status: 'PROCESSING',
        processingAt: claimedAt,
        attempts: { increment: 1 },
      },
    });

    if (claimResult.count === 0) {
      return;
    }

    const nextAttempts = previousAttempts + 1;

    try {
      const event = row.payload as NotificationEvent;
      const resolved = await this.registry.resolve(event);

      for (const message of resolved.messages) {
        await this.prisma.notificationMessage.upsert({
          where: {
            recipientKey_idempotencyKey: {
              recipientKey: message.recipientKey,
              idempotencyKey: message.idempotencyKey,
            },
          },
          update: {},
          create: {
            ...message,
            action: (message.action ?? null) as never,
            metadata: (message.metadata ?? null) as never,
          },
        });
        if (this.miniProgramSubscriptions) {
          await this.miniProgramSubscriptions.enqueueFromNotification(event, message);
        }
      }

      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
      this.logger.warn(`通知派发失败: outboxId=${row.id}, error=${message}`);

      await this.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: nextAttempts >= 5 ? 'FAILED' : 'PENDING',
          lastError: message,
          runAt: new Date(Date.now() + Math.min(60_000, 2 ** Math.max(nextAttempts, 1) * 1000)),
        },
      });
    }
  }
}
