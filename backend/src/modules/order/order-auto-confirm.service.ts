import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusAllocationService } from '../bonus/engine/bonus-allocation.service';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import { ACTIVE_STATUSES } from '../after-sale/after-sale.constants';
import { DigitalAssetService } from '../digital-asset/digital-asset.service';
import { GroupBuyLifecycleService } from '../group-buy/group-buy-lifecycle.service';
import { GrowthEventService } from '../growth/growth-event.service';

type AutoVipBySpendActivator = {
  activateVipByCumulativeSpend(userId: string, sourceOrderId: string): Promise<unknown>;
};

type PostReceiveAssetSettlement = {
  autoVipFailed?: boolean;
};

/**
 * 自动确认收货定时任务
 * 每小时扫描 DELIVERED/SHIPPED 状态且 autoReceiveAt <= now 的订单，自动确认收货
 */
@Injectable()
export class OrderAutoConfirmService {
  private readonly logger = new Logger(OrderAutoConfirmService.name);
  private digitalAssetService: DigitalAssetService | null = null;
  private bonusService: AutoVipBySpendActivator | null = null;
  private groupBuyLifecycleService: GroupBuyLifecycleService | null = null;
  private growthEventService: GrowthEventService | null = null;

  constructor(
    private prisma: PrismaService,
    private bonusAllocation: BonusAllocationService,
  ) {}

  setDigitalAssetService(service: DigitalAssetService) {
    this.digitalAssetService = service;
  }

  setBonusService(service: AutoVipBySpendActivator) {
    this.bonusService = service;
  }

  setGroupBuyLifecycleService(service: GroupBuyLifecycleService) {
    this.groupBuyLifecycleService = service;
  }

  setGrowthEventService(service: GrowthEventService) {
    this.growthEventService = service;
  }

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
    const confirmedOrder = await this.prisma.$transaction(async (tx) => {
      // 事务内再次校验状态，防止与买家手动确认并发冲突
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          userId: true,
          status: true,
          bizType: true,
          goodsAmount: true,
          totalAmount: true,
          items: { select: { isPrize: true } },
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

      const receivedCount = await tx.order.count({
        where: { userId: current.userId, status: 'RECEIVED' },
      });

      return { ...current, _isFirstReceived: receivedCount === 1 };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    if (!confirmedOrder) {
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
    this.evaluateGroupBuyAfterReceive(orderId);
    this.creditDigitalAssetAfterReceive(orderId, confirmedOrder.userId)
      .then((settlement) => {
        this.triggerGrowthAfterReceive(confirmedOrder, {
          skipNormalInviteFirstOrder: settlement.autoVipFailed === true,
        });
      })
      .catch(() => {
        this.triggerGrowthAfterReceive(confirmedOrder);
      });
    this.logger.log(`订单 ${orderId} 已自动确认收货`);
  }

  private async creditDigitalAssetAfterReceive(orderId: string, userId: string): Promise<PostReceiveAssetSettlement> {
    const recordOrderReceived = (this.digitalAssetService as any)?.recordOrderReceived
      ?? (this.digitalAssetService as any)?.creditOrderReceived;
    if (!recordOrderReceived) {
      return {};
    }
    try {
      const result = await Promise.resolve(recordOrderReceived.call(this.digitalAssetService, orderId, 'ORDER_RECEIVED'));
      if (result?.recorded !== true && result?.reason !== 'DUPLICATE_LEDGER') {
        return {};
      }
      try {
        await Promise.resolve(this.bonusService?.activateVipByCumulativeSpend(userId, orderId));
        return {};
      } catch (err) {
        const safeErr = sanitizeErrorForLog(err);
        this.logger.error(`订单 ${orderId} 自动VIP升级失败: ${safeErr.message}`, safeErr.stack);
        Promise.resolve(this.prisma.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: 'RECEIVED',
            toStatus: 'RECEIVED',
            reason: '自动VIP升级失败',
            meta: {
              deadLetter: true,
              event: 'AUTO_VIP_UPGRADE_DEAD_LETTER',
              error: safeErr.message,
              failedAt: new Date().toISOString(),
            },
          },
        })).catch(() => undefined);
        return { autoVipFailed: true };
      }
    } catch (err) {
      const safeErr = sanitizeErrorForLog(err);
      this.logger.error(`订单 ${orderId} 数字资产累计失败: ${safeErr.message}`, safeErr.stack);
      Promise.resolve(this.prisma.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'RECEIVED',
          toStatus: 'RECEIVED',
          reason: '数字资产累计失败',
          meta: {
            deadLetter: true,
            event: 'DIGITAL_ASSET_CREDIT_DEAD_LETTER',
            error: safeErr.message,
            failedAt: new Date().toISOString(),
          },
        },
      })).catch(() => undefined);
      return { autoVipFailed: true };
    }
  }

  private evaluateGroupBuyAfterReceive(orderId: string) {
    this.groupBuyLifecycleService?.evaluateOrderAfterReceive(orderId).catch((err: any) => {
      const safeErr = sanitizeErrorForLog(err);
      this.logger.error(`团购资格评估失败: orderId=${orderId}; error=${safeErr.message}`, safeErr.stack);
    });
  }

  private triggerGrowthAfterReceive(
    order: any,
    options: { skipNormalInviteFirstOrder?: boolean } = {},
  ) {
    if (!this.growthEventService || !this.isGrowthEligibleNormalOrder(order)) {
      return;
    }

    const behaviorCode = order._isFirstReceived
      ? 'FIRST_ORDER_RECEIVED'
      : 'REPURCHASE_RECEIVED';

    this.growthEventService.receive({
      userId: order.userId,
      behaviorCode,
      idempotencyKey: `${behaviorCode}:${order.userId}:${order.id}`,
      refType: 'ORDER',
      refId: order.id,
      meta: {
        orderId: order.id,
        goodsAmount: order.goodsAmount ?? 0,
        totalAmount: order.totalAmount ?? 0,
      },
    }).catch((err: any) => {
      this.logger.warn(`订单自动确认成长奖励触发失败: orderId=${order.id}, behavior=${behaviorCode}, error=${err?.message}`);
    });

    if (order._isFirstReceived && !options.skipNormalInviteFirstOrder) {
      this.triggerNormalInviteFirstOrderGrowth(order).catch((err: any) => {
        this.logger.warn(`普通分享自动确认首单奖励触发失败: orderId=${order.id}, userId=${order.userId}, error=${err?.message}`);
      });
    }
  }

  private async triggerNormalInviteFirstOrderGrowth(order: any) {
    if (!this.growthEventService) return;

    const binding = await this.prisma.normalShareBinding.findUnique({
      where: { inviteeUserId: order.userId },
    });
    if (!binding) return;
    if ((binding as any).relationStatus && (binding as any).relationStatus !== 'ACTIVE') return;
    if (['ISSUED', 'REVERSED', 'VOIDED'].includes(binding.rewardStatus)) return;
    if (binding.firstOrderId && binding.firstOrderId !== order.id) return;

    const result = await this.growthEventService.receive({
      userId: binding.inviterUserId,
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
      idempotencyKey: `NORMAL_INVITE_FIRST_ORDER:${order.userId}:${order.id}`,
      refType: 'ORDER',
      refId: order.id,
      meta: {
        inviteeUserId: order.userId,
        bindingId: binding.id,
      },
    });

    if (result.status === 'GRANTED' || result.status === 'DUPLICATE') {
      await this.prisma.normalShareBinding.updateMany({
        where: {
          id: binding.id,
          relationStatus: 'ACTIVE' as any,
          rewardStatus: { in: ['PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING'] },
        },
        data: {
          firstOrderId: order.id,
          rewardStatus: 'ISSUED',
          rewardIssuedAt: new Date(),
        },
      });
    }
  }

  private isGrowthEligibleNormalOrder(order: any) {
    if (!order || order.bizType !== 'NORMAL_GOODS') return false;
    if ((order.goodsAmount ?? 0) <= 0) return false;
    if (!Array.isArray(order.items) || order.items.length === 0) return false;
    return order.items.some((item: any) => !item.isPrize);
  }
}
