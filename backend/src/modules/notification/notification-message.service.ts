import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationMessageService {
  constructor(private readonly prisma: PrismaService) {}

  async list(recipientKey: string, category?: string, unreadOnly?: boolean, page = 1, pageSize = 20) {
    const take = Math.min(Math.max(pageSize, 1), 50);
    const where: Prisma.NotificationMessageWhereInput = { recipientKey };

    if (category) {
      const categories = this.resolveCategoryFilter(category);
      where.category = categories.length === 1 ? categories[0] : { in: categories };
    }
    if (unreadOnly) {
      where.readAt = null;
    }

    const rows = await this.prisma.notificationMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Math.max(page, 1) - 1) * take,
      take,
    });

    return rows.map((row) => this.map(row));
  }

  async unreadCount(recipientKey: string) {
    return this.prisma.notificationMessage.count({
      where: { recipientKey, readAt: null },
    });
  }

  async markRead(recipientKey: string, id: string) {
    const row = await this.prisma.notificationMessage.findUnique({ where: { id } });
    if (!row || row.recipientKey !== recipientKey) {
      throw new NotFoundException('消息不存在');
    }

    await this.prisma.notificationMessage.update({
      where: { id },
      data: { readAt: row.readAt ?? new Date() },
    });

    return this.list(recipientKey);
  }

  async markAllRead(recipientKey: string) {
    await this.prisma.notificationMessage.updateMany({
      where: { recipientKey, readAt: null },
      data: { readAt: new Date() },
    });

    return this.list(recipientKey);
  }

  private resolveCategoryFilter(category: string): string[] {
    switch (category) {
      case 'transaction':
        return ['transaction', 'order', 'after_sale', 'wallet', 'group_buy'];
      case 'interaction':
        return ['interaction', 'service'];
      case 'system':
        return ['system', 'risk'];
      default:
        return [category];
    }
  }

  private map(row: {
    id: string;
    category: string;
    eventType: string;
    title: string;
    body: string;
    createdAt: Date;
    readAt: Date | null;
    action: Prisma.JsonValue | null;
    severity: string;
    metadata: Prisma.JsonValue | null;
  }) {
    return {
      id: row.id,
      category: row.category,
      type: row.eventType,
      title: row.title,
      content: row.body,
      createdAt: row.createdAt.toISOString(),
      unread: !row.readAt,
      action: row.action ?? undefined,
      target: row.action ?? undefined,
      severity: row.severity,
      metadata: row.metadata ?? undefined,
    };
  }
}
