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
        OR: [
          { activationStatus: 'FAILED' },
          {
            activationStatus: { in: ['ACTIVATING', 'RETRYING'] },
            createdAt: { lt: staleCutoff },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    if (failedPurchases.length === 0) {
      this.logger.log('无激活失败的 VipPurchase 记录');
      return;
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

    this.logger.log(
      `VIP 激活重试完成：成功 ${successCount}，失败 ${failCount}`,
    );
  }
}
