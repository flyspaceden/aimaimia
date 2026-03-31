import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusAllocationService } from '../bonus/engine/bonus-allocation.service';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import { ACTIVE_STATUSES } from '../after-sale/after-sale.constants';

/**
 * 自动确认收货定时任务
 * 每小时扫描 DELIVERED/SHIPPED 状态且 autoReceiveAt <= now 的订单，自动确认收货
 */
@Injectable()
export class OrderAutoConfirmService {
  private readonly logger = new Logger(OrderAutoConfirmService.name);

  constructor(
    private prisma: PrismaService,
    private bonusAllocation: BonusAllocationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleAutoConfirm() {
    const now = new Date();
    this.logger.log('开始扫描待自动确认收货的订单...');

    // 查找已过自动确认时间的订单
    // L6修复：限制单批次处理数量，防止内存溢出
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['SHIPPED', 'DELIVERED'] },
        autoReceiveAt: { lte: now },
        // 售后进行中订单不做自动确认，避免与售后流程冲突
        afterSaleRequests: {
          none: { status: { in: [...ACTIVE_STATUSES] } },
        },
      },
      select: { id: true, status: true },
      take: 200,
    });

    if (orders.length === 0) {
      this.logger.log('无待自动确认的订单');
      return;
    }

    this.logger.log(`找到 ${orders.length} 笔待自动确认订单`);

    let successCount = 0;
    for (const order of orders) {
      try {
        await this.confirmOrder(order.id, order.status);
        successCount++;
      } catch (err) {
        const safeErr = sanitizeErrorForLog(err);
        this.logger.error(`订单 ${order.id} 自动确认失败: ${safeErr.message}`, safeErr.stack);
      }
    }

    this.logger.log(`自动确认完成：${successCount}/${orders.length} 笔成功`);
  }

  /** 单笔订单自动确认收货 */
  private async confirmOrder(orderId: string, fromStatus: string) {
    const confirmed = await this.prisma.$transaction(async (tx) => {
      // 事务内再次校验状态，防止与买家手动确认并发冲突
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          afterSaleRequests: {
            where: { status: { in: [...ACTIVE_STATUSES] } },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!current || (current.status !== 'SHIPPED' && current.status !== 'DELIVERED')) {
        return false; // 已被买家手动确认或状态已变更，跳过
      }
      if (current.afterSaleRequests.length > 0) {
        return false; // 事务内二次确认：若窗口期进入售后流程，则不自动确认
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'RECEIVED', receivedAt: new Date() },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: current.status,
          toStatus: 'RECEIVED',
          reason: '系统自动确认收货',
        },
      });

      return true;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    if (!confirmed) {
      this.logger.log(`订单 ${orderId} 状态已变更，跳过自动确认`);
      return;
    }

    // C06: 分润前重新查询订单状态，防止与退款并发竞态
    // （事务提交后、分润执行前，订单可能已被退款）
    const freshOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (freshOrder?.status !== 'RECEIVED') {
      this.logger.warn(`订单 ${orderId} 状态已变更为 ${freshOrder?.status}，跳过分润`);
      return;
    }

    // 异步触发分润分配
    this.bonusAllocation.allocateForOrder(orderId).catch((err) => {
      const safeErr = sanitizeErrorForLog(err);
      this.logger.error(`订单 ${orderId} 分润分配失败: ${safeErr.message}`, safeErr.stack);
    });
    this.logger.log(`订单 ${orderId} 已自动确认收货`);
  }
}
