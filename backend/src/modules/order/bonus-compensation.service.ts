import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusAllocationService } from '../bonus/engine/bonus-allocation.service';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import { DEAD_LETTER_REASON } from '../bonus/engine/constants';

/**
 * S08修复：奖金分配补偿服务
 *
 * 定时扫描「已确认收货但分润失败」的订单（通过 OrderStatusHistory 中的死信记录识别），
 * 重新尝试分润分配。解决 fire-and-forget 模式下分润永久丢失的问题。
 */
@Injectable()
export class BonusCompensationService {
  private readonly logger = new Logger(BonusCompensationService.name);
  /** H9修复：Redis 分布式锁 key，防止多实例同时执行补偿 cron */
  private readonly cronLockKey = 'cron:bonus-compensation:every30m';
  private readonly cronLockTtlMs = 10 * 60_000; // 10 分钟锁租约

  constructor(
    private prisma: PrismaService,
    private bonusAllocation: BonusAllocationService,
    private redisCoord: RedisCoordinatorService,
  ) {}

  // 每 30 分钟扫描一次
  @Cron(CronExpression.EVERY_30_MINUTES)
  async compensateFailedBonusAllocations() {
    // H9修复：分布式锁防止多实例重复执行
    const redisOwner = `bonus-comp:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    try {
      const redisLock = await this.redisCoord.acquireLock(this.cronLockKey, redisOwner, this.cronLockTtlMs);
      if (redisLock === false) {
        this.logger.log('[Cron] 分润补偿任务 Redis 锁被其他实例持有，跳过');
        return;
      }
      // redisLock === null 表示 Redis 不可用，回退为无锁模式（单实例部署安全）
      if (redisLock === null) {
        this.logger.warn('[Cron] Redis 不可用，分润补偿以无锁模式执行（仅适合单实例部署）');
      }

      try {
        await this.doCompensation();
      } finally {
        // 仅在成功获取锁时释放
        if (redisLock === true) {
          await this.redisCoord.releaseLock(this.cronLockKey, redisOwner);
        }
      }
    } catch (err: any) {
      const safeErr = sanitizeErrorForLog(err);
      this.logger.error(`分润补偿 cron 执行异常: ${safeErr.message}`, safeErr.stack);
    }
  }

  /** 补偿逻辑主体 */
  private async doCompensation() {
    this.logger.log('开始扫描分润失败的订单...');

    // M14修复：使用常量替代硬编码中文字面量
    const deadLetters = await this.prisma.orderStatusHistory.findMany({
      where: {
        reason: DEAD_LETTER_REASON,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (deadLetters.length === 0) {
      this.logger.log('无分润失败的订单');
      return;
    }

    // 去重：同一订单可能有多条死信记录
    const orderIds = [...new Set(deadLetters.map(dl => dl.orderId))];
    this.logger.log(`发现 ${orderIds.length} 笔分润失败订单，开始补偿...`);

    let successCount = 0;
    for (const orderId of orderIds) {
      try {
        // 检查订单是否仍为 RECEIVED 状态（未被退款）
        const order = await this.prisma.order.findUnique({ where: { id: orderId } });
        if (!order || order.status !== 'RECEIVED') {
          this.logger.log(`订单 ${orderId} 状态已变更（${order?.status}），跳过补偿`);
          // 清理死信记录
          await this.clearDeadLetters(orderId, '订单状态已变更，无需补偿');
          continue;
        }

        // 检查是否已有成功的分润记录
        const existingAllocation = await this.prisma.rewardAllocation.findFirst({
          where: { orderId },
        });
        if (existingAllocation) {
          this.logger.log(`订单 ${orderId} 已有分润记录，清理死信`);
          await this.clearDeadLetters(orderId, '分润已存在，死信记录清理');
          continue;
        }

        // 重新尝试分润
        await this.bonusAllocation.allocateForOrder(orderId);
        successCount++;

        // 分润成功，清理死信记录
        await this.clearDeadLetters(orderId, '补偿分润成功');
        this.logger.log(`订单 ${orderId} 补偿分润成功`);
      } catch (err: any) {
        const safeErr = sanitizeErrorForLog(err);
        this.logger.error(`订单 ${orderId} 补偿分润失败: ${safeErr.message}`, safeErr.stack);
      }
    }

    this.logger.log(`分润补偿完成：${successCount}/${orderIds.length} 笔成功`);
  }

  // 清理死信记录（通过添加解决标记）
  private async clearDeadLetters(orderId: string, resolution: string) {
    await this.prisma.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: 'RECEIVED',
        toStatus: 'RECEIVED',
        reason: resolution,
        meta: { deadLetterResolved: true, resolvedAt: new Date().toISOString() },
      },
    });
  }
}
