import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * F3: 奖品购物车项过期清理定时任务
 * 每 15 分钟扫描全局过期奖品购物车项并清理
 */
@Injectable()
export class PrizeExpireService {
  private readonly logger = new Logger(PrizeExpireService.name);

  constructor(private prisma: PrismaService) {}

  /** 每 15 分钟扫描全局过期奖品购物车项并清理 */
  @Cron('0 */15 * * * *')
  async cleanExpiredPrizeItems(): Promise<void> {
    const now = new Date();

    try {
      // 查找所有已过期的奖品购物车项（分批处理，避免单次查询过大）
      const expired = await this.prisma.cartItem.findMany({
        where: {
          isPrize: true,
          expiresAt: { not: null, lt: now },
        },
        select: { id: true, prizeRecordId: true, cartId: true },
        take: 500,
      });

      if (expired.length === 0) return;

      const ids = expired.map((e) => e.id);
      const prizeRecordIds = expired
        .map((e) => e.prizeRecordId)
        .filter((id): id is string => !!id);

      // 事务内删除过期项 + 更新 LotteryRecord 状态
      await this.prisma.$transaction(async (tx) => {
        await tx.cartItem.deleteMany({ where: { id: { in: ids } } });

        if (prizeRecordIds.length > 0) {
          await tx.lotteryRecord.updateMany({
            where: { id: { in: prizeRecordIds }, status: 'IN_CART' },
            data: { status: 'EXPIRED' },
          });
        }
      });

      this.logger.log(
        `定时清理过期奖品购物车项：删除 ${expired.length} 条，更新 ${prizeRecordIds.length} 条 LotteryRecord → EXPIRED`,
      );
    } catch (err) {
      this.logger.error(`定时清理过期奖品失败: ${(err as Error).message}`);
    }
  }
}
