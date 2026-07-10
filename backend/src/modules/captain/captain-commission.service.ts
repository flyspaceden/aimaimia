import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';
import {
  CAPTAIN_SEAFOOD_PROGRAM_CODE,
  DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
} from './captain.constants';

export type CaptainCommissionResult = 'released' | 'voided' | 'skipped';
export type CaptainReleaseReason =
  | 'BUYER_RECEIVED'
  | 'AUTO_RECEIVED'
  | 'MANUAL_RETRY';

const SERIALIZABLE_MAX_RETRIES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CaptainCommissionService {
  private readonly logger = new Logger(CaptainCommissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async releaseForReceivedOrder(
    orderId: string,
    reason: CaptainReleaseReason,
  ): Promise<CaptainCommissionResult> {
    return this.withSerializableRetry(async (tx) => {
      const attribution = await (tx as any).captainOrderAttribution.findUnique({
        where: {
          orderId_programCode: {
            orderId,
            programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          },
        },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              receivedAt: true,
              returnWindowExpiresAt: true,
              refunds: {
                where: { status: 'REFUNDED' },
                select: { id: true },
                take: 1,
              },
              afterSaleRequests: {
                where: { status: { in: ['REFUNDED', 'COMPLETED'] } },
                select: { id: true, status: true },
                take: 1,
              },
            },
          },
          ledgers: {
            where: {
              type: { in: ['DIRECT_ORDER', 'LEGACY_INDIRECT_ORDER'] },
              status: 'FROZEN',
              deletedAt: null,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!attribution || attribution.status === 'VOIDED') return 'skipped';
      if (!attribution.order || attribution.order.status !== 'RECEIVED') return 'skipped';
      if (!this.isReleaseDue(attribution)) return 'skipped';
      if ((attribution.order.refunds?.length ?? 0) > 0) return 'skipped';
      if ((attribution.order.afterSaleRequests?.length ?? 0) > 0) return 'skipped';

      const ledgers = this.releaseableOrderLedgers(attribution);
      if (ledgers.length === 0) return 'skipped';

      for (const ledger of ledgers) {
        const amount = this.roundMoney(Number(ledger.amount || 0));
        if (amount <= 0) continue;
        const account = await (tx as any).captainAccount.findUnique({
          where: { id: ledger.accountId },
        });
        if (!account) continue;

        const frozenAfter = this.roundMoney(Math.max(0, Number(account.frozen || 0) - amount));
        const balanceAfter = this.roundMoney(Number(account.balance || 0) + amount);

        await (tx as any).captainCommissionLedger.update({
          where: { id: ledger.id },
          data: {
            status: 'AVAILABLE',
            balanceAfter,
            frozenAfter,
            meta: {
              ...(ledger.meta || {}),
              releasedAt: new Date().toISOString(),
              releaseReason: reason,
            },
          },
        });
        await (tx as any).captainAccount.update({
          where: { id: ledger.accountId },
          data: {
            frozen: { decrement: amount },
            balance: { increment: amount },
          },
        });
      }

      await (tx as any).captainOrderAttribution.update({
        where: { id: attribution.id },
        data: {
          status: 'AVAILABLE',
          meta: {
            ...(attribution.meta || {}),
            releasedAt: new Date().toISOString(),
            releaseReason: reason,
          },
        },
      });

      return 'released';
    });
  }

  async voidForRefund(
    orderId: string,
    refundId: string,
    refundAmount: number,
  ): Promise<CaptainCommissionResult> {
    if (!refundId || refundAmount <= 0) return 'skipped';

    return this.withSerializableRetry(async (tx) => {
      const existingVoid = await (tx as any).captainCommissionLedger.findFirst({
        where: {
          orderId,
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          type: 'VOID',
          refType: 'REFUND',
          refId: refundId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingVoid) return 'skipped';

      const attribution = await (tx as any).captainOrderAttribution.findUnique({
        where: {
          orderId_programCode: {
            orderId,
            programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
          },
        },
        include: {
          ledgers: {
            where: {
              type: { in: ['DIRECT_ORDER', 'LEGACY_INDIRECT_ORDER'] },
              status: { in: ['FROZEN', 'AVAILABLE'] },
              deletedAt: null,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!attribution) return 'skipped';

      const commissionBase = this.roundMoney(Number(attribution.commissionBase || 0));
      if (commissionBase <= 0) return 'skipped';

      const refundRatio = Math.min(1, this.roundMoney(refundAmount) / commissionBase);
      if (refundRatio <= 0) return 'skipped';

      const ledgers = this.releaseableOrderLedgers(attribution);
      const priorVoidAmounts = await this.loadPriorVoidAmounts(tx, orderId);
      let touched = false;
      for (const ledger of ledgers) {
        const currentAmount = this.roundMoney(Number(ledger.amount || 0));
        if (currentAmount <= 0) continue;
        const originalAmount = this.roundMoney(Number(ledger.meta?.originalAmount ?? currentAmount));
        const requestedVoidAmount = this.roundMoney(originalAmount * refundRatio);
        const remainingVoidable = this.roundMoney(
          Math.max(0, originalAmount - (priorVoidAmounts.get(ledger.id) ?? 0)),
        );
        const voidAmount = this.roundMoney(Math.min(currentAmount, requestedVoidAmount, remainingVoidable));
        if (voidAmount <= 0) continue;

        if (ledger.status === 'FROZEN') {
          await this.voidFrozenLedger(tx, {
            ledger,
            attribution,
            refundId,
            refundAmount,
            refundRatio,
            voidAmount,
            originalAmount,
          });
        } else {
          await this.voidAvailableLedger(tx, {
            ledger,
            attribution,
            refundId,
            refundAmount,
            refundRatio,
            voidAmount,
            originalAmount,
          });
        }
        touched = true;
      }

      if (!touched) return 'skipped';

      const nextRefundAmount = this.roundMoney(Number(attribution.refundAmount || 0) + refundAmount);
      await (tx as any).captainOrderAttribution.update({
        where: { id: attribution.id },
        data: {
          refundAmount: { increment: this.roundMoney(refundAmount) },
          status: nextRefundAmount >= commissionBase ? 'VOIDED' : 'PARTIAL_REFUNDED',
          meta: {
            ...(attribution.meta || {}),
            lastRefundId: refundId,
            lastRefundAt: new Date().toISOString(),
          },
        },
      });

      return 'voided';
    });
  }

  private async loadPriorVoidAmounts(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<Map<string, number>> {
    const voidLedgers = await (tx as any).captainCommissionLedger.findMany({
      where: {
        orderId,
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        type: 'VOID',
        refType: 'REFUND',
        deletedAt: null,
      },
      select: {
        amount: true,
        meta: true,
      },
    });

    const result = new Map<string, number>();
    for (const ledger of voidLedgers ?? []) {
      const originalLedgerId = ledger.meta?.originalLedgerId;
      if (!originalLedgerId) continue;
      const current = result.get(originalLedgerId) ?? 0;
      result.set(originalLedgerId, this.roundMoney(current + Math.abs(Number(ledger.amount || 0))));
    }
    return result;
  }

  async writeDeadLetter(
    orderId: string,
    event: string,
    error: unknown,
  ): Promise<void> {
    const safeErr = sanitizeErrorForLog(error);
    this.logger.error(`团长佣金处理失败: event=${event}, orderId=${orderId}, error=${safeErr.message}`, safeErr.stack);
    await this.prisma.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: 'RECEIVED',
        toStatus: 'RECEIVED',
        reason: '团长佣金处理失败',
        meta: {
          deadLetter: true,
          event,
          error: safeErr.message,
          failedAt: new Date().toISOString(),
        },
      },
    });
  }

  private async voidFrozenLedger(
    tx: Prisma.TransactionClient,
    params: {
      ledger: any;
      attribution: any;
      refundId: string;
      refundAmount: number;
      refundRatio: number;
      voidAmount: number;
      originalAmount: number;
    },
  ) {
    const { ledger, attribution, refundId, refundAmount, refundRatio, voidAmount, originalAmount } = params;
    const account = await (tx as any).captainAccount.findUnique({
      where: { id: ledger.accountId },
    });
    if (!account) return;

    const remainingAmount = this.roundMoney(Number(ledger.amount || 0) - voidAmount);
    const frozenAfter = this.roundMoney(Math.max(0, Number(account.frozen || 0) - voidAmount));
    const fullVoid = remainingAmount <= 0;

    await (tx as any).captainCommissionLedger.update({
      where: { id: ledger.id },
      data: {
        status: fullVoid ? 'VOIDED' : 'FROZEN',
        amount: fullVoid ? ledger.amount : remainingAmount,
        frozenAfter,
        meta: {
          ...(ledger.meta || {}),
          originalAmount,
          lastRefundId: refundId,
          lastRefundRatio: refundRatio,
          lastVoidAmount: voidAmount,
        },
      },
    });
    await (tx as any).captainAccount.update({
      where: { id: ledger.accountId },
      data: { frozen: { decrement: voidAmount } },
    });
    await this.createVoidLedger(tx, {
      ledger,
      attribution,
      refundId,
      refundAmount,
      refundRatio,
      voidAmount,
      status: 'VOIDED',
      frozenAfter,
      balanceAfter: null,
      clawbackAmount: 0,
      originalStatus: 'FROZEN',
    });
  }

  private async voidAvailableLedger(
    tx: Prisma.TransactionClient,
    params: {
      ledger: any;
      attribution: any;
      refundId: string;
      refundAmount: number;
      refundRatio: number;
      voidAmount: number;
      originalAmount: number;
    },
  ) {
    const { ledger, attribution, refundId, refundAmount, refundRatio, voidAmount, originalAmount } = params;
    const account = await (tx as any).captainAccount.findUnique({
      where: { id: ledger.accountId },
    });
    if (!account) return;

    const balance = this.roundMoney(Number(account.balance || 0));
    const balanceDebit = this.roundMoney(Math.min(balance, voidAmount));
    const clawbackAmount = this.roundMoney(voidAmount - balanceDebit);
    const balanceAfter = this.roundMoney(balance - balanceDebit);
    const updateData: Record<string, any> = {};
    if (balanceDebit > 0) {
      updateData.balance = { decrement: balanceDebit };
    }
    if (clawbackAmount > 0) {
      updateData.clawback = { increment: clawbackAmount };
    }
    if (Object.keys(updateData).length > 0) {
      await (tx as any).captainAccount.update({
        where: { id: ledger.accountId },
        data: updateData,
      });
    }
    await this.createVoidLedger(tx, {
      ledger: {
        ...ledger,
        meta: {
          ...(ledger.meta || {}),
          originalAmount,
        },
      },
      attribution,
      refundId,
      refundAmount,
      refundRatio,
      voidAmount,
      status: clawbackAmount > 0 ? 'CLAWBACK_PENDING' : 'AVAILABLE',
      frozenAfter: null,
      balanceAfter,
      clawbackAmount,
      originalStatus: 'AVAILABLE',
    });
  }

  private async createVoidLedger(
    tx: Prisma.TransactionClient,
    params: {
      ledger: any;
      attribution: any;
      refundId: string;
      refundAmount: number;
      refundRatio: number;
      voidAmount: number;
      status: 'VOIDED' | 'AVAILABLE' | 'CLAWBACK_PENDING';
      frozenAfter: number | null;
      balanceAfter: number | null;
      clawbackAmount: number;
      originalStatus: 'FROZEN' | 'AVAILABLE';
    },
  ) {
    const { ledger, attribution, refundId, refundAmount, refundRatio, voidAmount } = params;
    await (tx as any).captainCommissionLedger.create({
      data: {
        accountId: ledger.accountId,
        userId: ledger.userId,
        orderAttributionId: attribution.id,
        orderId: attribution.orderId,
        programCode: attribution.programCode,
        type: 'VOID',
        status: params.status,
        amount: -voidAmount,
        commissionBase: attribution.commissionBase,
        rate: ledger.rate,
        balanceAfter: params.balanceAfter,
        frozenAfter: params.frozenAfter,
        idempotencyKey: `captain:void:${attribution.orderId}:${refundId}:${ledger.id}`,
        refType: 'REFUND',
        refId: refundId,
        configSnapshot: ledger.configSnapshot ?? attribution.configSnapshot,
        meta: {
          originalLedgerId: ledger.id,
          originalLedgerStatus: params.originalStatus,
          originalAmount: ledger.meta?.originalAmount ?? ledger.amount,
          refundAmount: this.roundMoney(refundAmount),
          refundRatio,
          clawbackAmount: params.clawbackAmount,
        },
      },
    });
  }

  private isReleaseDue(attribution: any): boolean {
    const order = attribution.order;
    if (!order?.receivedAt) return false;

    const snapshot = attribution.configSnapshot || DEFAULT_CAPTAIN_SEAFOOD_CONFIG;
    const freezeDays = Number(
      snapshot.orderRules?.freezeDaysAfterReceived
        ?? DEFAULT_CAPTAIN_SEAFOOD_CONFIG.orderRules.freezeDaysAfterReceived,
    );
    const receivedReleaseAt = new Date(new Date(order.receivedAt).getTime() + freezeDays * DAY_MS);
    const returnWindowReleaseAt = order.returnWindowExpiresAt
      ? new Date(order.returnWindowExpiresAt)
      : receivedReleaseAt;
    const releaseAt = new Date(Math.max(receivedReleaseAt.getTime(), returnWindowReleaseAt.getTime()));

    return Date.now() >= releaseAt.getTime();
  }

  private releaseableOrderLedgers(attribution: any): any[] {
    const ledgers = attribution.ledgers ?? [];
    return attribution.calculationModel === 'PROFIT_V3'
      ? ledgers.filter((ledger: any) => ledger.type === 'DIRECT_ORDER')
      : ledgers;
  }

  private async withSerializableRetry<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < SERIALIZABLE_MAX_RETRIES - 1) {
          this.logger.warn(`团长佣金 Serializable 冲突，重试 ${attempt + 1}/${SERIALIZABLE_MAX_RETRIES}`);
          continue;
        }
        if (err?.code === 'P2002') {
          return 'skipped' as T;
        }
        throw err;
      }
    }
    throw new Error('团长佣金 Serializable 重试耗尽');
  }

  private roundMoney(value: number): number {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }
}
