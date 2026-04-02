import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';

/**
 * F1: CheckoutSession 过期清理
 * 每分钟扫描 ACTIVE 状态且已过期的结算会话，释放预留奖励和红包，更新状态为 EXPIRED
 */
@Injectable()
export class CheckoutExpireService {
  private readonly logger = new Logger(CheckoutExpireService.name);
  private static readonly COUPON_RECONCILE_CUTOFF_MINUTES = 10;

  // CouponService 通过可选注入（避免循环依赖）
  private couponService: any = null;

  constructor(private prisma: PrismaService) {}

  /** 注入红包服务（由 OrderModule 在 onModuleInit 时调用） */
  setCouponService(service: any) {
    this.couponService = service;
  }

  @Cron('0 * * * * *')
  async handleExpire() {
    const now = new Date();

    // 查找已过期的 ACTIVE 会话（限制批次大小防止内存溢出）
    const expiredSessions = await this.prisma.checkoutSession.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: now },
      },
      select: {
        id: true,
        rewardId: true,
        couponInstanceIds: true,
        bizType: true,
        itemsSnapshot: true,
      },
      take: 200,
    });

    if (expiredSessions.length === 0) return;

    this.logger.log(`找到 ${expiredSessions.length} 个过期结算会话`);

    let successCount = 0;
    for (const session of expiredSessions) {
      try {
        await this.expireSession(session);
        successCount++;
      } catch (err) {
        const safeErr = sanitizeErrorForLog(err);
        this.logger.error(
          `结算会话 ${session.id} 过期处理失败: ${safeErr.message}`,
          safeErr.stack,
        );
      }
    }

    this.logger.log(`过期处理完成：${successCount}/${expiredSessions.length} 个成功`);
  }

  /**
   * 红包补偿任务：
   * - COMPLETED 会话：补做 RESERVED → USED 确认
   * - FAILED/EXPIRED 会话：补做 RESERVED → AVAILABLE 释放
   */
  @Cron('20 */2 * * * *')
  async reconcileReservedCoupons() {
    if (!this.couponService) return;

    const cutoff = new Date(
      Date.now() - CheckoutExpireService.COUPON_RECONCILE_CUTOFF_MINUTES * 60 * 1000,
    );
    const sessions = await this.prisma.checkoutSession.findMany({
      where: {
        status: { in: ['PAID', 'COMPLETED', 'FAILED', 'EXPIRED'] },
        createdAt: { lte: cutoff },
        couponInstanceIds: { isEmpty: false },
      },
      select: {
        id: true,
        status: true,
        couponInstanceIds: true,
        couponPerAmounts: true,
        totalCouponDiscount: true,
        orders: {
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
      take: 200,
    });

    if (sessions.length === 0) return;

    for (const session of sessions) {
      try {
        const reservedCoupons = await this.prisma.couponInstance.findMany({
          where: {
            id: { in: session.couponInstanceIds },
            status: 'RESERVED',
          },
          select: { id: true },
        });
        if (reservedCoupons.length === 0) continue;

        const reservedIds = reservedCoupons.map((item) => item.id);

        if (session.orders[0]?.id) {
          const storedPerAmounts = Array.isArray(session.couponPerAmounts)
            ? (session.couponPerAmounts as Array<{
                couponInstanceId: string;
                discountAmount: number;
              }>)
            : [];
          const amountMap = new Map(
            storedPerAmounts.map((item) => [
              item.couponInstanceId,
              Number(item.discountAmount || 0),
            ]),
          );
          const perCouponAmounts = reservedIds.map((couponInstanceId) => ({
            couponInstanceId,
            discountAmount: amountMap.get(couponInstanceId) ?? 0,
          }));

          const trackedTotal = Number(
            perCouponAmounts
              .reduce((sum, item) => sum + item.discountAmount, 0)
              .toFixed(2),
          );
          if (trackedTotal <= 0 && session.totalCouponDiscount > 0) {
            const base = Number(
              (session.totalCouponDiscount / reservedIds.length).toFixed(2),
            );
            let allocated = 0;
            for (let i = 0; i < perCouponAmounts.length; i++) {
              const amount =
                i === perCouponAmounts.length - 1
                  ? Number((session.totalCouponDiscount - allocated).toFixed(2))
                  : base;
              perCouponAmounts[i].discountAmount = amount;
              allocated = Number((allocated + amount).toFixed(2));
              }
            }

          const normalizedPerCouponAmounts = this.capCouponPerAmounts(
            perCouponAmounts,
            reservedIds,
            session.totalCouponDiscount ?? 0,
          );
          const trackedTotalAfterNormalize = Number(
            normalizedPerCouponAmounts
              .reduce((sum, item) => sum + item.discountAmount, 0)
              .toFixed(2),
          );
          if (trackedTotalAfterNormalize < trackedTotal - 0.01) {
            this.logger.warn(
              `补偿检测到逐张红包金额异常并已裁剪: sessionId=${session.id}, before=${trackedTotal}, after=${trackedTotalAfterNormalize}, couponTotal=${session.totalCouponDiscount ?? 0}`,
            );
          }

          await this.couponService.confirmCouponUsage(
            reservedIds,
            session.orders[0].id,
            normalizedPerCouponAmounts,
          );
          this.logger.warn(
            `补偿确认红包使用成功: sessionId=${session.id}, coupons=${reservedIds.length}`,
          );
        } else {
          if (session.status === 'PAID') {
            this.logger.warn(
              `发现 PAID 会话无订单，执行红包释放兜底: sessionId=${session.id}, coupons=${reservedIds.length}`,
            );
          }
          await this.couponService.releaseCoupons(reservedIds);
          this.logger.warn(
            `补偿释放红包成功: sessionId=${session.id}, coupons=${reservedIds.length}`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `红包补偿失败: sessionId=${session.id}, error=${err?.message}`,
        );
      }
    }
  }

  private async expireSession(session: {
    id: string;
    rewardId: string | null;
    couponInstanceIds: string[];
    bizType: string;
    itemsSnapshot: unknown;
  }) {
    await this.prisma.$transaction(
      async (tx) => {
        // CAS: 仅 ACTIVE → EXPIRED（防止与支付回调并发竞态）
        const result = await tx.checkoutSession.updateMany({
          where: { id: session.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED' },
        });

        if (result.count === 0) return; // 已被支付回调或其他操作处理

        if (session.bizType === 'VIP_PACKAGE') {
          const items = Array.isArray(session.itemsSnapshot)
            ? (session.itemsSnapshot as Array<Record<string, any>>)
            : [];
          for (const item of items) {
            const skuId = String(item.skuId || '');
            const quantity = Number(item.quantity || 0);
            if (!skuId || quantity <= 0) continue;
            const reservedCount = await tx.inventoryLedger.count({
              where: {
                skuId,
                type: 'RESERVE',
                qty: -quantity,
                refType: 'CHECKOUT_SESSION',
                refId: session.id,
              },
            });
            if (reservedCount === 0) continue;
            await tx.productSKU.update({
              where: { id: skuId },
              data: { stock: { increment: quantity } },
            });
            await tx.inventoryLedger.create({
              data: {
                skuId,
                type: 'RELEASE',
                qty: quantity,
                refType: 'CHECKOUT_SESSION',
                refId: session.id,
              },
            });
          }
        }

        // 释放预留奖励（RESERVED → AVAILABLE）
        if (session.rewardId) {
          await tx.rewardLedger.updateMany({
            where: { id: session.rewardId, status: 'RESERVED' },
            data: { status: 'AVAILABLE', refType: null, refId: null },
          });
          this.logger.log(`已释放预留奖励: ledgerId=${session.rewardId}`);
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // 事务成功后，释放已锁定的平台红包（在事务外执行，CouponService 有自己的事务）
    if (session.couponInstanceIds && session.couponInstanceIds.length > 0 && this.couponService) {
      try {
        await this.couponService.releaseCoupons(session.couponInstanceIds);
        this.logger.log(
          `已释放 ${session.couponInstanceIds.length} 张平台红包（会话过期）: sessionId=${session.id}`,
        );
      } catch (couponErr: any) {
        this.logger.error(
          `释放红包失败（会话过期）：sessionId=${session.id}, error=${couponErr.message}`,
        );
      }
    }

    this.logger.log(`结算会话 ${session.id} 已过期处理完成`);
  }

  /**
   * 防御性裁剪：确保逐张红包金额总和不超过会话记录的总红包抵扣。
   */
  private capCouponPerAmounts(
    perCouponAmounts: Array<{ couponInstanceId: string; discountAmount: number }>,
    couponInstanceIds: string[],
    totalDiscount: number,
  ): Array<{ couponInstanceId: string; discountAmount: number }> {
    if (!couponInstanceIds || couponInstanceIds.length === 0) return [];

    const toCents = (value: number) =>
      Math.max(0, Math.round((value + Number.EPSILON) * 100));
    const amountMap = new Map(
      perCouponAmounts.map((item) => [
        item.couponInstanceId,
        toCents(Number(item.discountAmount || 0)),
      ]),
    );

    const source = couponInstanceIds.map((couponInstanceId) => ({
      couponInstanceId,
      amountCents: amountMap.get(couponInstanceId) ?? 0,
    }));
    const sourceTotal = source.reduce((sum, item) => sum + item.amountCents, 0);
    let remaining = Math.min(toCents(totalDiscount), sourceTotal);

    return source.map((item) => {
      if (remaining <= 0) {
        return { couponInstanceId: item.couponInstanceId, discountAmount: 0 };
      }
      const amount = Math.min(item.amountCents, remaining);
      remaining -= amount;
      return {
        couponInstanceId: item.couponInstanceId,
        discountAmount: amount / 100,
      };
    });
  }
}
