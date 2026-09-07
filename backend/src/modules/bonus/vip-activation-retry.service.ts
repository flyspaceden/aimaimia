import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusService } from './bonus.service';

/** 每批处理的最大数量 */
const BATCH_SIZE = 10;
const STALE_ACTIVATION_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * VIP 激活失败自动重试服务
 *
 * 定时扫描激活失败记录，以及卡死在 ACTIVATING/RETRYING 的陈旧记录，
 * 调用 BonusService.activateVipAfterPayment() 重新执行激活流程。
 *
 * activateVipAfterPayment 内部已包含 FAILED→RETRYING 的 CAS 状态转换和
 * Serializable 事务保护，本服务只负责发起重试调用。
 */
@Injectable()
export class VipActivationRetryService {
  // One bounded page per tick; restart begins at the oldest candidate again.
  // Invalid snapshot rows advance the cursor too, so they cannot starve later orders.
  private missingCursor: { createdAt: Date; id: string } | null = null;
  private readonly logger = new Logger(VipActivationRetryService.name);

  constructor(
    private prisma: PrismaService,
    private bonusService: BonusService,
  ) {}

  /**
   * 每 5 分钟扫描激活失败 / 卡死的 VipPurchase，逐条重试
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedActivations(): Promise<void> {
    this.logger.log('开始扫描 VIP 激活失败记录...');
    const staleCutoff = new Date(Date.now() - STALE_ACTIVATION_TIMEOUT_MS);

    const failedPurchases = await this.prisma.vipPurchase.findMany({
      where: {
        user: { is: { status: 'ACTIVE', deletionExecutedAt: null } },
        order: { is: {
          bizType: 'VIP_PACKAGE', status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] },
          refunds: { none: {} },
          checkoutSession: { is: { bizType: 'VIP_PACKAGE', status: { in: ['PAID', 'COMPLETED'] }, paidAt: { not: null } } },
        } },
        OR: [
          { activationStatus: 'FAILED' },
          {
            activationStatus: { in: ['PENDING', 'ACTIVATING', 'RETRYING'] },
            createdAt: { lt: staleCutoff },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    if (failedPurchases.length === 0) {
      this.logger.log('无激活失败的 VipPurchase 记录');
    }

    this.logger.log(`发现 ${failedPurchases.length} 条激活失败记录，开始重试`);

    let successCount = 0;
    let failCount = 0;

    for (const purchase of failedPurchases) {
      try {
        if (purchase.activationStatus === 'ACTIVATING' || purchase.activationStatus === 'RETRYING') {
          const recovered = await this.prisma.vipPurchase.updateMany({
            where: {
              id: purchase.id,
              activationStatus: purchase.activationStatus,
            },
            data: {
              activationStatus: 'FAILED',
              activationError: 'Recovered stale activation lease',
            },
          });

          if (recovered.count === 0) {
            this.logger.warn(
              `VIP 激活卡死记录已被其他流程接管，跳过恢复：userId=${purchase.userId}, orderId=${purchase.orderId}, status=${purchase.activationStatus}`,
            );
            continue;
          }
        }

        await this.bonusService.activateVipAfterPayment(
          purchase.userId,
          purchase.orderId!,
          purchase.giftOptionId!,
          purchase.amount,
          (purchase.giftSnapshot as Record<string, any>) ?? {},
          purchase.packageId ?? undefined,
          purchase.referralBonusRate ?? undefined,
        );
        successCount++;
        this.logger.log(
          `VIP 激活重试成功：userId=${purchase.userId}, orderId=${purchase.orderId}`,
        );
      } catch (err) {
        failCount++;
        this.logger.error(
          `VIP 激活重试失败：userId=${purchase.userId}, orderId=${purchase.orderId}, error=${(err as Error).message}`,
        );
        // 单条失败不影响其他记录
      }
    }

    await this.recoverMissingPurchases(staleCutoff);

    this.logger.log(
      `VIP 激活重试完成：成功 ${successCount}，失败 ${failCount}`,
    );
  }

  /** Recover a committed payment whose first activation prepare never persisted. */
  private async recoverMissingPurchases(staleCutoff: Date): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        bizType: 'VIP_PACKAGE', status: { in: ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'] },
        createdAt: { lt: staleCutoff }, vipPurchase: { is: null },
        ...(this.missingCursor ? { OR: [
          { createdAt: { gt: this.missingCursor.createdAt } },
          { createdAt: this.missingCursor.createdAt, id: { gt: this.missingCursor.id } },
        ] } : {}),
        user: { status: 'ACTIVE', deletionExecutedAt: null, vipPurchase: { is: null } }, refunds: { none: {} },
        checkoutSession: { is: { status: { in: ['PAID', 'COMPLETED'] }, paidAt: { not: null } } },
      },
      include: { checkoutSession: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
    });
    const last = orders[orders.length - 1];
    this.missingCursor = orders.length === BATCH_SIZE && last
      ? { createdAt: last.createdAt, id: last.id } : null;
    for (const order of orders) {
      const session = order.checkoutSession;
      const meta = session?.bizMeta as Record<string, any> | null;
      if (!session || session.bizType !== 'VIP_PACKAGE' || !meta?.vipGiftOptionId
        || !Number.isFinite(Number(meta.snapshotPrice)) || Number(meta.snapshotPrice) <= 0
        || !Array.isArray(session.itemsSnapshot)) continue;
      try {
        await this.bonusService.activateVipAfterPayment(
          order.userId, order.id, meta.vipGiftOptionId, Number(meta.snapshotPrice),
          {
            title: meta.giftTitle, coverMode: meta.giftCoverMode,
            coverUrl: meta.giftCoverUrl, badge: meta.giftBadge,
            items: (session.itemsSnapshot as any[]).map((item) => ({
              skuId: item.skuId, skuTitle: item.skuTitle, productTitle: item.title,
              productImage: item.image, price: item.unitPrice, quantity: item.quantity,
            })),
          },
          meta.vipPackageId, meta.referralBonusRate,
        );
      } catch (error) {
        this.logger.error(`VIP 缺失购买记录恢复失败: orderId=${order.id}, error=${(error as Error).message}`);
      }
    }
  }
}
