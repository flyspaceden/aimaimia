import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { GroupBuyActivityStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GroupBuyRebateService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly serializableTransactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  async releaseReferralIfValid(referralId: string, now = new Date()) {
    return this.runSerializableWithRetry((tx) =>
      this.releaseReferralInTransaction(tx, { id: referralId }, now),
    );
  }

  async releaseReferralByOrderIfValid(orderId: string, now = new Date()) {
    return this.runSerializableWithRetry((tx) =>
      this.releaseReferralInTransaction(tx, { referredOrderId: orderId }, now),
    );
  }

  async voidReleasedReferralByOrderIfValid(
    orderId: string,
    reason = 'REFERRED_ORDER_AFTER_SALE_OR_REFUND',
    now = new Date(),
  ) {
    return this.runSerializableWithRetry(async (tx) => {
      const referral = await tx.groupBuyReferral.findFirst({
        where: { referredOrderId: orderId },
        include: {
          instance: true,
        },
      });
      if (!referral) {
        return { status: 'NOT_FOUND' };
      }
      if (referral.status !== 'VALID') {
        return { status: 'SKIPPED' };
      }

      const idempotencyKey = `GROUP_BUY_REBATE_VOID:${referral.id}`;
      const existingVoidLedger = await tx.groupBuyRebateLedger.findUnique({
        where: { idempotencyKey },
      });
      if (existingVoidLedger) {
        return {
          status: 'ALREADY_VOIDED',
          amount: Math.abs(Number(existingVoidLedger.amount ?? 0)),
          referralId: referral.id,
        };
      }

      const releaseLedger = await tx.groupBuyRebateLedger.findFirst({
        where: {
          referralId: referral.id,
          type: 'RELEASE',
          status: { in: ['AVAILABLE', 'RESERVED', 'COMPLETED'] },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!releaseLedger) {
        return { status: 'RELEASE_LEDGER_NOT_FOUND' };
      }

      const amount = this.roundMoney(Math.abs(Number(releaseLedger.amount ?? referral.amountSnapshot ?? 0)));
      if (!Number.isFinite(amount) || amount <= 0) {
        return { status: 'SKIPPED' };
      }

      const account = await tx.groupBuyRebateAccount.findUnique({
        where: { id: releaseLedger.accountId },
      });
      if (!account) {
        return { status: 'ACCOUNT_NOT_FOUND' };
      }

      const balanceBefore = this.roundMoney(Number(account.balance ?? 0));
      const balanceAfter = this.roundMoney(balanceBefore - amount);

      await tx.groupBuyRebateAccount.update({
        where: { id: account.id },
        data: { balance: { decrement: amount } },
      });
      await tx.groupBuyRebateLedger.update({
        where: { id: releaseLedger.id },
        data: {
          status: 'VOIDED',
          meta: this.mergeLedgerMeta(releaseLedger.meta, {
            voidReason: reason,
            voidedAt: now.toISOString(),
          }),
        },
      });
      await tx.groupBuyRebateLedger.create({
        data: {
          accountId: account.id,
          userId: referral.instance.userId,
          instanceId: referral.instanceId,
          referralId: referral.id,
          orderId,
          type: 'VOID',
          status: 'COMPLETED',
          amount: -amount,
          balanceBefore,
          balanceAfter,
          idempotencyKey,
          refType: 'GROUP_BUY_REFERRAL_VOID',
          refId: referral.id,
          meta: {
            reason,
            releaseLedgerId: releaseLedger.id,
            effectiveSequence: referral.effectiveSequence,
          },
        },
      });
      await tx.groupBuyReferral.update({
        where: { id: referral.id },
        data: {
          status: 'INVALID',
          invalidReason: reason,
          invalidatedAt: now,
          voidedAt: now,
        },
      });
      await tx.groupBuyInstance.update({
        where: { id: referral.instanceId },
        data: { validReferralCount: { decrement: 1 } },
      });

      return {
        status: 'VOIDED',
        amount,
        referralId: referral.id,
      };
    });
  }

  async getAccount(userId: string) {
    const account = await this.prisma.groupBuyRebateAccount.findUnique({
      where: { userId },
    });
    return this.mapAccount(account);
  }

  async listLedgers(userId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, Number.isFinite(Number(page)) ? Number(page) : 1);
    const safePageSize = Math.min(100, Math.max(1, Number.isFinite(Number(pageSize)) ? Number(pageSize) : 20));
    const skip = (safePage - 1) * safePageSize;
    const where = { userId, deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.groupBuyRebateLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safePageSize,
      }),
      this.prisma.groupBuyRebateLedger.count({ where }),
    ]);

    return {
      items: items.map((ledger) => this.mapLedger(ledger)),
      total,
      page: safePage,
      pageSize: safePageSize,
      nextPage: skip + safePageSize < total ? safePage + 1 : undefined,
    };
  }

  async listWithdrawals(userId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, Number.isFinite(Number(page)) ? Number(page) : 1);
    const safePageSize = Math.min(100, Math.max(1, Number.isFinite(Number(pageSize)) ? Number(pageSize) : 20));
    const skip = (safePage - 1) * safePageSize;
    const where = {
      userId,
      accountType: 'GROUP_BUY_REBATE',
      deletedAt: null,
    };

    const [items, total] = await Promise.all([
      (this.prisma.withdrawRequest as any).findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: safePageSize,
      }),
      (this.prisma.withdrawRequest as any).count({ where }),
    ]);

    return {
      items: items.map((withdraw: any) => ({
        id: withdraw.id,
        amount: withdraw.amount,
        netAmount: withdraw.netAmount,
        taxAmount: withdraw.taxAmount,
        channel: withdraw.channel,
        status: withdraw.status,
        createdAt: withdraw.createdAt.toISOString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
      nextPage: skip + safePageSize < total ? safePage + 1 : undefined,
    };
  }

  async createPendingReferralAfterPayment(
    tx: Prisma.TransactionClient,
    referralId: string,
    now = new Date(),
  ) {
    const referral = await tx.groupBuyReferral.findUnique({
      where: { id: referralId },
      include: this.referralInclude(),
    });
    if (!referral) {
      return { status: 'NOT_FOUND' };
    }

    const instance = referral.instance as any;
    const rebateSourceInstance = this.getRebateSourceInstance(referral);
    const candidateSequence = Number((referral as any).candidateSequence);
    const tier = this.findTierByCandidateSequence(
      this.normalizeTierSnapshot(rebateSourceInstance.tierSnapshot),
      candidateSequence,
    );
    if (!tier) {
      return { status: 'NO_TIER', candidateSequence };
    }

    const amount = this.roundMoney(
      Number(rebateSourceInstance.priceSnapshot) * tier.basisPoints / 10000,
    );
    const idempotencyKey = `GROUP_BUY_PENDING_REBATE:${referral.id}`;
    const existingLedger = await tx.groupBuyRebateLedger.findUnique({
      where: { idempotencyKey },
    });
    if (existingLedger) {
      return {
        status: 'PENDING_EXISTS',
        candidateSequence,
        amount: Number(existingLedger.amount ?? amount),
      };
    }

    const account = await this.getOrCreateAccount(tx, instance.userId);

    const balance = this.roundMoney(Number(account.balance ?? 0));
    await tx.groupBuyRebateLedger.create({
      data: {
        accountId: account.id,
        userId: instance.userId,
        instanceId: instance.id,
        referralId: referral.id,
        orderId: (referral as any).referredOrderId,
        type: 'PENDING_REBATE',
        status: 'PENDING',
        amount,
        balanceBefore: balance,
        balanceAfter: balance,
        idempotencyKey,
        refType: 'GROUP_BUY_REFERRAL',
        refId: referral.id,
        meta: {
          candidateSequence,
          tierBasisPoints: tier.basisPoints,
          priceSnapshot: Number(rebateSourceInstance.priceSnapshot),
          referredOrderId: (referral as any).referredOrderId,
          referredInstanceId: (referral as any).referredInstanceId,
          source: 'REFERRED_PAYMENT',
          createdAt: now.toISOString(),
        },
      },
    });

    return {
      status: 'PENDING_CREATED',
      candidateSequence,
      amount,
    };
  }

  private async releaseReferralInTransaction(
    tx: Prisma.TransactionClient,
    where: { id: string } | { referredOrderId: string },
    now: Date,
  ) {
    const referral = 'id' in where
      ? await tx.groupBuyReferral.findUnique({
        where: { id: where.id },
        include: this.referralInclude(),
      })
      : await tx.groupBuyReferral.findFirst({
        where: { referredOrderId: where.referredOrderId },
        include: this.referralInclude(),
      });

    if (!referral) {
      return { status: 'NOT_FOUND' };
    }

    if (referral.status === 'VALID') {
      return {
        status: 'ALREADY_VALID',
        effectiveSequence: referral.effectiveSequence,
        amount: referral.amountSnapshot,
      };
    }
    if (referral.status !== 'CANDIDATE') {
      return { status: 'SKIPPED' };
    }

    const instance = referral.instance as any;
    if (this.hasActivityEnded(instance.activity, now)) {
      return this.invalidateCandidate(
        tx,
        referral.id,
        instance.id,
        'ACTIVITY_ENDED',
        now,
      );
    }

    if (instance.status === 'TERMINATED') {
      return this.invalidateCandidate(
        tx,
        referral.id,
        instance.id,
        'USER_TERMINATED',
        now,
      );
    }

    if (instance.status !== 'SHARING') {
      return this.invalidateCandidate(
        tx,
        referral.id,
        instance.id,
        'INSTANCE_NOT_ELIGIBLE',
        now,
      );
    }

    const order = referral.referredOrder as any;
    if (this.hasAnyAfterSaleOrRefund(order)) {
      return this.invalidateCandidate(
        tx,
        referral.id,
        instance.id,
        'REFERRED_ORDER_AFTER_SALE_OR_REFUND',
        now,
      );
    }

    if (order.status !== 'RECEIVED') {
      return { status: 'WAITING_RECEIVE' };
    }

    const rebateSourceInstance = this.getRebateSourceInstance(referral);
    const referrerTiers = this.normalizeTierSnapshot(instance.tierSnapshot);
    const rebateSourceTiers = this.normalizeTierSnapshot(rebateSourceInstance.tierSnapshot);
    const effectiveSequence = Number((referral as any).candidateSequence);
    if (!Number.isInteger(effectiveSequence) || effectiveSequence <= 0) {
      return this.invalidateCandidate(
        tx,
        referral.id,
        instance.id,
        'REFERRAL_SEQUENCE_INVALID',
        now,
      );
    }

    const validCountBefore = await tx.groupBuyReferral.count({
      where: {
        instanceId: instance.id,
        status: 'VALID',
      },
    });
    const referrerTier = this.findTierByCandidateSequence(referrerTiers, effectiveSequence);
    if (!referrerTier) {
      return this.invalidateCandidate(
        tx,
        referral.id,
        instance.id,
        'NO_REMAINING_TIER',
        now,
      );
    }
    const tier = this.findTierByCandidateSequence(rebateSourceTiers, effectiveSequence);
    if (!tier) {
      return this.invalidateCandidate(
        tx,
        referral.id,
        instance.id,
        'NO_REMAINING_TIER',
        now,
      );
    }

    const amount = this.roundMoney(
      Number(rebateSourceInstance.priceSnapshot) * tier.basisPoints / 10000,
    );
    const pendingIdempotencyKey = `GROUP_BUY_PENDING_REBATE:${referral.id}`;
    const releaseIdempotencyKey = `GROUP_BUY_RELEASE_REBATE:${referral.id}`;
    const existingLedger = await tx.groupBuyRebateLedger.findUnique({
      where: { idempotencyKey: releaseIdempotencyKey },
    });
    if (existingLedger) {
      return {
        status: 'ALREADY_RELEASED',
        effectiveSequence,
        amount,
      };
    }

    const account = await this.getOrCreateAccount(tx, instance.userId);

    const balanceBefore = Number(account.balance ?? 0);
    const balanceAfter = this.roundMoney(balanceBefore + amount);

    const pendingLedger = await tx.groupBuyRebateLedger.findUnique({
      where: { idempotencyKey: pendingIdempotencyKey },
    });
    if (pendingLedger?.status === 'PENDING') {
      await tx.groupBuyRebateLedger.update({
        where: { idempotencyKey: pendingIdempotencyKey },
        data: { status: 'COMPLETED' },
      });
    }

    await tx.groupBuyRebateLedger.create({
      data: {
        accountId: account.id,
        userId: instance.userId,
        instanceId: instance.id,
        referralId: referral.id,
        orderId: order.id,
        type: 'RELEASE',
        status: 'AVAILABLE',
        amount,
        balanceBefore,
        balanceAfter,
        idempotencyKey: releaseIdempotencyKey,
        refType: 'GROUP_BUY_REFERRAL',
        refId: referral.id,
        meta: {
          candidateSequence: effectiveSequence,
          tierSequence: effectiveSequence,
          tierBasisPoints: tier.basisPoints,
          priceSnapshot: Number(rebateSourceInstance.priceSnapshot),
          pendingLedgerId: pendingLedger?.id ?? null,
        },
      },
    });
    await tx.groupBuyRebateAccount.update({
      where: { id: account.id },
      data: { balance: { increment: amount } },
    });
    await tx.groupBuyReferral.update({
      where: { id: referral.id },
      data: {
        status: 'VALID',
        effectiveSequence,
        amountSnapshot: amount,
        validAt: now,
        invalidReason: null,
        invalidatedAt: null,
      },
    });
    const pendingCandidateCount = await tx.groupBuyReferral.count({
      where: {
        instanceId: instance.id,
        status: 'CANDIDATE',
      },
    });
    await tx.groupBuyInstance.update({
      where: { id: instance.id },
      data: {
        validReferralCount: { increment: 1 },
        candidateCount: pendingCandidateCount,
      },
    });

    const validCountAfter = validCountBefore + 1;
    if (
      instance.status === 'SHARING'
      && validCountAfter >= referrerTiers.length
      && pendingCandidateCount === 0
    ) {
      await tx.groupBuyInstance.update({
        where: { id: instance.id },
        data: {
          status: 'COMPLETED',
          completedAt: now,
        },
      });
      if (instance.code?.id) {
        await tx.groupBuyCode.update({
          where: { id: instance.code.id },
          data: {
            status: 'COMPLETED',
            completedAt: now,
          },
        });
      }
    }

    return {
      status: 'RELEASED',
      effectiveSequence,
      amount,
    };
  }

  private referralInclude() {
    return {
      instance: {
        include: {
          code: true,
          activity: {
            select: {
              id: true,
              status: true,
              endAt: true,
              deletedAt: true,
            },
          },
        },
      },
      referredOrder: {
        select: {
          id: true,
          status: true,
          returnWindowExpiresAt: true,
          afterSaleRequests: { select: { id: true }, take: 1 },
          refunds: { select: { id: true }, take: 1 },
        },
      },
      referredInstance: {
        select: {
          id: true,
          priceSnapshot: true,
          tierSnapshot: true,
        },
      },
    };
  }

  private mapAccount(account: any) {
    const balance = this.roundMoney(Number(account?.balance ?? 0));
    const reserved = this.roundMoney(Number(account?.reserved ?? 0));
    const withdrawn = this.roundMoney(Number(account?.withdrawn ?? 0));
    const deducted = this.roundMoney(Number(account?.deducted ?? 0));
    return {
      balance,
      reserved,
      withdrawn,
      deducted,
      available: this.roundMoney(Math.max(0, balance - reserved)),
      total: this.roundMoney(balance + reserved + withdrawn + deducted),
    };
  }

  private mapLedger(ledger: any) {
    return {
      id: ledger.id,
      type: ledger.type,
      status: ledger.status,
      amount: Number(ledger.amount ?? 0),
      balanceBefore: Number(ledger.balanceBefore ?? 0),
      balanceAfter: Number(ledger.balanceAfter ?? 0),
      instanceId: ledger.instanceId ?? null,
      referralId: ledger.referralId ?? null,
      orderId: ledger.orderId ?? null,
      refType: ledger.refType ?? null,
      refId: ledger.refId ?? null,
      meta: ledger.meta ?? null,
      createdAt: ledger.createdAt instanceof Date
        ? ledger.createdAt.toISOString()
        : ledger.createdAt,
    };
  }

  private hasAnyAfterSaleOrRefund(order: any) {
    return order.status === 'REFUNDED'
      || order.status === 'CANCELED'
      || (order.afterSaleRequests?.length ?? 0) > 0
      || (order.refunds?.length ?? 0) > 0;
  }

  private async invalidateCandidate(
    tx: Prisma.TransactionClient,
    referralId: string,
    instanceId: string,
    reason: string,
    now: Date,
  ) {
    const pendingIdempotencyKey = `GROUP_BUY_PENDING_REBATE:${referralId}`;
    const pendingLedger = await tx.groupBuyRebateLedger.findUnique({
      where: { idempotencyKey: pendingIdempotencyKey },
    });
    if (pendingLedger?.status === 'PENDING') {
      await tx.groupBuyRebateLedger.update({
        where: { idempotencyKey: pendingIdempotencyKey },
        data: { status: 'VOIDED' },
      });
    }
    await tx.groupBuyReferral.update({
      where: { id: referralId },
      data: {
        status: 'INVALID',
        invalidReason: reason,
        invalidatedAt: now,
      },
    });
    await tx.groupBuyInstance.update({
      where: { id: instanceId },
      data: { candidateCount: { decrement: 1 } },
    });
    return { status: 'INVALIDATED', reason };
  }

  private normalizeTierSnapshot(raw: unknown) {
    if (!Array.isArray(raw)) {
      throw new InternalServerErrorException('团购档位快照异常');
    }
    const tiers = raw
      .map((item: any) => ({
        sequence: Number(item?.sequence),
        basisPoints: Number(item?.basisPoints),
        label: item?.label ?? null,
      }))
      .filter((item) =>
        Number.isInteger(item.sequence)
        && item.sequence > 0
        && Number.isInteger(item.basisPoints)
        && item.basisPoints > 0,
      )
      .sort((a, b) => a.sequence - b.sequence);
    if (tiers.length === 0) {
      throw new InternalServerErrorException('团购档位快照异常');
    }
    return tiers;
  }

  private hasActivityEnded(activity: any, now: Date) {
    if (!activity) return true;
    return activity.status === GroupBuyActivityStatus.ENDED
      || Boolean(activity.deletedAt)
      || !activity.endAt
      || activity.endAt <= now;
  }

  private findTierByCandidateSequence(
    tiers: Array<{ sequence: number; basisPoints: number; label: any }>,
    candidateSequence: number,
  ) {
    if (!Number.isInteger(candidateSequence) || candidateSequence <= 0) {
      return null;
    }
    return tiers[candidateSequence - 1]
      ?? tiers.find((item) => item.sequence === candidateSequence)
      ?? null;
  }

  private getRebateSourceInstance(referral: any) {
    return referral.referredInstance ?? referral.instance;
  }

  private async getOrCreateAccount(tx: Prisma.TransactionClient, userId: string) {
    return tx.groupBuyRebateAccount.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        balance: 0,
      },
    });
  }

  private roundMoney(value: number) {
    return Math.round(value * 100) / 100;
  }

  private mergeLedgerMeta(
    meta: unknown,
    patch: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      return { ...(meta as Record<string, unknown>), ...patch } as Prisma.InputJsonObject;
    }
    return patch as Prisma.InputJsonObject;
  }

  private async runSerializableWithRetry<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(action, this.serializableTransactionOptions);
      } catch (error: any) {
        if (error?.code === 'P2034' && attempt < maxRetries - 1) {
          continue;
        }
        throw error;
      }
    }
    throw new InternalServerErrorException('团购返还释放失败');
  }
}
