import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationRegistry } from './notification.registry';
import { NotificationEvent } from './notification.types';

type OutboxRow = {
  id: string;
  payload: unknown;
  attempts: number;
};

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: NotificationRegistry,
  ) {}

  @Cron('*/10 * * * * *')
  async dispatchCron() {
    await this.dispatchPending(50);
  }

  async dispatchPending(limit = 50) {
    const rows = await this.prisma.notificationOutbox.findMany({
      where: { status: 'PENDING', runAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    for (const row of rows) {
      await this.dispatchOne(row as OutboxRow);
    }
  }

  private async dispatchOne(row: OutboxRow) {
    const previousAttempts = row.attempts;
    const claimedAt = new Date();
    const claimResult = await this.prisma.notificationOutbox.updateMany({
      where: { id: row.id, status: 'PENDING' },
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
      const resolved = this.registry.resolve(event);

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
