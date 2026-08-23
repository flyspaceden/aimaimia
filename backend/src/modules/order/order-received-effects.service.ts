import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import { BonusAllocationService } from '../bonus/engine/bonus-allocation.service';
import { BonusService } from '../bonus/bonus.service';
import { DigitalAssetService } from '../digital-asset/digital-asset.service';
import { GroupBuyLifecycleService } from '../group-buy/group-buy-lifecycle.service';
import { GrowthEventService } from '../growth/growth-event.service';
import { CaptainCommissionService } from '../captain/captain-commission.service';
import { CouponEngineService } from '../coupon/coupon-engine.service';
import {
  CAPTAIN_SEAFOOD_PROGRAM_CODE,
  DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
} from '../captain/captain.constants';

type Tx = Prisma.TransactionClient;

const EFFECT_KINDS = [
  'BONUS_ALLOCATION',
  'GROUP_BUY_EVALUATION',
  'DIGITAL_ASSET_CREDIT',
  'GROWTH_REWARD',
  'COUPON_TRIGGERS',
  'CAPTAIN_COMMISSION_RELEASE',
] as const;

type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * 确认收货后的可靠副作用执行器。
 *
 * 不依赖进程内 Promise：订单状态与六类 outbox 在同一事务提交。
 * 执行使用短租约 + CAS，实例崩溃后 cron 会回收过期租约并重试。
 */
@Injectable()
export class OrderReceivedEffectsService {
  private readonly logger = new Logger(OrderReceivedEffectsService.name);
  private readonly leaseMs = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bonusAllocation: BonusAllocationService,
    private readonly digitalAssetService: DigitalAssetService,
    private readonly bonusService: BonusService,
    private readonly groupBuyLifecycleService: GroupBuyLifecycleService,
    private readonly growthEventService: GrowthEventService,
    private readonly captainCommissionService: CaptainCommissionService,
    private readonly couponEngineService: CouponEngineService,
  ) {}

  async enqueueInTransaction(
    tx: Tx,
    input: {
      orderId: string;
      userId: string;
      source: 'BUYER_CONFIRM' | 'AUTO_CONFIRM' | 'PICKUP_VERIFY';
      isFirstReceived: boolean;
    },
  ): Promise<void> {
    await tx.orderReceivedEffectOutbox.createMany({
      data: EFFECT_KINDS.map((kind) => ({
        orderId: input.orderId,
        userId: input.userId,
        kind,
        source: input.source,
        isFirstReceived: input.isFirstReceived,
      })),
      skipDuplicates: true,
    });
  }

  /** 提交后尽快执行；即使这个 Promise 未运行，cron 仍可恢复。 */
  kick(orderId: string): void {
    void this.processOrder(orderId).catch((error) => {
      const safe = sanitizeErrorForLog(error);
      this.logger.warn(`收货 outbox 立即执行失败: orderId=${orderId}; error=${safe.message}`);
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processPending(): Promise<void> {
    const now = new Date();
    const rows = await this.prisma.orderReceivedEffectOutbox.findMany({
      where: {
        runAt: { lte: now },
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
        ],
      },
      select: { orderId: true },
      distinct: ['orderId'],
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const row of rows) {
      await this.processOrder(row.orderId);
    }
  }

  async processOrder(orderId: string): Promise<void> {
    const rows = await this.prisma.orderReceivedEffectOutbox.findMany({
      where: { orderId, status: { not: 'SUCCEEDED' } },
    });
    const byKind = new Map(rows.map((row) => [row.kind as EffectKind, row]));
    const run = async (kind: EffectKind) => {
      const row = byKind.get(kind);
      return row ? this.processOne(row as any) : true;
    };

    // 分润和团购各自失败不应饿死其他独立权益。
    await run('BONUS_ALLOCATION');
    await run('GROUP_BUY_EVALUATION');

    // 成长必须保持原有 digital → 自动VIP → growth 顺序。digital 失败或
    // 正由另一实例处理时，本轮保留 growth PENDING，避免按旧 NORMAL tier
    // 幂等落账后再也无法补足 VIP multiplier。
    const digitalReady = await run('DIGITAL_ASSET_CREDIT');
    if (digitalReady) await run('GROWTH_REWARD');

    // 红包与团长佣金拥有独立幂等/延迟状态，不受上述任务失败阻塞。
    await run('COUPON_TRIGGERS');
    await run('CAPTAIN_COMMISSION_RELEASE');
  }

  private async processOne(row: {
    id: string;
    orderId: string;
    userId: string;
    kind: EffectKind;
    attempts: number;
    source: string;
    isFirstReceived: boolean;
  }): Promise<boolean> {
    const now = new Date();
    const leaseToken = randomUUID();
    const claimed = await this.prisma.orderReceivedEffectOutbox.updateMany({
      where: {
        id: row.id,
        runAt: { lte: now },
        OR: [
          { status: { in: ['PENDING', 'FAILED'] } },
          { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        processingAt: now,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
        lastError: null,
      },
    });
    if (claimed.count !== 1) return false;

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: row.orderId },
        select: {
          id: true,
          userId: true,
          status: true,
          bizType: true,
          goodsAmount: true,
          totalAmount: true,
          receivedAt: true,
          returnWindowExpiresAt: true,
          items: { select: { isPrize: true } },
        },
      });
      if (!order || order.status !== 'RECEIVED') {
        await this.markSucceeded(row.id, leaseToken, '订单已非 RECEIVED，副作用作废');
        return true;
      }

      if (row.kind === 'BONUS_ALLOCATION') {
        // allocateForOrder 内部使用稳定幂等键。
        await this.bonusAllocation.allocateForOrder(row.orderId);
      } else if (row.kind === 'GROUP_BUY_EVALUATION') {
        await this.groupBuyLifecycleService.evaluateOrderAfterReceive(row.orderId);
      } else if (row.kind === 'DIGITAL_ASSET_CREDIT') {
        // recordOrderReceived 的 order:* ledger 唯一键保证崩溃重放不重复入账。
        const recordOrderReceived = (this.digitalAssetService as any).recordOrderReceived
          ?? (this.digitalAssetService as any).creditOrderReceived;
        const result = await recordOrderReceived.call(
          this.digitalAssetService,
          row.orderId,
          'ORDER_RECEIVED',
        );
        if (result?.recorded === true || result?.reason === 'DUPLICATE_LEDGER') {
          await this.bonusService.activateVipByCumulativeSpend(row.userId, row.orderId);
        }
      } else if (row.kind === 'GROWTH_REWARD') {
        await this.grantGrowth(order, row.isFirstReceived);
      } else if (row.kind === 'CAPTAIN_COMMISSION_RELEASE') {
        const reason = row.source === 'AUTO_CONFIRM' ? 'AUTO_RECEIVED' : 'BUYER_RECEIVED';
        const result = await this.captainCommissionService.releaseForReceivedOrder(
          row.orderId,
          reason,
        );
        if (result === 'skipped') {
          const releaseAt = await this.resolveCaptainReleaseAt(order);
          if (releaseAt && releaseAt.getTime() > Date.now()) {
            await this.deferUntil(row.id, leaseToken, releaseAt, '团长佣金等待退货窗口/冻结期结束');
            // 团长冻结期是预期延迟，不能阻塞独立的红包任务。
            return true;
          }
        }
      } else {
        if (row.isFirstReceived) {
          await this.couponEngineService.handleTrigger(row.userId, 'FIRST_ORDER', {
            idempotencyKey: `order-received:${row.orderId}:FIRST_ORDER`,
          });
        }
        const aggregate = await this.prisma.order.aggregate({
          where: { userId: row.userId, status: 'RECEIVED' },
          _sum: { totalAmount: true },
        });
        const totalSpent = Number(aggregate._sum?.totalAmount ?? 0);
        if (totalSpent > 0) {
          await this.couponEngineService.handleTrigger(row.userId, 'CUMULATIVE_SPEND', {
            totalSpent,
            idempotencyKey: `order-received:${row.orderId}:CUMULATIVE_SPEND`,
          });
        }
      }

      await this.markSucceeded(row.id, leaseToken);
      return true;
    } catch (error) {
      const safe = sanitizeErrorForLog(error);
      const attempts = row.attempts + 1;
      const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 7));
      await this.prisma.orderReceivedEffectOutbox.updateMany({
        where: { id: row.id, status: 'PROCESSING', leaseToken },
        data: {
          status: 'FAILED',
          runAt: new Date(Date.now() + delayMs),
          processingAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: safe.message.slice(0, 2000),
        },
      });
      this.logger.error(
        `收货副作用失败，已持久化重试: orderId=${row.orderId}; kind=${row.kind}; error=${safe.message}`,
        safe.stack,
      );
      return false;
    }
  }

  private async grantGrowth(order: any, isFirstReceived: boolean): Promise<void> {
    if (
      order.bizType !== 'NORMAL_GOODS'
      || Number(order.goodsAmount ?? 0) <= 0
      || !Array.isArray(order.items)
      || !order.items.some((item: any) => !item.isPrize)
    ) return;

    const behaviorCode = isFirstReceived ? 'FIRST_ORDER_RECEIVED' : 'REPURCHASE_RECEIVED';
    await this.growthEventService.receive({
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
    });
    if (!isFirstReceived) return;

    const binding = await this.prisma.normalShareBinding.findUnique({
      where: { inviteeUserId: order.userId },
    });
    if (!binding) return;
    if ((binding as any).relationStatus && (binding as any).relationStatus !== 'ACTIVE') return;
    if (['ISSUED', 'REVERSED', 'VOIDED'].includes(binding.rewardStatus)) return;
    if (binding.firstOrderId && binding.firstOrderId !== order.id) return;
    const invite = await this.growthEventService.receive({
      userId: binding.inviterUserId,
      behaviorCode: 'NORMAL_INVITE_FIRST_ORDER',
      idempotencyKey: `NORMAL_INVITE_FIRST_ORDER:${order.userId}:${order.id}`,
      refType: 'ORDER',
      refId: order.id,
      meta: { inviteeUserId: order.userId, bindingId: binding.id },
    });
    if (invite.status === 'GRANTED' || invite.status === 'DUPLICATE') {
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

  private async resolveCaptainReleaseAt(order: any): Promise<Date | null> {
    const attribution = await this.prisma.captainOrderAttribution.findUnique({
      where: {
        orderId_programCode: {
          orderId: order.id,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        },
      },
      select: { status: true, configSnapshot: true },
    });
    if (!attribution || attribution.status === 'VOIDED' || !order.receivedAt) return null;
    const snapshot = (attribution.configSnapshot as any) ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG;
    const configuredDays = Number(
      snapshot.orderRules?.freezeDaysAfterReceived
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG.orderRules.freezeDaysAfterReceived,
    );
    const freezeDays = Number.isFinite(configuredDays) && configuredDays >= 0 ? configuredDays : 7;
    const receivedReleaseAt = new Date(new Date(order.receivedAt).getTime() + freezeDays * 86_400_000);
    const returnWindowReleaseAt = order.returnWindowExpiresAt
      ? new Date(order.returnWindowExpiresAt)
      : receivedReleaseAt;
    return new Date(Math.max(receivedReleaseAt.getTime(), returnWindowReleaseAt.getTime()));
  }

  private async deferUntil(
    id: string,
    leaseToken: string,
    runAt: Date,
    note: string,
  ): Promise<void> {
    await this.prisma.orderReceivedEffectOutbox.updateMany({
      where: { id, status: 'PROCESSING', leaseToken },
      data: {
        status: 'PENDING',
        runAt,
        processingAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: note,
      },
    });
  }

  private async markSucceeded(id: string, leaseToken: string, note?: string): Promise<void> {
    await this.prisma.orderReceivedEffectOutbox.updateMany({
      where: { id, status: 'PROCESSING', leaseToken },
      data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        processingAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: note ?? null,
      },
    });
  }
}
