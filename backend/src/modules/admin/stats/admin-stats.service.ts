import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TtlCache } from '../../../common/ttl-cache';

@Injectable()
export class AdminStatsService {
  private dashboardCache = new TtlCache(30_000); // 30 秒

  constructor(private prisma: PrismaService) {}

  /** Dashboard 统计数据（30 秒内存缓存） */
  async getDashboard() {
    const cached = this.dashboardCache.get('dashboard');
    if (cached) return cached;

    const [
      userCount,
      orderCount,
      productCount,
      companyCount,
      todayOrderCount,
      todaySales,
      pendingWithdraws,
      recentOrders,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.order.count(),
      // 商品总数排除卖家草稿（运营 dashboard 只关心可上架商品）
      this.prisma.product.count({ where: { status: { not: 'DRAFT' } } }),
      this.prisma.company.count(),
      this.prisma.order.count({
        where: {
          createdAt: { gte: this.startOfDay() },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: this.startOfDay() },
          status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.withdrawRequest.count({
        where: { status: 'REQUESTED' },
      }),
      this.prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              profile: { select: { nickname: true } },
            },
          },
        },
      }),
    ]);

    const result = {
      totalUsers: userCount,
      totalOrders: orderCount,
      totalRevenue: todaySales._sum.totalAmount || 0,
      totalProducts: productCount,
      totalCompanies: companyCount,
      todayOrderCount,
      pendingWithdrawals: pendingWithdraws,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNo: o.id,
        status: o.status,
        totalAmount: o.totalAmount,
        userName: o.user?.profile?.nickname || '未知用户',
        createdAt: o.createdAt,
      })),
    };

    this.dashboardCache.set('dashboard', result);
    return result;
  }

  /** 仪表盘缓存失效 */
  invalidateDashboardCache() {
    this.dashboardCache.clear();
  }

  /** 销售趋势（最近7天，GROUP BY 替代循环：14 次查询→2 次） */
  async getSalesTrend() {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    // 2 次 $queryRaw 替代 7×2 循环查询
    const [orderCounts, orderAmounts] = await Promise.all([
      this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE("createdAt") as date, COUNT(*)::bigint as count
        FROM "Order"
        WHERE "createdAt" >= ${startDate}
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
      this.prisma.$queryRaw<{ date: string; amount: number }[]>`
        SELECT DATE("createdAt") as date, COALESCE(SUM("totalAmount"), 0) as amount
        FROM "Order"
        WHERE "createdAt" >= ${startDate}
          AND status IN ('PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED')
        GROUP BY DATE("createdAt")
        ORDER BY date ASC
      `,
    ]);

    // 构建查找表
    const countMap = new Map(orderCounts.map((r) => [String(r.date), Number(r.count)]));
    const amountMap = new Map(orderAmounts.map((r) => [String(r.date), Number(r.amount)]));

    // 填充 7 天数据（包括无数据的日期）
    const days: { date: string; count: number; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({
        date: dateStr,
        count: countMap.get(dateStr) ?? 0,
        amount: amountMap.get(dateStr) ?? 0,
      });
    }

    return days;
  }

  /** 奖励统计数据 */
  async getBonusStats() {
    const [
      totalDistributed,
      totalWithdrawn,
      vipCount,
      totalMembers,
      pendingWithdrawals,
    ] = await Promise.all([
      // 累计分配（AVAILABLE + WITHDRAWN 的总额）
      this.prisma.rewardLedger.aggregate({
        where: { status: { in: ['AVAILABLE', 'WITHDRAWN'] } },
        _sum: { amount: true },
      }),
      // 累计提现（状态为 APPROVED 或 PAID 的提现总额）
      this.prisma.withdrawRequest.aggregate({
        where: { status: { in: ['APPROVED', 'PAID'] } },
        _sum: { amount: true },
      }),
      // VIP 会员数
      this.prisma.memberProfile.count({ where: { tier: 'VIP' } }),
      // 总会员数
      this.prisma.memberProfile.count(),
      // 待审核提现数
      this.prisma.withdrawRequest.count({ where: { status: 'REQUESTED' } }),
    ]);

    // 最近 7 天奖励分配趋势（GROUP BY 替代循环：7 次查询→1 次）
    const trendStartDate = new Date();
    trendStartDate.setDate(trendStartDate.getDate() - 6);
    trendStartDate.setHours(0, 0, 0, 0);

    const trendRaw = await this.prisma.$queryRaw<{ date: string; amount: number }[]>`
      SELECT DATE("createdAt") as date, COALESCE(SUM(amount), 0) as amount
      FROM "RewardLedger"
      WHERE status IN ('AVAILABLE', 'WITHDRAWN')
        AND "createdAt" >= ${trendStartDate}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `;

    const trendMap = new Map(trendRaw.map((r) => [String(r.date), Number(r.amount)]));
    const dailyTrend: { date: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      dailyTrend.push({
        date: dateStr,
        amount: trendMap.get(dateStr) ?? 0,
      });
    }

    return {
      totalDistributed: totalDistributed._sum?.amount ?? 0,
      totalWithdrawn: totalWithdrawn._sum?.amount ?? 0,
      vipCount,
      pendingWithdrawals,
      dailyTrend,
      totalMembers,
      vipRate: totalMembers > 0 ? Number((vipCount / totalMembers * 100).toFixed(1)) : 0,
    };
  }

  private startOfDay(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
}
