import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminInvoiceQueryDto, IssueInvoiceDto, FailInvoiceDto } from './dto/admin-invoice.dto';

@Injectable()
export class AdminInvoicesService {
  constructor(private prisma: PrismaService) {}

  /** 发票列表（含筛选） */
  async findAll(query: AdminInvoiceQueryDto, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const where: any = {};

    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { invoiceNo: { contains: query.keyword } },
        { order: { id: query.keyword } },
      ];
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              totalAmount: true,
              status: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  profile: { select: { nickname: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map((inv) => {
        const snapshot = inv.profileSnapshot as any;
        const order = inv.order;
        return {
          ...inv,
          profileType: snapshot?.type || null,
          profileTitle: snapshot?.title || null,
          orderAmount: order?.totalAmount || 0,
          buyerNickname: order?.user?.profile?.nickname || '未知用户',
          order: order ? {
            id: order.id,
            orderNo: order.id,
            totalAmount: order.totalAmount,
            paymentAmount: order.totalAmount,
            status: order.status,
            createdAt: order.createdAt,
            user: {
              id: order.user?.id,
              nickname: order.user?.profile?.nickname || '未知用户',
            },
          } : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 发票详情 */
  async findById(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            totalAmount: true,
            goodsAmount: true,
            shippingFee: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                profile: { select: { nickname: true } },
              },
            },
            items: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                productSnapshot: true,
              },
            },
          },
        },
      },
    });
    if (!invoice) throw new NotFoundException('发票不存在');

    const order = invoice.order;
    return {
      ...invoice,
      order: order ? {
        id: order.id,
        orderNo: order.id,
        totalAmount: order.totalAmount,
        paymentAmount: order.totalAmount,
        goodsAmount: order.goodsAmount,
        shippingFee: order.shippingFee,
        status: order.status,
        createdAt: order.createdAt,
        user: {
          id: order.user?.id,
          nickname: order.user?.profile?.nickname || '未知用户',
        },
        items: order.items.map((item) => {
          const snap = item.productSnapshot as any;
          return {
            id: item.id,
            productTitle: snap?.title || '未知商品',
            productImage: snap?.image || null,
            skuName: snap?.skuTitle || null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.unitPrice * item.quantity,
          };
        }),
      } : null,
    };
  }

  /** 各状态数量统计 */
  async getStats() {
    const counts = await this.prisma.invoice.groupBy({
      by: ['status'],
      _count: true,
    });
    const stats: Record<string, number> = {};
    let total = 0;
    for (const c of counts) {
      stats[c.status] = c._count;
      total += c._count;
    }
    stats.ALL = total;
    return stats;
  }

  /**
   * 开票
   * Serializable 隔离级别 + CAS 防并发
   */
  async issueInvoice(invoiceId: string, dto: IssueInvoiceDto) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.findUnique({
            where: { id: invoiceId },
          });
          if (!invoice) throw new NotFoundException('发票不存在');
          if (invoice.status !== 'REQUESTED') {
            throw new BadRequestException('仅待开票状态的发票可执行开票操作');
          }

          // CAS：updateMany + where status 条件
          const result = await tx.invoice.updateMany({
            where: { id: invoiceId, status: 'REQUESTED' },
            data: {
              status: 'ISSUED',
              invoiceNo: dto.invoiceNo,
              pdfUrl: dto.pdfUrl,
              issuedAt: new Date(),
            },
          });
          if (result.count === 0) {
            throw new ConflictException('发票状态已变更，请刷新后重试');
          }

          return { ok: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        // P2034: Serializable 事务冲突，重试
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) continue;
        throw e;
      }
    }
  }

  /**
   * 标记开票失败
   * Serializable 隔离级别 + CAS 防并发
   */
  async failInvoice(invoiceId: string, dto: FailInvoiceDto) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.findUnique({
            where: { id: invoiceId },
          });
          if (!invoice) throw new NotFoundException('发票不存在');
          if (invoice.status !== 'REQUESTED') {
            throw new BadRequestException('仅待开票状态的发票可标记失败');
          }

          const result = await tx.invoice.updateMany({
            where: { id: invoiceId, status: 'REQUESTED' },
            data: { status: 'FAILED', failReason: dto.reason },
          });
          if (result.count === 0) {
            throw new ConflictException('发票状态已变更，请刷新后重试');
          }

          return { ok: true, reason: dto.reason };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) continue;
        throw e;
      }
    }
  }
}
