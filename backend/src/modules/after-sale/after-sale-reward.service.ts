import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_USER_ID, getAccountTypeForLedger } from '../bonus/engine/constants';
import { QueueRewardService } from '../queue-reward/queue-reward.service';
import type { QueueRewardVoidOptions } from '../queue-reward/queue-reward.service';
import {
  centsToYuan,
  nonNegativeYuanCapacityToCents,
  yuanToCents,
} from '../profit/money-allocation';

/** P2034 序列化冲突重试次数 */
const MAX_RETRIES = 3;
const DIRECT_REFERRAL_ORIGINAL_SCHEMES = new Set([
  'VIP_DIRECT_REFERRAL',
  'VIP_DIRECT_REFERRAL_PLATFORM',
  'NORMAL_DIRECT_REFERRAL',
  'NORMAL_DIRECT_REFERRAL_PLATFORM',
]);
const DIRECT_REFERRAL_VOID_SCHEMES = new Set([
  'VIP_DIRECT_REFERRAL_VOID',
  'NORMAL_DIRECT_REFERRAL_VOID',
]);
const DIRECT_REFERRAL_AUDIT_COPY_KEYS = [
  'sourceUserId',
  'directInviterUserId',
  'inviterTierAtOrder',
  'inviteeTierAtOrder',
  'profit',
  'ratio',
  'directReferralPool',
  'platformReason',
  'sourceRelation',
  'normalShareBindingId',
  'relationStatus',
  'sourceCode',
  'sourceCodeType',
  'configSnapshot',
  'releaseCondition',
] as const;

/**
 * 售后奖励归平台服务
 *
 * 当售后成功（退款到账 REFUNDED 或换货完成 COMPLETED）时，
 * 将该订单关联的所有分润奖励作废归平台。
 *
 * 处理状态：
 * - RETURN_FROZEN → VOIDED（正常路径：退货保护期内售后成功）
 * - FROZEN → VOIDED（防御路径：保护期已过但售后仍在进行）
 * - AVAILABLE → VOIDED（极端防御：已释放但售后成功，需回收）
 */
@Injectable()
export class AfterSaleRewardService {
  private readonly logger = new Logger(AfterSaleRewardService.name);

  constructor(
    private prisma: PrismaService,
    private queueRewardService: QueueRewardService,
  ) {}

  /**
   * 售后成功后作废该订单的所有分润奖励
   *
   * @param orderId 关联订单 ID
   */
  async voidRewardsForOrder(orderId: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(
          (tx) => this.voidRewardsForOrderInTransaction(tx, orderId),
          {
            timeout: 30000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return; // 成功退出重试循环
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `voidRewardsForOrder 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: orderId=${orderId}`,
          );
          continue;
        }
        this.logger.error(
          `售后奖励作废失败: orderId=${orderId}, error=${(err as Error).message}`,
        );
        throw err;
      }
    }
  }

  /**
   * 在调用方已经建立的 Serializable 事务内作废全部奖励。
   *
   * 换货完成必须把状态迁移和奖励作废放进同一个事务，不能依赖
   * 提交后的 fire-and-forget；否则进程退出会永久漏回收。
   */
  async voidRewardsForOrderInTransaction(
    tx: Prisma.TransactionClient,
    orderId: string,
    queueOptions: QueueRewardVoidOptions = {},
  ): Promise<void> {
    // 全局订单队列同时受“来源订单”和“受益位置订单”影响，
    // 必须走独立双向作废逻辑，不能混入下面按 refId 的旧树回收。
    await this.queueRewardService.voidRewardsForOrderInTransaction(
      tx,
      orderId,
      'AFTER_SALE_SUCCESS',
      queueOptions,
    );

    // 1. 查找该订单的所有分润奖励（RETURN_FROZEN / FROZEN / AVAILABLE）
    const ledgers = await tx.rewardLedger.findMany({
      where: {
        refType: 'ORDER',
        refId: orderId,
        entryType: 'FREEZE',
        status: { in: ['RETURN_FROZEN', 'FROZEN'] },
        account: { type: { not: 'QUEUE_REWARD' } },
      },
    });

    // 防御性查找：已释放为 AVAILABLE 的奖励（RELEASE 类型）
    const releasedLedgers = (await tx.rewardLedger.findMany({
      where: {
        refType: 'ORDER',
        refId: orderId,
        entryType: 'RELEASE',
        status: 'AVAILABLE',
        account: { type: { not: 'QUEUE_REWARD' } },
      },
    })).filter((ledger) =>
      !DIRECT_REFERRAL_VOID_SCHEMES.has((ledger.meta as any)?.scheme),
    );

    if (releasedLedgers.length > 0) {
      this.logger.warn(
        `订单 ${orderId} 有 ${releasedLedgers.length} 条已释放(AVAILABLE)奖励需回收，进入防御回收流程`,
      );
    }

    const allLedgers = [...ledgers, ...releasedLedgers];
    if (allLedgers.length === 0) {
      this.logger.log(`订单 ${orderId} 无待作废的分润奖励`);
      return;
    }

    this.logger.log(
      `订单 ${orderId} 发现 ${allLedgers.length} 条分润奖励待作废 ` +
      `(RETURN_FROZEN: ${ledgers.filter((l) => l.status === 'RETURN_FROZEN').length}, ` +
      `FROZEN: ${ledgers.filter((l) => l.status === 'FROZEN').length}, ` +
      `AVAILABLE: ${releasedLedgers.length})`,
    );

    // 确保平台 PLATFORM_PROFIT 账户存在
    let platformAccount = await tx.rewardAccount.findUnique({
      where: {
        userId_type: {
          userId: PLATFORM_USER_ID,
          type: 'PLATFORM_PROFIT',
        },
      },
    });
    if (!platformAccount) {
      platformAccount = await tx.rewardAccount.create({
        data: { userId: PLATFORM_USER_ID, type: 'PLATFORM_PROFIT' },
      });
    }

    // 2. 逐条 CAS 作废。旧树与直推奖励保持原有严格回收语义；
    // 队列奖励的独立追偿逻辑已经在上方单独完成。
    for (const ledger of allLedgers) {
      const originalStatus = ledger.status;
      const originalEntryType = ledger.entryType;

      // 先抢占源流水。只有 CAS 成功的事务才可以扣账户，
      // 避免并发回调在源流水已处理时仍重复扣款。
      const cas = await tx.rewardLedger.updateMany({
        where: {
          id: ledger.id,
          status: originalStatus as any,
          entryType: originalEntryType as any,
        },
        data: {
          status: 'VOIDED',
          entryType: 'VOID',
        },
      });

      if (cas.count === 0) {
        this.logger.log(`奖励 ${ledger.id} 已非 ${originalStatus} 状态，跳过`);
        continue;
      }

      // LEGACY/无 READY 利润快照订单可能在退款时奖励已释放甚至已提现。
      // 渠道退款一旦成功不可撤销，因此这里必须“能追多少追多少”，
      // 不足部分转为持久化 CLAWBACK_PENDING，不得抛错回滚 REFUNDED。
      const originalAmountCents = yuanToCents(Number(ledger.amount));
      let recoveredAmountCents = originalAmountCents;
      if (originalStatus === 'AVAILABLE' || originalStatus === 'FROZEN') {
        const account = await tx.rewardAccount.findUnique({
          where: { id: ledger.accountId },
        });
        const recoverableCents = nonNegativeYuanCapacityToCents(originalStatus === 'AVAILABLE'
          ? Number(account?.balance ?? 0)
          : Number(account?.frozen ?? 0));
        recoveredAmountCents = Math.min(originalAmountCents, Math.max(0, recoverableCents));
        if (recoveredAmountCents > 0) {
          const recoveredAmount = centsToYuan(recoveredAmountCents);
          const accountType = getAccountTypeForLedger(ledger.meta);
          const field = originalStatus === 'AVAILABLE' ? 'balance' : 'frozen';
          const debit = await tx.rewardAccount.updateMany({
            where: {
              userId: ledger.userId,
              type: accountType,
              [field]: { gte: recoveredAmount },
            },
            data: { [field]: { decrement: recoveredAmount } },
          });
          if (debit.count !== 1) {
            // 余额刚被并发提现/消费占用：不阻断已成功的渠道退款，
            // 保守地将本次全额转入 CLAWBACK_PENDING。
            recoveredAmountCents = 0;
          }
        }
      }
      const recoveredAmount = centsToYuan(recoveredAmountCents);
      const clawbackAmountCents = originalAmountCents - recoveredAmountCents;
      const clawbackAmount = centsToYuan(clawbackAmountCents);

      // 3. 账户可追回部分已在 CAS 之前扣减（同一 Serializable 事务）。
      const scheme = (ledger.meta as any)?.scheme;
      const isDirectReferral =
        DIRECT_REFERRAL_ORIGINAL_SCHEMES.has(scheme);

      // 4. 平台只记已实际追回的金额，不将未追偿债权虚增为平台可用余额。
      if (recoveredAmount > 0) {
        await tx.rewardLedger.create({
          data: {
            accountId: platformAccount.id,
            userId: PLATFORM_USER_ID,
            entryType: 'RELEASE',
            amount: recoveredAmount,
            status: 'AVAILABLE',
            refType: 'AFTER_SALE',
            refId: orderId,
            meta: isDirectReferral
              ? this.buildDirectReferralVoidMeta(
                  ledger,
                  orderId,
                  originalStatus,
                  scheme,
                )
              : {
                  scheme: 'AFTER_SALE_VOID',
                  originalUserId: ledger.userId,
                  originalLedgerId: ledger.id,
                  originalStatus,
                  originalScheme: scheme,
                  reason: '售后成功，已追回奖励归平台',
                },
          },
        });

        await tx.rewardAccount.update({
          where: { id: platformAccount.id },
          data: { balance: { increment: recoveredAmount } },
        });
      }

      // 5. 余额/冻结不足部分形成稳定幂等键的待追偿流水。
      if (clawbackAmount > 0) {
        await tx.rewardLedger.create({
          data: {
            allocationId: ledger.allocationId ?? undefined,
            accountId: ledger.accountId,
            userId: ledger.userId,
            entryType: 'VOID',
            amount: -clawbackAmount,
            status: 'RETURN_FROZEN',
            refType: 'AFTER_SALE_CLAWBACK',
            refId: orderId,
            sourceLedgerId: ledger.id,
            idempotencyKey: `legacy-refund-clawback:${orderId}:${ledger.id}`,
            meta: {
              scheme: 'LEGACY_REFUND_CLAWBACK',
              clawbackStatus: 'CLAWBACK_PENDING',
              originalLedgerId: ledger.id,
              originalStatus,
              originalAmount: ledger.amount,
              originalAmountCents,
              recoveredAmount,
              recoveredAmountCents,
              clawbackAmount,
              clawbackAmountCents,
              reason: '渠道退款已成功，奖励余额不足，转待追偿',
            },
          },
        });
      }

      this.logger.log(
        `作废奖励：ledger ${ledger.id}，${ledger.amount} 元（${originalStatus}→VOIDED），` +
        `已追回=${recoveredAmount}，待追偿=${clawbackAmount}`,
      );
    }
  }

  async voidQueueRewardsForOrderInTransaction(
    tx: Prisma.TransactionClient,
    orderId: string,
    options: QueueRewardVoidOptions = {},
  ): Promise<void> {
    await this.queueRewardService.voidRewardsForOrderInTransaction(
      tx,
      orderId,
      'AFTER_SALE_SUCCESS',
      options,
    );
  }

  private buildDirectReferralVoidMeta(
    ledger: any,
    orderId: string,
    originalStatus: string,
    originalScheme: string,
  ) {
    const sourceMeta = (ledger.meta ?? {}) as Record<string, any>;
    const isNormal = originalScheme === 'NORMAL_DIRECT_REFERRAL' ||
      originalScheme === 'NORMAL_DIRECT_REFERRAL_PLATFORM';
    const meta: Record<string, any> = {
      scheme: isNormal ? 'NORMAL_DIRECT_REFERRAL_VOID' : 'VIP_DIRECT_REFERRAL_VOID',
      originalScheme,
      accountType: 'PLATFORM_PROFIT',
      routedToPlatform: true,
      originalUserId: ledger.userId,
      originalReceiverUserId: ledger.userId,
      originalLedgerId: ledger.id,
      originalStatus,
      sourceOrderId: sourceMeta.sourceOrderId ?? orderId,
      voidSource: 'AFTER_SALE_SUCCESS',
      reason: isNormal ? '售后成功，普通直推佣金归平台' : '售后成功，VIP直推佣金归平台',
    };

    for (const key of DIRECT_REFERRAL_AUDIT_COPY_KEYS) {
      if (sourceMeta[key] !== undefined) {
        meta[key] = sourceMeta[key];
      }
    }

    return meta;
  }

  /**
   * C02修复：检查订单所有非奖品项是否已全部退款，如果是则标记 Order.status = REFUNDED
   */
  async checkAndMarkOrderRefunded(orderId: string): Promise<void> {
    try {
      const nonPrizeItems = await this.prisma.orderItem.findMany({
        where: { orderId, isPrize: false, deletedAt: null },
        select: { id: true },
      });

      if (nonPrizeItems.length === 0) return;

      // 统计已退款的非奖品项（用 distinct 防止同一 orderItem 多条 REFUNDED 记录导致虚高）
      const refundedItems = await this.prisma.afterSaleRequest.findMany({
        where: {
          orderId,
          orderItemId: { in: nonPrizeItems.map((i) => i.id) },
          status: 'REFUNDED',
        },
        select: { orderItemId: true },
        distinct: ['orderItemId'],
      });

      if (refundedItems.length >= nonPrizeItems.length) {
        // 所有非奖品项已退款，读取当前订单状态后 CAS 更新
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        if (!order || order.status === 'REFUNDED' || order.status === 'CANCELED') return;

        const updated = await this.prisma.order.updateMany({
          where: { id: orderId, status: { notIn: ['REFUNDED', 'CANCELED'] } },
          data: { status: 'REFUNDED' },
        });

        if (updated.count > 0) {
          await this.prisma.orderStatusHistory.create({
            data: {
              orderId,
              fromStatus: order.status,
              toStatus: 'REFUNDED',
              reason: '所有非奖品项已退款完成，订单标记为全额退款',
            },
          });
          this.logger.log(`订单 ${orderId} 所有非奖品项已退款，状态更新为 REFUNDED`);
        }
      }
    } catch (err: any) {
      this.logger.error(
        `检查订单全退状态失败: orderId=${orderId}, error=${err?.message}`,
      );
    }
  }
}
