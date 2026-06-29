import { Injectable } from '@nestjs/common';
import {
  NotificationEvent,
  NotificationMessageDraft,
  NotificationResolveResult,
} from './notification.types';

@Injectable()
export class NotificationRegistry {
  resolve(event: NotificationEvent): NotificationResolveResult {
    if (event.eventType === 'order.shipped') {
      const buyerUserId = String(event.payload.buyerUserId || '');
      const orderId = String(event.payload.orderId || event.aggregateId);
      return {
        messages: [
          this.buildMessage(event, {
            recipientKind: 'BUYER_USER',
            recipientKey: `buyer:${buyerUserId}`,
            audience: 'BUYER_APP',
            category: 'order',
            title: '订单已发货',
            body: '您的订单已发货，可查看物流进度。',
            severity: 'SUCCESS',
            entityType: 'order',
            entityId: orderId,
            action: { routeKey: 'ORDER_DETAIL', params: { id: orderId } },
          }),
        ],
      };
    }

    throw new Error(`未注册的通知事件: ${event.eventType}`);
  }

  private buildMessage(
    event: NotificationEvent,
    input: Omit<NotificationMessageDraft, 'eventType' | 'idempotencyKey'>,
  ): NotificationMessageDraft {
    return {
      ...input,
      eventType: event.eventType,
      idempotencyKey: `${event.idempotencyKey || `${event.eventType}:${event.aggregateType}:${event.aggregateId}`}:${input.recipientKey}`,
    };
  }
}
