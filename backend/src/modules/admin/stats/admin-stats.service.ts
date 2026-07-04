import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TtlCache } from '../../../common/ttl-cache';

@Injectable()
export class AdminStatsService {
  private dashboardCache = new TtlCache(30_000); // 30 秒
  private operationsOverviewCache = new TtlCache(30_000); // 30 秒

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
          paidAt: { gte: this.startOfChinaDay() },
          status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          paidAt: { gte: this.startOfChinaDay() },
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
    this.operationsOverviewCache.clear();
  }

  /** 运营工作台总览（今日经营 / 待办中心 / 资金奖励 / 活动增长） */
  async getOperationsOverview() {
    const cached = this.operationsOverviewCache.get('operations-overview');
    if (cached) return cached;

    const now = new Date();
    const startOfDay = this.startOfChinaDay();
    const drawDate = this.todayChinaDate();
    const paidOrderWhere = {
      paidAt: { gte: startOfDay },
      deletedAt: null,
      status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] as any[] },
    };

    const [
      paidOrderCount,
      todayGmv,
      normalOrderCount,
      vipOrderCount,
      groupBuyOrderCount,
      paymentGroups,
      productReviews,
      companyReviews,
      withdrawalReviews,
      withdrawalProcessing,
      withdrawalFailed,
      afterSaleRequests,
      afterSaleSellerReviews,
      afterSaleArbitrations,
      afterSaleReturns,
      afterSaleManualReviews,
      afterSaleRefunding,
      invoiceRequests,
      customerServiceQueue,
      openTickets,
      rewardStatusGroups,
      rewardTodayCreated,
      digitalAssetOverview,
      digitalAssetTodayCredit,
      withdrawalProcessingAmount,
      withdrawalFailedAmount,
      totalCouponCampaigns,
      activeCouponCampaigns,
      couponIssuedCount,
      couponUsedCount,
      couponDiscount,
      todayDraws,
      todayWins,
      activeLotteryPrizes,
      activeGroupBuyActivities,
      activeGroupBuyInstances,
      completedGroupBuyInstances,
      groupBuyCandidates,
      groupBuyValidReferrals,
      pendingGroupBuyRebate,
    ] = await Promise.all([
      this.prisma.order.count({ where: paidOrderWhere }),
      this.prisma.order.aggregate({ where: paidOrderWhere, _sum: { totalAmount: true } }),
      this.prisma.order.count({ where: { ...paidOrderWhere, bizType: 'NORMAL_GOODS' as any } }),
      this.prisma.order.count({ where: { ...paidOrderWhere, bizType: 'VIP_PACKAGE' as any } }),
      this.prisma.order.count({ where: { ...paidOrderWhere, bizType: 'GROUP_BUY' as any } }),
      this.prisma.payment.groupBy({
        by: ['channel'],
        where: {
          paidAt: { gte: startOfDay },
          status: 'PAID' as any,
          deletedAt: null,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.product.count({
        where: { status: { not: 'DRAFT' as any }, auditStatus: 'PENDING' as any },
      }),
      this.prisma.company.count({ where: { status: 'PENDING' as any } }),
      this.prisma.withdrawRequest.count({ where: { status: 'REQUESTED' as any, deletedAt: null } }),
      this.prisma.withdrawRequest.count({ where: { status: 'PROCESSING' as any, deletedAt: null } }),
      this.prisma.withdrawRequest.count({ where: { status: 'FAILED' as any, deletedAt: null } }),
      this.prisma.afterSaleRequest.count({ where: { status: 'REQUESTED' as any } }),
      this.prisma.afterSaleRequest.count({ where: { status: 'UNDER_REVIEW' as any } }),
      this.prisma.afterSaleRequest.count({ where: { status: 'PENDING_ARBITRATION' as any } }),
      this.prisma.afterSaleRequest.count({
        where: { status: { in: ['RETURN_SHIPPING', 'RECEIVED_BY_SELLER', 'SELLER_REJECTED_RETURN'] as any[] } },
      }),
      this.prisma.afterSaleRequest.count({
        where: { manualReviewReason: { not: null }, manualReviewResolvedAt: null },
      }),
      this.prisma.afterSaleRequest.count({ where: { status: 'REFUNDING' as any } }),
      this.prisma.invoice.count({ where: { status: 'REQUESTED' as any } }),
      this.prisma.csSession.count({ where: { status: 'QUEUING' as any } }),
      this.prisma.csTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] as any[] } } }),
      this.prisma.rewardLedger.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.rewardLedger.aggregate({
        where: {
          createdAt: { gte: startOfDay },
          deletedAt: null,
          status: { in: ['AVAILABLE', 'FROZEN', 'RETURN_FROZEN', 'WITHDRAWN', 'RESERVED'] as any[] },
        },
        _sum: { amount: true },
      }),
      (this.prisma as any).digitalAssetAccount.aggregate({
        _count: { _all: true },
        _sum: {
          seedAssetBalance: true,
          creditAssetBalance: true,
          frozenCreditAssetBalance: true,
          cumulativeSpendAmount: true,
        },
      }),
      (this.prisma as any).digitalAssetLedger.aggregate({
        where: { createdAt: { gte: startOfDay }, direction: 'CREDIT' },
        _sum: { amount: true, assetAmount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { status: 'PROCESSING' as any, deletedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.withdrawRequest.aggregate({
        where: { status: 'FAILED' as any, deletedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.couponCampaign.count(),
      this.prisma.couponCampaign.count({
        where: {
          status: 'ACTIVE' as any,
          startAt: { lte: now },
          OR: [{ endAt: null }, { endAt: { gte: now } }],
        },
      }),
      this.prisma.couponInstance.count(),
      this.prisma.couponInstance.count({ where: { status: 'USED' as any } }),
      this.prisma.couponUsageRecord.aggregate({ _sum: { discountAmount: true } }),
      this.prisma.lotteryRecord.count({ where: { drawDate } }),
      this.prisma.lotteryRecord.count({ where: { drawDate, result: 'WON' as any } }),
      this.prisma.lotteryPrize.count({ where: { isActive: true } }),
      this.prisma.groupBuyActivity.count({
        where: {
          status: 'ACTIVE' as any,
          deletedAt: null,
          OR: [{ startAt: null }, { startAt: { lte: now } }],
          AND: [{ OR: [{ endAt: null }, { endAt: { gte: now } }] }],
        },
      }),
      this.prisma.groupBuyInstance.count({ where: { status: 'SHARING' as any } }),
      this.prisma.groupBuyInstance.count({ where: { status: 'COMPLETED' as any } }),
      this.prisma.groupBuyReferral.count({ where: { status: 'CANDIDATE' as any } }),
      this.prisma.groupBuyReferral.count({ where: { status: 'VALID' as any } }),
      this.prisma.groupBuyRebateLedger.aggregate({
        where: { type: 'PENDING_REBATE' as any, status: 'PENDING' as any, deletedAt: null },
        _sum: { amount: true },
      }),
    ]);

    const gmv = this.toMoney(todayGmv._sum.totalAmount);
    const rewardAmountByStatus = new Map(
      rewardStatusGroups.map((item: any) => [String(item.status), this.toMoney(item._sum?.amount)]),
    );
    const digitalSeed = this.toMoney(digitalAssetOverview?._sum?.seedAssetBalance);
    const digitalCredit = this.toMoney(digitalAssetOverview?._sum?.creditAssetBalance);
    const couponUsageRate = couponIssuedCount > 0
      ? this.round2((couponUsedCount / couponIssuedCount) * 100)
      : 0;

    const result = {
      today: {
        paidOrderCount,
        gmv,
        averageOrderAmount: paidOrderCount > 0 ? this.round2(gmv / paidOrderCount) : 0,
        normalOrderCount,
        vipOrderCount,
        groupBuyOrderCount,
        payments: paymentGroups.map((item: any) => ({
          channel: item.channel,
          amount: this.toMoney(item._sum?.amount),
          count: Number(item._count?._all ?? 0),
        })),
      },
      pending: {
        productReviews,
        companyReviews,
        withdrawalReviews,
        withdrawalProcessing,
        withdrawalFailed,
        afterSaleRequests,
        afterSaleSellerReviews,
        afterSaleArbitrations,
        afterSaleReturns,
        afterSaleManualReviews,
        afterSaleRefunding,
        invoiceRequests,
        customerServiceQueue,
        openTickets,
      },
      capital: {
        rewardAvailableAmount: rewardAmountByStatus.get('AVAILABLE') ?? 0,
        rewardFrozenAmount: rewardAmountByStatus.get('FROZEN') ?? 0,
        rewardReturnFrozenAmount: rewardAmountByStatus.get('RETURN_FROZEN') ?? 0,
        rewardReservedAmount: rewardAmountByStatus.get('RESERVED') ?? 0,
        rewardTodayCreatedAmount: this.toMoney(rewardTodayCreated._sum?.amount),
        digitalAssetAccountCount: Number(digitalAssetOverview?._count?._all ?? 0),
        digitalAssetTotalBalance: this.round2(digitalSeed + digitalCredit),
        digitalAssetFrozenCreditBalance: this.toMoney(digitalAssetOverview?._sum?.frozenCreditAssetBalance),
        digitalAssetCumulativeSpendAmount: this.toMoney(digitalAssetOverview?._sum?.cumulativeSpendAmount),
        digitalAssetTodayCreditAmount: this.toMoney(digitalAssetTodayCredit?._sum?.assetAmount),
        withdrawalProcessingAmount: this.toMoney(withdrawalProcessingAmount._sum?.amount),
        withdrawalFailedAmount: this.toMoney(withdrawalFailedAmount._sum?.amount),
      },
      activities: {
        totalCouponCampaigns,
        activeCouponCampaigns,
        couponIssuedCount,
        couponUsedCount,
        couponUsageRate,
        couponDiscountAmount: this.toMoney(couponDiscount._sum?.discountAmount),
        todayDraws,
        todayWins,
        activeLotteryPrizes,
        activeGroupBuyActivities,
        activeGroupBuyInstances,
        completedGroupBuyInstances,
        groupBuyCandidates,
        groupBuyValidReferrals,
        pendingGroupBuyRebateAmount: this.toMoney(pendingGroupBuyRebate._sum?.amount),
      },
    };

    this.operationsOverviewCache.set('operations-overview', result);
    return result;
  }

  /** 销售趋势（最近7天，GROUP BY 替代循环：14 次查询→2 次） */
  async getSalesTrend() {
    const startDate = this.startOfChinaDay(-6);

    // 2 次 $queryRaw 替代 7×2 循环查询
    const [orderCounts, orderAmounts] = await Promise.all([
      this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT DATE("paidAt" + INTERVAL '8 hours') as date, COUNT(*)::bigint as count
        FROM "Order"
        WHERE "paidAt" >= ${startDate}
          AND "paidAt" IS NOT NULL
          AND status IN ('PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED')
        GROUP BY DATE("paidAt" + INTERVAL '8 hours')
        ORDER BY date ASC
      `,
      this.prisma.$queryRaw<{ date: string; amount: number }[]>`
        SELECT DATE("paidAt" + INTERVAL '8 hours') as date, COALESCE(SUM("totalAmount"), 0) as amount
        FROM "Order"
        WHERE "paidAt" >= ${startDate}
          AND "paidAt" IS NOT NULL
          AND status IN ('PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED')
        GROUP BY DATE("paidAt" + INTERVAL '8 hours')
        ORDER BY date ASC
      `,
    ]);

    // 构建查找表
    const countMap = new Map(orderCounts.map((r) => [String(r.date), Number(r.count)]));
    const amountMap = new Map(orderAmounts.map((r) => [String(r.date), Number(r.amount)]));

    // 填充 7 天数据（包括无数据的日期）
    const days: { date: string; count: number; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dateStr = this.chinaDateString(-i);
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

  private startOfChinaDay(offsetDays = 0): Date {
    const now = new Date();
    const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    chinaTime.setUTCDate(chinaTime.getUTCDate() + offsetDays);
    return new Date(Date.UTC(
      chinaTime.getUTCFullYear(),
      chinaTime.getUTCMonth(),
      chinaTime.getUTCDate(),
    ) - 8 * 60 * 60 * 1000);
  }

  private chinaDateString(offsetDays = 0): string {
    const chinaTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
    chinaTime.setUTCDate(chinaTime.getUTCDate() + offsetDays);
    return chinaTime.toISOString().slice(0, 10);
  }

  private toMoney(value: unknown): number {
    return this.round2(Number(value ?? 0));
  }

  private round2(value: number): number {
    return Number((Number.isFinite(value) ? value : 0).toFixed(2));
  }

  private todayChinaDate(): string {
    return this.chinaDateString();
  }
}
