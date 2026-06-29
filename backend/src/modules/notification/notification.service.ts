import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationEvent } from './notification.types';

type NotificationOutboxClient = Pick<PrismaService, 'notificationOutbox'>;

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(event: NotificationEvent, client: NotificationOutboxClient = this.prisma) {
    const idempotencyKey =
      event.idempotencyKey || `${event.eventType}:${event.aggregateType}:${event.aggregateId}`;

    return client.notificationOutbox.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        idempotencyKey,
        payload: event as never,
      },
    });
  }
}
