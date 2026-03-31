import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  extractRegionText,
  filterContactInfo,
} from '../../../common/security/privacy-mask';

/**
 * 卖家退款管理服务
 *
 * 注意：买家端售后已迁移为统一售后流程（AfterSaleRequest），此服务仅管理历史遗留的
 * Refund 记录及管理员/系统发起的退款。新的买家售后请求不再经过此服务。
 */
@Injectable()
export class SellerRefundsService {
  constructor(private prisma: PrismaService) {}

  private companyOrderWhere(companyId: string): Prisma.OrderWhereInput {
    return {
      items: { some: { companyId } },
    };
  }

  private sumItemsAmount(items: Array<{ unitPrice: number; quantity: number }>): number {
    return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  }

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

  /** 退款申请列表（只查本公司商品相关订单的退款） */
  async findAll(
    companyId: string,
    page: number,
    pageSize: number,
    status?: string,
  ) {
    const where: Prisma.RefundWhereInput = {
      order: this.companyOrderWhere(companyId),
    };
    if (status) {
      where.status = status as Prisma.RefundWhereInput['status'];
    }

    const [items, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        include: {
          order: {
            include: {
              items: { where: { companyId } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.refund.count({ where }),
    ]);

    // 批量查询买家匿名编号
    const userIds = [...new Set(items.map((r) => r.order.userId))];
    const aliasMap = await this.getBuyerAliasMap(userIds, companyId);

    return {
      items: items.map((refund) => {
        const goodsAmount = this.sumItemsAmount(refund.order.items);
        return {
          id: refund.id,
          status: refund.status,
          amount: refund.amount,
          reason: filterContactInfo(refund.reason),
          createdAt: refund.createdAt,
          order: {
            id: refund.order.id,
            status: refund.order.status,
            totalAmount: goodsAmount,
            goodsAmount,
            shippingFee: refund.order.shippingFee,
            createdDate: refund.order.createdAt.toISOString().slice(0, 10),
            buyerAlias: aliasMap.get(refund.order.userId) || '买家',
            regionText: extractRegionText(refund.order.addressSnapshot),
            items: refund.order.items.map((item) => ({
              id: item.id,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
            })),
          },
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 退款详情 */
  async findById(companyId: string, refundId: string) {
    const refund = await this.prisma.refund.findFirst({
      where: {
        id: refundId,
        order: this.companyOrderWhere(companyId),
      },
      include: {
        order: {
          include: {
            items: {
              where: { companyId },
              include: { sku: { include: { product: { select: { id: true, title: true } } } } },
            },
          },
        },
      },
    });

    if (!refund) throw new NotFoundException('退款记录不存在');

    // 查询买家匿名编号
    const aliasMap = await this.getBuyerAliasMap([refund.order.userId], companyId);

    const goodsAmount = this.sumItemsAmount(refund.order.items);

    return {
      id: refund.id,
      status: refund.status,
      amount: refund.amount,
      reason: filterContactInfo(refund.reason),
      merchantRefundNo: refund.merchantRefundNo,
      createdAt: refund.createdAt,
      order: {
        id: refund.order.id,
        status: refund.order.status,
        totalAmount: goodsAmount,
        goodsAmount,
        shippingFee: refund.order.shippingFee,
        createdDate: refund.order.createdAt.toISOString().slice(0, 10),
        buyerAlias: aliasMap.get(refund.order.userId) || '买家',
        regionText: extractRegionText(refund.order.addressSnapshot),
        items: refund.order.items.map((item) => ({
          id: item.id,
          title: item.sku?.product?.title || '',
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        })),
      },
    };
  }
}
