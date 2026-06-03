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
      // 查找所有已过期或底层商品已不可用的奖品购物车项（分批处理，避免单次查询过大）
      const invalidByCart = await this.prisma.cartItem.findMany({
        where: {
          isPrize: true,
          OR: [
            { expiresAt: { not: null, lt: now } },
            { sku: { status: { not: 'ACTIVE' } } },
            { sku: { product: { status: { not: 'ACTIVE' } } } },
          ],
        },
        select: { id: true, prizeRecordId: true, cartId: true },
        take: 500,
      });

      const recordIdsFromCart = invalidByCart
        .map((e) => e.prizeRecordId)
        .filter((id): id is string => !!id);

      const prizeInactiveRecords = recordIdsFromCart.length > 0
        ? await this.prisma.lotteryRecord.findMany({
            where: {
              id: { in: recordIdsFromCart },
              prize: { isActive: false },
            },
            select: { id: true },
          })
        : [];
      const prizeInactiveRecordIds = new Set(prizeInactiveRecords.map((record) => record.id));

      const invalidByPrize = recordIdsFromCart.length > 0
        ? await this.prisma.cartItem.findMany({
            where: {
              isPrize: true,
              prizeRecordId: { in: Array.from(prizeInactiveRecordIds) },
            },
            select: { id: true, prizeRecordId: true, cartId: true },
            take: 500,
          })
        : [];

      const standaloneInvalidRecords = await this.prisma.lotteryRecord.findMany({
        where: {
          status: { in: ['WON', 'IN_CART'] },
          result: 'WON',
          prize: {
            is: {
              type: { not: 'NO_PRIZE' },
              OR: [
                { isActive: false },
                { sku: null },
                { product: null },
                { sku: { status: { not: 'ACTIVE' } } },
                { sku: { product: { status: { not: 'ACTIVE' } } } },
              ],
            },
          },
        },
        select: { id: true },
        take: 500,
      });

      const invalidItems = [...invalidByCart, ...invalidByPrize];
      if (invalidItems.length === 0 && standaloneInvalidRecords.length === 0) return;

      const ids = Array.from(new Set(invalidItems.map((e) => e.id)));
      const prizeRecordIds = Array.from(new Set([
        ...invalidItems
        .map((e) => e.prizeRecordId)
          .filter((id): id is string => !!id),
        ...standaloneInvalidRecords.map((record) => record.id),
      ]));

      // 事务内删除过期/不可用项 + 更新 LotteryRecord 状态
      await this.prisma.$transaction(async (tx) => {
        if (ids.length > 0) {
          await tx.cartItem.deleteMany({ where: { id: { in: ids } } });
        }

        if (prizeRecordIds.length > 0) {
          await tx.lotteryRecord.updateMany({
            where: { id: { in: prizeRecordIds }, status: { in: ['WON', 'IN_CART'] } },
            data: { status: 'EXPIRED' },
          });
        }
      });

      this.logger.log(
        `定时清理过期/不可用奖品：删除 ${ids.length} 条，更新 ${prizeRecordIds.length} 条 LotteryRecord → EXPIRED`,
      );
    } catch (err) {
      this.logger.error(`定时清理过期奖品失败: ${(err as Error).message}`);
    }
  }
}
