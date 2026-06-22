import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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
    if (!['SHARING', 'TERMINATED'].includes(instance.status)) {
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
    if (!order.returnWindowExpiresAt || order.returnWindowExpiresAt > now) {
      return { status: 'WAITING_RETURN_WINDOW' };
    }

    const tiers = this.normalizeTierSnapshot(instance.tierSnapshot);
    const validCount = await tx.groupBuyReferral.count({
      where: {
        instanceId: instance.id,
        status: 'VALID',
      },
    });
    const effectiveSequence = validCount + 1;
    const tier = tiers.find((item) => item.sequence === effectiveSequence);
    if (!tier) {
      return this.invalidateCandidate(
        tx,
        referral.id,
        instance.id,
        'NO_REMAINING_TIER',
        now,
      );
    }

    const amount = this.roundMoney(Number(instance.priceSnapshot) * tier.basisPoints / 10000);
    const idempotencyKey = `GROUP_BUY_REBATE:${referral.id}`;
    const existingLedger = await tx.groupBuyRebateLedger.findUnique({
      where: { idempotencyKey },
    });
    if (existingLedger) {
      return {
        status: 'ALREADY_RELEASED',
        effectiveSequence,
        amount,
      };
    }

    let account = await tx.groupBuyRebateAccount.findUnique({
      where: { userId: instance.userId },
    });
    if (!account) {
      account = await tx.groupBuyRebateAccount.create({
        data: {
          userId: instance.userId,
          balance: 0,
        },
      });
    }

    const balanceBefore = Number(account.balance ?? 0);
    const balanceAfter = this.roundMoney(balanceBefore + amount);

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
        idempotencyKey,
        refType: 'GROUP_BUY_REFERRAL',
        refId: referral.id,
        meta: {
          tierSequence: effectiveSequence,
          tierBasisPoints: tier.basisPoints,
          priceSnapshot: Number(instance.priceSnapshot),
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
    await tx.groupBuyInstance.update({
      where: { id: instance.id },
      data: { validReferralCount: { increment: 1 } },
    });

    if (instance.status === 'SHARING' && effectiveSequence >= tiers.length) {
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

  private roundMoney(value: number) {
    return Math.round(value * 100) / 100;
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
