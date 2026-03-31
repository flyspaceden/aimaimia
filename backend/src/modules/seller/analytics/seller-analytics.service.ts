import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TtlCache } from '../../../common/ttl-cache';

@Injectable()
export class SellerAnalyticsService {
  private overviewCache = new TtlCache(30_000); // 30 秒

  constructor(private prisma: PrismaService) {}

  /**
   * 统计口径与订单列表一致：只要订单包含本企业商品即可纳入。
   */
  private companyOrderWhere(companyId: string): Prisma.OrderWhereInput {
    return {
      items: { some: { companyId } },
    };
  }

  private companyAfterSaleWhere(
    companyId: string,
  ): Prisma.AfterSaleRequestWhereInput {
    return {
      OR: [
        { orderItem: { is: { companyId } } },
        {
          orderItemId: null,
          order: {
            items: {
              some: { companyId },
              none: { companyId: { not: companyId } },
            },
          },
        },
      ],
    };
  }

  private async sumRevenue(companyId: string, startDate?: Date): Promise<number> {
    const startDateSql = startDate
      ? Prisma.sql`AND o."createdAt" >= ${startDate}`
      : Prisma.empty;
    const result = await this.prisma.$queryRaw<{ revenue: number | null }[]>`
      SELECT COALESCE(SUM(oi."unitPrice" * oi.quantity), 0) as revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE oi."companyId" = ${companyId}
        AND o.status NOT IN ('CANCELED', 'REFUNDED')
        ${startDateSql}
    `;
    return result[0]?.revenue ?? 0;
  }

  /** 概览数据（30 秒内存缓存） */
  async getOverview(companyId: string) {
    const cacheKey = `overview:${companyId}`;
    const cached = this.overviewCache.get(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const companyOrderWhere = this.companyOrderWhere(companyId);
    const afterSaleWhere = this.companyAfterSaleWhere(companyId);

    const [
      todayOrders,
      todayRevenue,
      pendingShipCount,
      pendingAfterSaleCount,
      monthOrders,
      monthEffectiveOrders,
      monthRevenue,
      monthAfterSales,
      totalProducts,
      totalRevenue,
    ] = await Promise.all([
      // 今日订单数
      this.prisma.order.count({
        where: { ...companyOrderWhere, createdAt: { gte: todayStart } },
      }),
      // 今日销售额
      this.sumRevenue(companyId, todayStart),
      // 待发货
      this.prisma.order.count({
        where: { ...companyOrderWhere, status: 'PAID' },
      }),
      // 待处理售后
      this.prisma.afterSaleRequest.count({
        where: {
          ...afterSaleWhere,
          status: { in: ['REQUESTED', 'UNDER_REVIEW'] },
        },
      }),
      // 本月订单数
      this.prisma.order.count({
        where: { ...companyOrderWhere, createdAt: { gte: monthStart } },
      }),
      // 本月有效订单数（换货率分母：排除取消/退款）
      this.prisma.order.count({
        where: {
          ...companyOrderWhere,
          createdAt: { gte: monthStart },
          status: { notIn: ['CANCELED', 'REFUNDED'] },
        },
      }),
      // 本月销售额
      this.sumRevenue(companyId, monthStart),
      // 本月售后数（按售后申请创建时间统计）
      this.prisma.afterSaleRequest.count({
        where: {
          ...afterSaleWhere,
          createdAt: { gte: monthStart },
        },
      }),
      // 总商品数
      this.prisma.product.count({ where: { companyId } }),
      this.sumRevenue(companyId),
    ]);

    const result = {
      today: {
        orderCount: todayOrders,
        revenue: todayRevenue,
        pendingShipCount,
        pendingAfterSaleCount,
      },
      month: {
        orderCount: monthOrders,
        revenue: monthRevenue,
        afterSaleRate: monthEffectiveOrders > 0 ? monthAfterSales / monthEffectiveOrders : 0,
      },
      total: {
        productCount: totalProducts,
        totalRevenue,
      },
    };

    this.overviewCache.set(cacheKey, result);
    return result;
  }

  /** 卖家概览缓存失效 */
  invalidateOverviewCache(companyId?: string) {
    if (companyId) {
      this.overviewCache.invalidate(`overview:${companyId}`);
    } else {
      this.overviewCache.invalidatePrefix('overview:');
    }
  }

  /** 销售趋势（按天） */
  async getSalesTrend(companyId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 按订单项金额统计收入，避免 JOIN 后重复累加整单 totalAmount
    const result = await this.prisma.$queryRaw<
      { date: string; order_count: bigint; revenue: number }[]
    >`
      SELECT
        DATE(o."createdAt") as date,
        COUNT(DISTINCT o.id)::bigint as order_count,
        COALESCE(SUM(oi."unitPrice" * oi.quantity), 0) as revenue
      FROM "Order" o
      JOIN "OrderItem" oi
        ON oi."orderId" = o.id
       AND oi."companyId" = ${companyId}
      WHERE o."createdAt" >= ${startDate}
        AND o.status NOT IN ('CANCELED', 'REFUNDED')
      GROUP BY DATE(o."createdAt")
      ORDER BY date ASC
    `;

    return result.map((r) => ({
      date: r.date,
      orderCount: Number(r.order_count),
      revenue: r.revenue,
    }));
  }

  /** 商品排行 */
  async getProductRanking(companyId: string, limit: number = 10) {
    const result = await this.prisma.$queryRaw<
      { product_id: string; title: string; total_sold: bigint; total_revenue: number }[]
    >`
      SELECT
        p.id as product_id,
        p.title,
        COALESCE(SUM(
          CASE
            WHEN o.id IS NOT NULL
             AND o.status NOT IN ('CANCELED', 'REFUNDED')
            THEN oi.quantity
            ELSE 0
          END
        ), 0)::bigint as total_sold,
        COALESCE(SUM(
          CASE
            WHEN o.id IS NOT NULL
             AND o.status NOT IN ('CANCELED', 'REFUNDED')
            THEN oi."unitPrice" * oi.quantity
            ELSE 0
          END
        ), 0) as total_revenue
      FROM "Product" p
      LEFT JOIN "ProductSKU" ps ON ps."productId" = p.id
      LEFT JOIN "OrderItem" oi
        ON oi."skuId" = ps.id
       AND oi."companyId" = ${companyId}
      LEFT JOIN "Order" o ON o.id = oi."orderId"
      WHERE p."companyId" = ${companyId}
      GROUP BY p.id, p.title
      ORDER BY total_revenue DESC
      LIMIT ${limit}
    `;

    return result.map((r) => ({
      productId: r.product_id,
      title: r.title,
      totalSold: Number(r.total_sold),
      totalRevenue: r.total_revenue,
    }));
  }

  /** 订单状态分布 */
  async getOrderStats(companyId: string) {
    const result = await this.prisma.$queryRaw<
      { status: string; count: bigint }[]
    >`
      SELECT
        o.status,
        COUNT(DISTINCT o.id)::bigint as count
      FROM "Order" o
      WHERE EXISTS (
        SELECT 1
        FROM "OrderItem" oi
        WHERE oi."orderId" = o.id
          AND oi."companyId" = ${companyId}
      )
      GROUP BY o.status
    `;

    return result.map((r) => ({
      status: r.status,
      count: Number(r.count),
    }));
  }
}
