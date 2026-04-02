import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';

/**
 * @deprecated F1: 新流程不再产生 PENDING_PAYMENT 订单，此服务仅处理旧流程历史数据
 * P1-4: 未付款订单自动过期
 * 每 5 分钟扫描 PENDING_PAYMENT 且超过 30 分钟的订单，自动取消并恢复库存
 */
@Injectable()
export class OrderExpireService {
  private readonly logger = new Logger(OrderExpireService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleExpire() {
    const expireTime = new Date(Date.now() - 30 * 60 * 1000); // 30 分钟前
    this.logger.log('开始扫描过期未支付订单...');

    // L6修复：限制单批次处理数量，防止内存溢出
    const orders = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        createdAt: { lte: expireTime },
      },
      include: { items: true },
      take: 200,
    });

    if (orders.length === 0) {
      this.logger.log('无过期订单');
      return;
    }

    this.logger.log(`找到 ${orders.length} 笔过期未支付订单`);

    let successCount = 0;
    for (const order of orders) {
      try {
        await this.expireOrder(order);
        successCount++;
      } catch (err) {
        const safeErr = sanitizeErrorForLog(err);
        this.logger.error(`订单 ${order.id} 自动取消失败: ${safeErr.message}`, safeErr.stack);
      }
    }

    this.logger.log(`自动取消完成：${successCount}/${orders.length} 笔成功`);
  }

  private async expireOrder(order: any) {
    // C05: 使用 Serializable 隔离级别，防止自动取消与支付并发竞态
    await this.prisma.$transaction(async (tx) => {
      // 事务内再次校验状态
      const current = await tx.order.findUnique({ where: { id: order.id } });
      if (!current || current.status !== 'PENDING_PAYMENT') return;

      // C05: 检查是否已有成功支付记录，防止取消已支付订单
      const paidPayment = await tx.payment.findFirst({
        where: { orderId: order.id, status: 'PAID' },
      });
      if (paidPayment) {
        this.logger.warn(`订单 ${order.id} 已支付，跳过自动取消`);
        return;
      }

      // 恢复库存
      for (const item of order.items) {
        await tx.productSKU.update({
          where: { id: item.skuId },
          data: { stock: { increment: item.quantity } },
        });
        await tx.inventoryLedger.create({
          data: {
            skuId: item.skuId,
            type: 'RELEASE',
            qty: item.quantity,
            refType: 'ORDER',
            refId: order.id,
          },
        });
      }

      // 恢复被使用的奖励：将关联本订单的 VOIDED 奖励恢复为 AVAILABLE
      await tx.rewardLedger.updateMany({
        where: { refType: 'ORDER', refId: order.id, status: 'VOIDED' },
        data: { status: 'AVAILABLE', refType: null, refId: null },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CANCELED' },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: 'PENDING_PAYMENT',
          toStatus: 'CANCELED',
          reason: '超时未支付，系统自动取消',
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    this.logger.log(`订单 ${order.id} 已自动取消（超时未支付）`);
  }
}
