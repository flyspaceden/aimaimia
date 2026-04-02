import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  maskTrackingNo,
  extractRegionText,
} from '../../../common/security/privacy-mask';

@Injectable()
export class SellerShipmentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 批量查询买家匿名编号
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

  /** 物流列表（本公司订单关联的物流） */
  async findAll(
    companyId: string,
    page: number,
    pageSize: number,
  ) {
    const where = { companyId };

    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              status: true,
              userId: true,
              addressSnapshot: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.shipment.count({ where }),
    ]);

    // 批量查询买家匿名编号
    const userIds = [...new Set(items.map((s) => s.order.userId))];
    const aliasMap = await this.getBuyerAliasMap(userIds, companyId);

    return {
      items: items.map((shipment) => ({
        id: shipment.id,
        status: shipment.status,
        carrierCode: shipment.carrierCode,
        carrierName: shipment.carrierName,
        trackingNo: maskTrackingNo(shipment.trackingNo),
        shippedAt: shipment.shippedAt,
        createdAt: shipment.createdAt,
        order: {
          id: shipment.order.id,
          status: shipment.order.status,
          buyerAlias: aliasMap.get(shipment.order.userId) || '买家',
          regionText: extractRegionText(shipment.order.addressSnapshot),
        },
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 物流详情（含轨迹） */
  async findById(companyId: string, shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: {
          include: {
            items: true,
          },
        },
        trackingEvents: {
          orderBy: { occurredAt: 'desc' },
        },
      },
    });

    if (!shipment) throw new NotFoundException('物流记录不存在');

    if (shipment.companyId !== companyId) {
      throw new ForbiddenException('无权查看该物流信息');
    }

    // 查询买家匿名编号
    const aliasMap = await this.getBuyerAliasMap([shipment.order.userId], companyId);

    return {
      id: shipment.id,
      status: shipment.status,
      carrierCode: shipment.carrierCode,
      carrierName: shipment.carrierName,
      trackingNo: maskTrackingNo(shipment.trackingNo),
      shippedAt: shipment.shippedAt,
      createdAt: shipment.createdAt,
      order: {
        id: shipment.order.id,
        status: shipment.order.status,
        buyerAlias: aliasMap.get(shipment.order.userId) || '买家',
        regionText: extractRegionText(shipment.order.addressSnapshot),
        items: shipment.order.items
          .filter((item) => item.companyId === companyId)
          .map((item) => ({
            id: item.id,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
          })),
      },
      trackingEvents: shipment.trackingEvents?.map((e) => ({
        status: e.statusCode || 'UNKNOWN',
        description: e.message,
        occurredAt: e.occurredAt,
      })),
    };
  }
}
