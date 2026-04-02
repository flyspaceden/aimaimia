import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TraceService {
  constructor(private prisma: PrismaService) {}

  /** 查询商品溯源链 */
  async getProductTrace(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    });
    if (!product) throw new NotFoundException('商品不存在');

    // 通过 ProductTraceLink 查找关联的 TraceBatch
    const traceLinks = await this.prisma.productTraceLink.findMany({
      where: { productId },
      include: {
        batch: {
          include: {
            events: { orderBy: { occurredAt: 'asc' } },
            ownershipClaim: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    });

    return {
      productId: product.id,
      productTitle: product.title,
      batches: traceLinks.map((link) => this.mapBatch(link.batch, link.note)),
    };
  }

  /** 查询订单溯源（通过 OrderItem 关联） */
  async getOrderTrace(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.userId !== userId) throw new NotFoundException('订单不存在');

    const orderItemLinks = await this.prisma.orderItemTraceLink.findMany({
      where: { orderItem: { orderId } },
      include: {
        orderItem: {
          select: {
            id: true,
            productSnapshot: true,
            quantity: true,
          },
        },
        batch: {
          include: {
            events: { orderBy: { occurredAt: 'asc' } },
            ownershipClaim: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    });

    return {
      orderId,
      items: orderItemLinks.map((link) => {
        return {
          orderItemId: link.orderItem.id,
          batches: [this.mapBatch(link.batch)],
        };
      }),
    };
  }

  /** 查询溯源批次详情 */
  async getBatchDetail(batchId: string) {
    const batch = await this.prisma.traceBatch.findUnique({
      where: { id: batchId },
      include: {
        events: { orderBy: { occurredAt: 'asc' } },
        ownershipClaim: true,
        company: { select: { id: true, name: true } },
      },
    });
    if (!batch) throw new NotFoundException('溯源批次不存在');

    return this.mapBatch(batch);
  }

  /** 通过批次码查询 */
  async getBatchByCode(batchCode: string) {
    const batch = await this.prisma.traceBatch.findUnique({
      where: { batchCode },
      include: {
        events: { orderBy: { occurredAt: 'asc' } },
        ownershipClaim: true,
        company: { select: { id: true, name: true } },
      },
    });
    if (!batch) throw new NotFoundException('溯源批次不存在');

    return this.mapBatch(batch);
  }

  /** 映射批次数据（与前端 TraceBatch 类型对齐） */
  private mapBatch(batch: any, note?: string | null) {
    return {
      id: batch.id,
      batchCode: batch.batchCode,
      companyId: batch.company?.id || batch.companyId || null,
      companyName: batch.company?.name || null,
      note: note || null,
      meta: batch.meta,
      ownershipClaim: batch.ownershipClaim
        ? {
            id: batch.ownershipClaim.id,
            type: batch.ownershipClaim.type,
            data: batch.ownershipClaim.data,
          }
        : null,
      events: (batch.events || []).map((e: any) => ({
        id: e.id,
        type: e.type,
        data: e.data,
        occurredAt: e.occurredAt.toISOString(),
      })),
      createdAt: batch.createdAt.toISOString(),
    };
  }
}
