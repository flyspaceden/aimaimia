import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InboxService {
  constructor(private prisma: PrismaService) {}

  /** 消息列表（筛选） */
  async list(userId: string, category?: string, unreadOnly?: boolean) {
    const where: any = { userId };
    if (category) where.category = category;
    if (unreadOnly) where.unread = true;

    const messages = await this.prisma.inboxMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return messages.map((m) => this.mapMessage(m));
  }

  /** 标记单条已读 */
  async markRead(id: string, userId: string) {
    const message = await this.prisma.inboxMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('消息不存在');
    if (message.userId !== userId) throw new NotFoundException('消息不存在');

    await this.prisma.inboxMessage.update({
      where: { id },
      data: { unread: false },
    });

    // 返回更新后的消息列表
    return this.list(userId);
  }

  /** 全部已读 */
  async markAllRead(userId: string) {
    await this.prisma.inboxMessage.updateMany({
      where: { userId, unread: true },
      data: { unread: false },
    });

    return this.list(userId);
  }

  /** 未读数 */
  async getUnreadCount(userId: string) {
    return this.prisma.inboxMessage.count({
      where: { userId, unread: true },
    });
  }

  /** 发送站内消息（供其他模块调用） */
  async send(params: {
    userId: string;
    category: string;
    type: string;
    title: string;
    content: string;
    target?: Record<string, any>;
  }) {
    return this.prisma.inboxMessage.create({
      data: {
        userId: params.userId,
        category: params.category,
        type: params.type,
        title: params.title,
        content: params.content,
        target: params.target || undefined,
      },
    });
  }

  /** 映射为前端 InboxMessage 类型 */
  private mapMessage(message: any) {
    return {
      id: message.id,
      category: message.category,
      type: message.type,
      title: message.title,
      content: message.content,
      createdAt: message.createdAt instanceof Date
        ? message.createdAt.toISOString()
        : message.createdAt,
      unread: message.unread,
      target: message.target || undefined,
    };
  }
}
