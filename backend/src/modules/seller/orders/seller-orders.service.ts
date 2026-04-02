import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BonusConfigService } from '../../bonus/engine/bonus-config.service';
import { SellerShipDto, BatchShipItemDto } from './seller-orders.dto';
import {
  maskTrackingNo,
  extractRegionText,
} from '../../../common/security/privacy-mask';
import { SellerShippingService } from '../shipping/seller-shipping.service';

@Injectable()
export class SellerOrdersService {
  constructor(
    private prisma: PrismaService,
    private bonusConfig: BonusConfigService,
    private shippingService: SellerShippingService,
  ) {}

  /**
   * 发货鉴权（订单级）
   * - 卖家只能操作包含本企业商品的订单
   */
  private assertCanShipOrder(companyId: string, items: Array<{ companyId: string | null }>) {
    const hasMyItems = items.some((item) => item.companyId === companyId);
    if (!hasMyItems) throw new ForbiddenException('无权操作该订单');
  }

  private getCompanyShipment<T extends { companyId?: string | null }>(
    shipments: T[] | undefined,
    companyId: string,
  ): T | null {
    return shipments?.find((shipment) => shipment.companyId === companyId) ?? null;
  }

  private sumItemsAmount(items: Array<{ unitPrice: number; quantity: number }>): number {
    return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  }

  /**
   * 批量查询买家匿名编号
   * 从 BuyerAlias 表按 userId + companyId 查询，返回 Map<userId, alias>
   */
  private async getBuyerAliasMap(
    userIds: string[],
    companyId: string,
  ): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const aliases = await this.prisma.buyerAlias.findMany({
      where: { userId: { in: userIds }, companyId },
      select: { userId: true, alias: true },
    });
    return new Map(aliases.map((a) => [a.userId, a.alias]));
  }

  /** 我的订单列表（通过 OrderItem.companyId 关联） */
  async findAll(
    companyId: string,
    page: number,
    pageSize: number,
    status?: string,
    bizType?: string,
    staffId?: string,
  ) {
    const where: any = {
      items: { some: { companyId } },
      AND: [],
    };
    const statuses = status
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (statuses?.length === 1) {
      where.status = statuses[0];
    } else if (statuses && statuses.length > 1) {
      where.status = { in: statuses };
    }
    if (bizType === 'VIP_PACKAGE') {
      where.bizType = 'VIP_PACKAGE';
    } else if (bizType === 'LOTTERY_PRIZE') {
      where.bizType = 'NORMAL_GOODS';
      where.AND.push({ items: { some: { companyId, isPrize: true } } });
    } else if (bizType === 'NORMAL_GOODS') {
      where.bizType = 'NORMAL_GOODS';
      where.AND.push({ NOT: { items: { some: { companyId, isPrize: true } } } });
    }

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          items: {
            where: { companyId },
            include: { sku: { include: { product: { select: { id: true, title: true, media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } } } } } },
          },
          shipments: {
            where: { companyId },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    // 批量查询买家匿名编号
    const userIds = [...new Set(items.map((o) => o.userId))];
    const aliasMap = await this.getBuyerAliasMap(userIds, companyId);

    return {
      items: items.map((order) => {
        const goodsAmount = this.sumItemsAmount(order.items);
        const shipment = this.getCompanyShipment(order.shipments as Array<{
          companyId?: string | null;
          id: string;
          status: string;
          trackingNo: string | null;
          waybillNo?: string | null;
          shippedAt: Date | null;
        }>, companyId);
        return {
          id: order.id,
          status: order.status,
          bizType: order.bizType,
          totalAmount: goodsAmount,
          goodsAmount,
          shippingFee: shipment ? order.shippingFee : 0,
          createdDate: order.createdAt.toISOString().slice(0, 10), // YYYY-MM-DD
          buyerAlias: aliasMap.get(order.userId) || '买家',
          regionText: extractRegionText(order.addressSnapshot),
          items: order.items.map((item) => ({
            id: item.id,
            title: item.sku?.product?.title || '',
            imageUrl: (item.sku?.product as any)?.media?.[0]?.url || null,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            isPrize: item.isPrize,
          })),
          shipment: shipment
            ? {
                id: shipment.id,
                status: shipment.status,
                trackingNo: maskTrackingNo(shipment.trackingNo),
                waybillNo: maskTrackingNo(shipment.waybillNo || null),
                waybillPrintUrl:
                  shipment.waybillNo && staffId
                    ? this.shippingService.getWaybillPrintUrl(
                        companyId,
                        order.id,
                        staffId,
                      )
                    : undefined,
                shippedAt: shipment.shippedAt,
              }
            : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 订单详情 */
  async findById(companyId: string, staffId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        // 只返回属于本公司的订单项
        items: {
          where: { companyId },
          include: { sku: { include: { product: { select: { id: true, title: true, companyId: true, media: { where: { type: 'IMAGE' }, orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } } } } } },
        },
        shipments: {
          where: { companyId },
          include: { trackingEvents: { orderBy: { occurredAt: 'desc' } } },
          take: 1,
        },
        // 发票状态（仅状态，不含抬头详情，保护买家隐私）
        invoice: {
          select: { id: true, status: true },
        },
      },
    });

    if (!order) throw new NotFoundException('订单不存在');

    // 验证该订单包含本公司商品
    if (order.items.length === 0) throw new ForbiddenException('无权访问该订单');

    // 查询买家匿名编号
    const aliasMap = await this.getBuyerAliasMap([order.userId], companyId);
    const shipment = this.getCompanyShipment(
      order.shipments as Array<{
        companyId?: string | null;
        id: string;
        status: string;
        carrierCode: string;
        carrierName: string;
        trackingNo: string | null;
        waybillNo: string | null;
        shippedAt: Date | null;
        trackingEvents?: Array<{ statusCode: string | null; message: string; occurredAt: Date }>;
      }>,
      companyId,
    );
    const goodsAmount = this.sumItemsAmount(order.items);

    return {
      id: order.id,
      status: order.status,
      bizType: order.bizType,
      totalAmount: goodsAmount,
      goodsAmount,
      shippingFee: shipment ? order.shippingFee : 0,
      createdDate: order.createdAt.toISOString().slice(0, 10),
      buyerAlias: aliasMap.get(order.userId) || '买家',
      regionText: extractRegionText(order.addressSnapshot),
      items: order.items.map((item) => ({
        id: item.id,
        title: item.sku?.product?.title || '',
        imageUrl: (item.sku?.product as any)?.media?.[0]?.url || null,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        isPrize: item.isPrize,
        prizeType: item.prizeType,
      })),
      shipment: shipment
        ? {
            id: shipment.id,
            status: shipment.status,
            carrierCode: shipment.carrierCode,
            carrierName: shipment.carrierName,
            trackingNo: maskTrackingNo(shipment.trackingNo || shipment.waybillNo),
            waybillNo: maskTrackingNo(shipment.waybillNo),
            waybillPrintUrl: shipment.waybillNo
              ? this.shippingService.getWaybillPrintUrl(companyId, orderId, staffId)
              : undefined,
            shippedAt: shipment.shippedAt,
            trackingEvents: shipment.trackingEvents?.map((e) => ({
              status: e.statusCode || 'UNKNOWN',
              description: e.message,
              occurredAt: e.occurredAt,
            })),
          }
        : null,
      // 发票状态（只读，不含买家抬头详情）
      invoiceStatus: order.invoice?.status || null,
    };
  }

  /** 发货 */
  async ship(companyId: string, orderId: string, dto: SellerShipDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        shipments: {
          where: { companyId },
          take: 1,
        },
      },
    });

    if (!order) throw new NotFoundException('订单不存在');
    this.assertCanShipOrder(companyId, order.items);

    const companyShipment = this.getCompanyShipment(
      order.shipments as Array<{ companyId?: string | null; id: string; status: string; waybillNo: string | null; carrierName: string }>,
      companyId,
    );

    if (order.status !== 'PAID' && order.status !== 'SHIPPED') {
      throw new BadRequestException('只有已付款或部分已发货的订单可以发货');
    }

    if (!companyShipment?.waybillNo) {
      throw new BadRequestException('请先生成电子面单后再确认发货');
    }
    if (companyShipment.status !== 'INIT') {
      throw new BadRequestException('该订单已发货');
    }
    const { autoConfirmDays } = await this.bonusConfig.getSystemConfig();

    // 发货涉及订单状态变更，使用 Serializable 隔离级别防止并发重复发货
    return this.prisma.$transaction(async (tx) => {
      // 事务内重新检查订单状态，防止并发竞态
      const freshOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { select: { companyId: true } },
          shipments: {
            where: { companyId },
            take: 1,
          },
        },
      });
      if (!freshOrder || (freshOrder.status !== 'PAID' && freshOrder.status !== 'SHIPPED')) {
        throw new BadRequestException('只有已付款或部分已发货的订单可以发货');
      }
      this.assertCanShipOrder(companyId, freshOrder.items);
      const freshShipment = this.getCompanyShipment(
        freshOrder.shipments as Array<{ companyId?: string | null; id: string; status: string; waybillNo: string | null; carrierName: string }>,
        companyId,
      );
      if (!freshShipment?.waybillNo) {
        throw new BadRequestException('请先生成电子面单后再确认发货');
      }
      if (freshShipment.status !== 'INIT') {
        throw new BadRequestException('该订单已发货');
      }

      const maskedWaybillNo = maskTrackingNo(freshShipment.waybillNo);

      await tx.shipment.update({
        where: { id: freshShipment.id },
        data: {
          trackingNo: freshShipment.waybillNo,
          status: 'IN_TRANSIT',
          shippedAt: new Date(),
        },
      });

      // 更新订单状态
      const autoReceiveAt = new Date();
      autoReceiveAt.setDate(autoReceiveAt.getDate() + autoConfirmDays);
      if (freshOrder.status === 'PAID') {
        await tx.order.update({
          where: { id: orderId },
          data: { status: 'SHIPPED', autoReceiveAt },
        });
      } else if (!freshOrder.autoReceiveAt) {
        await tx.order.update({
          where: { id: orderId },
          data: { autoReceiveAt },
        });
      }

      // 记录状态变更（不含运单号明文，使用脱敏值）
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: freshOrder.status,
          toStatus: 'SHIPPED',
          reason: `卖家确认发货：${freshShipment.carrierName} ${maskedWaybillNo}`,
        },
      });

      return { ok: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /** 批量发货 */
  async batchShip(companyId: string, items: BatchShipItemDto[]) {
    const results: { orderId: string; success: boolean; error?: string }[] = [];

    for (const item of items) {
      try {
        await this.ship(companyId, item.orderId, {});
        results.push({ orderId: item.orderId, success: true });
      } catch (err: any) {
        results.push({ orderId: item.orderId, success: false, error: err.message });
      }
    }

    return { results };
  }
}
