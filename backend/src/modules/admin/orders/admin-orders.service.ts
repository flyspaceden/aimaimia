import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { AdminShipDto, AdminOrderQueryDto } from './dto/admin-order.dto';
import {
  maskAddressSnapshot,
  maskPhone,
  maskTrackingNo,
} from '../../../common/security/privacy-mask';
import { decryptJsonValue } from '../../../common/security/encryption';

@Injectable()
export class AdminOrdersService {
  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
  ) {}

  /** 订单列表 */
  async findAll(query: AdminOrderQueryDto, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) {
      // 同时搜索订单号和用户手机号
      where.OR = [
        { id: query.keyword },
        {
          user: {
            authIdentities: {
              some: {
                provider: 'PHONE',
                identifier: { contains: query.keyword },
              },
            },
          },
        },
      ];
    }
    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }
    // 按公司筛选（通过订单项的冗余 companyId）
    if (query.companyId) {
      where.items = { some: { companyId: query.companyId } };
    }
    // 按支付渠道筛选
    if (query.paymentChannel) {
      where.checkoutSession = { paymentChannel: query.paymentChannel };
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
              authIdentities: {
                where: { provider: 'PHONE' },
                select: { identifier: true },
                take: 1,
              },
            },
          },
          checkoutSession: {
            select: { paymentChannel: true },
          },
          items: {
            include: {
              sku: {
                select: {
                  title: true,
                  product: {
                    select: {
                      title: true,
                      company: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: items.map((o) => {
        // 从第一个订单项提取公司信息
        const firstItem = o.items[0];
        const company = firstItem?.sku?.product?.company || null;
        // 商品概要：第一个商品名 + 总件数
        const totalQty = o.items.reduce((sum, item) => sum + item.quantity, 0);
        const firstProductTitle =
          (firstItem?.productSnapshot as any)?.title ||
          firstItem?.sku?.product?.title ||
          '未知商品';
        const itemsSummary =
          o.items.length > 1
            ? `${firstProductTitle} 等${o.items.length}种`
            : firstProductTitle;

        return {
          ...o,
          orderNo: o.id,
          paymentMethod: o.checkoutSession?.paymentChannel || null,
          paymentAmount: o.totalAmount - (o.discountAmount ?? 0),
          company,
          itemsSummary,
          itemCount: totalQty,
          user: {
            ...o.user,
            authIdentities: (o.user?.authIdentities || []).map((identity) => ({
              ...identity,
              identifierMasked: maskPhone(identity.identifier || null),
            })),
            phone: maskPhone(o.user?.authIdentities?.[0]?.identifier || null),
          },
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 订单状态统计 */
  async getStats() {
    const counts = await this.prisma.order.groupBy({
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

  /** 订单详情 */
  async findById(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            profile: { select: { nickname: true, avatarUrl: true } },
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
        items: {
          include: {
            sku: {
              include: {
                product: {
                  include: {
                    media: {
                      where: { type: 'IMAGE' },
                      orderBy: { sortOrder: 'asc' },
                      take: 1,
                      select: { url: true },
                    },
                  },
                },
              },
            },
          },
        },
        statusHistory: { orderBy: { createdAt: 'desc' } },
        payments: true,
        refunds: true,
        shipments: { include: { trackingEvents: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('订单不存在');
    const userPhone = order.user?.authIdentities?.[0]?.identifier || null;
    const addressSnapshot = decryptJsonValue(order.addressSnapshot);
    const shipments = (order.shipments || []).map((shipment) => ({
      ...shipment,
      trackingNoMasked: maskTrackingNo(shipment.trackingNo),
    }));

    // 映射字段以匹配前端 Order 类型
    return {
      ...order,
      orderNo: order.id,
      paymentAmount: order.totalAmount - (order.discountAmount ?? 0),
      address: addressSnapshot,
      addressSnapshot,
      addressMasked: maskAddressSnapshot(addressSnapshot),
      user: {
        ...order.user,
        authIdentities: (order.user?.authIdentities || []).map((identity) => ({
          ...identity,
          identifierMasked: maskPhone(identity.identifier || null),
        })),
        phone: userPhone,
        phoneMasked: maskPhone(userPhone),
        nickname: order.user?.profile?.nickname || null,
      },
      shipments,
      shipment: shipments[0] ?? null,
      items: order.items.map((item) => {
        const snapshot = item.productSnapshot as any;
        // 商品图片优先从快照取，回退到 SKU 图片或商品主图
        const productImage =
          snapshot?.image ||
          (item.sku?.product?.media as any)?.[0]?.url ||
          null;
        return {
          ...item,
          productTitle: snapshot?.title || item.sku?.product?.title || '未知商品',
          productImage,
          skuName: item.sku?.title || null,
          productId: item.sku?.product?.id || null,
        };
      }),
    };
  }

  /**
   * 发货
   * C3修复：Serializable 隔离级别 + CAS 防并发，状态检查移到事务内
   */
  async ship(orderId: string, dto: AdminShipDto) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // 在事务内读取订单，确保 Serializable 一致性
          const order = await tx.order.findUnique({
            where: { id: orderId },
            include: {
              items: {
                select: { companyId: true },
              },
            },
          });
          if (!order) throw new NotFoundException('订单不存在');
          if (order.status !== 'PAID') throw new BadRequestException('仅已支付订单可发货');
          const companyIds = [...new Set(order.items.map((item) => item.companyId).filter(Boolean))];
          if (companyIds.length !== 1) {
            throw new BadRequestException('混合订单需由各卖家公司分别发货，管理员不可整单手动发货');
          }

          const { autoConfirmDays } = await this.bonusConfig.getSystemConfig();

          await tx.shipment.create({
            data: {
              orderId,
              companyId: companyIds[0]!,
              carrierCode: dto.carrierCode,
              carrierName: dto.carrierName,
              trackingNo: dto.trackingNo,
              status: 'SHIPPED',
              shippedAt: new Date(),
            },
          });

          // 设置自动确认收货时间（读取系统配置 AUTO_CONFIRM_DAYS）
          const autoReceiveAt = new Date();
          autoReceiveAt.setDate(autoReceiveAt.getDate() + autoConfirmDays);

          // CAS：用 updateMany + where 条件隐式校验状态未被并发修改
          const result = await tx.order.updateMany({
            where: { id: orderId, status: 'PAID' },
            data: { status: 'SHIPPED', autoReceiveAt },
          });
          if (result.count === 0) {
            throw new ConflictException('订单状态已变更，请刷新后重试');
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: 'PAID',
              toStatus: 'SHIPPED',
              reason: `发货 ${dto.carrierName} ${dto.trackingNo}`,
            },
          });

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
   * 取消订单（含库存恢复）
   * C2修复：Serializable 隔离级别 + CAS 防并发
   */
  async cancel(orderId: string, reason: string) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // 在事务内读取订单，确保 Serializable 一致性
          const order = await tx.order.findUnique({
            where: { id: orderId },
            include: { items: true },
          });
          if (!order) throw new NotFoundException('订单不存在');
          if (order.status !== 'PENDING_PAYMENT') {
            throw new BadRequestException('仅待支付订单可取消');
          }

          // P0-2: 恢复库存 + 写 InventoryLedger
          for (const item of order.items) {
            await tx.productSKU.update({
              where: { id: item.skuId },
              data: { stock: { increment: item.quantity } },
            });
            await tx.inventoryLedger.create({
              data: {
                skuId: item.skuId,
                type: 'RELEASE',
                qty: item.quantity,
                refType: 'ORDER',
                refId: orderId,
              },
            });
          }

          // N12修复：恢复被使用的奖励（与买家端 cancelOrder 一致）
          await tx.rewardLedger.updateMany({
            where: { refType: 'ORDER', refId: orderId, status: 'VOIDED' },
            data: { status: 'AVAILABLE', refType: null, refId: null },
          });

          // CAS：用 updateMany + where 条件隐式校验状态未被并发修改
          const result = await tx.order.updateMany({
            where: { id: orderId, status: 'PENDING_PAYMENT' },
            data: { status: 'CANCELED' },
          });
          if (result.count === 0) {
            throw new ConflictException('订单状态已变更，请刷新后重试');
          }

          await tx.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: 'PENDING_PAYMENT',
              toStatus: 'CANCELED',
              reason,
            },
          });

          return { ok: true };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (e: any) {
        // P2034: Serializable 事务冲突，重试
        if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) continue;
        throw e;
      }
    }
  }
}
