import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  NotificationAudience,
  NotificationRecipientKind,
  NotificationSeverity,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationMessageService } from '../notification/notification-message.service';

@Injectable()
export class InboxService {
  constructor(
    private prisma: PrismaService,
    private notificationMessages: NotificationMessageService,
  ) {}

  private recipientKey(userId: string) {
    return `buyer:${userId}`;
  }

  /** 消息列表（筛选） */
  async list(userId: string, category?: string, unreadOnly?: boolean) {
    return this.notificationMessages.list(this.recipientKey(userId), category, unreadOnly);
  }

  /** 标记单条已读 */
  async markRead(id: string, userId: string) {
    return this.notificationMessages.markRead(this.recipientKey(userId), id);
  }

  /** 全部已读 */
  async markAllRead(userId: string) {
    return this.notificationMessages.markAllRead(this.recipientKey(userId));
  }

  /** 未读数 */
  async getUnreadCount(userId: string) {
    return this.notificationMessages.unreadCount(this.recipientKey(userId));
  }

  /** @deprecated 临时兼容旧 InboxService.send 调用，统一写入 NotificationMessage。 */
  async send(params: {
    userId: string;
    category: string;
    type: string;
    title: string;
    content: string;
    target?: Record<string, any>;
  }) {
    const action = this.toNotificationAction(params);
    const message = await this.prisma.notificationMessage.create({
      data: {
        recipientKind: NotificationRecipientKind.BUYER_USER,
        recipientKey: this.recipientKey(params.userId),
        audience: NotificationAudience.BUYER_APP,
        category: params.category,
        eventType: params.type,
        title: params.title,
        body: params.content,
        severity: NotificationSeverity.INFO,
        entityType: 'inbox',
        entityId: params.userId,
        action: (action as Prisma.InputJsonValue | undefined) || undefined,
        metadata: undefined,
        idempotencyKey: `legacy-inbox:${params.userId}:${params.type}:${Date.now()}:${randomUUID()}`,
      },
    });

    return this.mapMessage(message);
  }

  private toNotificationAction(params: { type: string; target?: Record<string, any> }) {
    if (params.type === 'order_receiver_info_required' && params.target?.params?.id) {
      return { routeKey: 'ORDER_RECEIVER_INFO', params: { id: String(params.target.params.id) } };
    }

    return params.target;
  }

  /** 映射为前端 InboxMessage 类型 */
  private mapMessage(message: {
    id: string;
    category: string;
    eventType: string;
    title: string;
    body: string;
    createdAt: Date | string;
    readAt?: Date | null;
    action?: Prisma.JsonValue | null;
  }) {
    const action = message.action ?? undefined;
    return {
      id: message.id,
      category: message.category,
      type: message.eventType,
      title: message.title,
      content: message.body,
      createdAt: message.createdAt instanceof Date
        ? message.createdAt.toISOString()
        : message.createdAt,
      unread: !message.readAt,
      action,
      target: action,
    };
  }
}
