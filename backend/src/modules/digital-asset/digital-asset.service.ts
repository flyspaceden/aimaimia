import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  allocateOrderAssetAmount,
  calculateOrderAssetAmount,
  calculateRefundProductAmount,
  clampReversalAmount,
  roundMoney,
} from './digital-asset-ledger-calculator';

type LedgerDirection = 'CREDIT' | 'DEBIT';
type CreditSource = 'ORDER_RECEIVED' | 'BACKFILL';

const SERIALIZABLE_MAX_RETRIES = 3;

@Injectable()
export class DigitalAssetService {
  private readonly logger = new Logger(DigitalAssetService.name);

  constructor(private readonly prisma: PrismaService) {}

  async creditOrderReceived(orderId: string, source: CreditSource): Promise<void> {
    const idempotencyKey = `order:${orderId}:cumulative-spend-credit`;
    await this.withSerializableRetry(async (tx) => {
      const existing = await tx.digitalAssetLedger.findUnique({ where: { idempotencyKey } });
      if (existing) return;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('订单不存在');

      const hasReceivedFact = Boolean((order as any).receivedAt) || order.status === 'RECEIVED';
      if (!hasReceivedFact) {
        if (source === 'BACKFILL') {
          this.logger.warn(`跳过无收货事实订单数字资产回填: orderId=${orderId}`);
          return;
        }
        throw new BadRequestException('订单尚未确认收货，不能累计数字资产');
      }

      const amount = calculateOrderAssetAmount(order as any);
      if (amount <= 0) return;

      const account = await this.findOrCreateAccount(tx, order.userId);
      const allocationResult = allocateOrderAssetAmount({
        orderAssetAmount: amount,
        items: (order.items ?? []).map((item: any) => ({
          orderItemId: item.id,
          skuId: item.skuId ?? null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          isPrize: Boolean(item.isPrize),
          createdAt: item.createdAt,
        })),
      });
      const balanceAfter = roundMoney(account.cumulativeSpendAmount + amount);

      await tx.digitalAssetLedger.create({
        data: {
          accountId: account.id,
          userId: order.userId,
          type: source,
          direction: 'CREDIT',
          amount,
          balanceAfter,
          orderId,
          idempotencyKey,
          meta: {
            itemAllocations: allocationResult.allocations,
            residualOrderItemId: allocationResult.residualOrderItemId,
            source,
          },
        },
      });
      await tx.digitalAssetAccount.update({
        where: { id: account.id },
        data: { cumulativeSpendAmount: balanceAfter },
      });
    });
  }

  async reverseRefund(refundId: string): Promise<void> {
    await this.withSerializableRetry(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        include: { items: true },
      });
      if (!refund) throw new NotFoundException('退款单不存在');

      const afterSale = refund.afterSaleId
        ? await tx.afterSaleRequest.findUnique({
          where: { id: refund.afterSaleId },
          include: { shippingPayment: true },
        })
        : await tx.afterSaleRequest.findFirst({
          where: { refundId },
          include: { shippingPayment: true },
        });
      const afterSaleId = refund.afterSaleId ?? afterSale?.id ?? null;

      if (afterSaleId) {
        const fallbackKey = `after-sale:${afterSaleId}:cumulative-spend-reversal`;
        const fallbackLedger = await tx.digitalAssetLedger.findUnique({
          where: { idempotencyKey: fallbackKey },
        });
        if (fallbackLedger) {
          await tx.digitalAssetLedger.update({
            where: { id: fallbackLedger.id },
            data: {
              refundId,
              meta: {
                ...((fallbackLedger as any).meta ?? {}),
                linkedRefundId: refundId,
              },
            },
          });
          return;
        }
      }

      await this.writeRefundReversal(tx, {
        idempotencyKey: `refund:${refundId}:cumulative-spend-reversal`,
        refund,
        refundId,
        afterSale,
        afterSaleId,
      });
    });
  }

  async reverseAfterSale(afterSaleId: string): Promise<void> {
    const afterSale: any = await this.withSerializableRetry((tx) =>
      tx.afterSaleRequest.findUnique({
        where: { id: afterSaleId },
        include: { shippingPayment: true },
      }),
    );
    if (!afterSale) throw new NotFoundException('售后单不存在');
    if (afterSale.refundId) {
      await this.reverseRefund(afterSale.refundId);
      return;
    }

    await this.withSerializableRetry(async (tx) => {
      const currentAfterSale = await tx.afterSaleRequest.findUnique({
        where: { id: afterSaleId },
        include: { shippingPayment: true },
      });
      if (!currentAfterSale) throw new NotFoundException('售后单不存在');
      await this.writeRefundReversal(tx, {
        idempotencyKey: `after-sale:${afterSaleId}:cumulative-spend-reversal`,
        refund: null,
        refundId: null,
        afterSale: currentAfterSale,
        afterSaleId,
      });
    });
  }

  async adjustByAdmin(params: {
    targetUserId: string;
    adminUserId: string;
    amount: number;
    direction: LedgerDirection;
    reason: string;
    clientIdempotencyKey?: string;
  }): Promise<void> {
    const amount = roundMoney(params.amount);
    if (amount <= 0) throw new BadRequestException('调整金额必须大于 0');
    const idempotencyKey = params.clientIdempotencyKey
      ? `admin-adjust-client:${params.clientIdempotencyKey}`
      : `admin-adjust:${params.adminUserId}:${params.targetUserId}:${randomUUID()}`;

    await this.withSerializableRetry(async (tx) => {
      const existing = await tx.digitalAssetLedger.findUnique({ where: { idempotencyKey } });
      if (existing) return;

      const account = await this.findOrCreateAccount(tx, params.targetUserId);
      const delta = params.direction === 'CREDIT' ? amount : -amount;
      const balanceAfter = roundMoney(account.cumulativeSpendAmount + delta);
      if (balanceAfter < 0) throw new BadRequestException('数字资产累计消费不能扣成负数');

      await tx.digitalAssetLedger.create({
        data: {
          accountId: account.id,
          userId: params.targetUserId,
          type: 'ADMIN_ADJUSTMENT',
          direction: params.direction,
          amount,
          balanceAfter,
          adminUserId: params.adminUserId,
          reason: params.reason,
          idempotencyKey,
          meta: {
            clientIdempotencyKey: params.clientIdempotencyKey ?? null,
          },
        },
      });
      await tx.digitalAssetAccount.update({
        where: { id: account.id },
        data: { cumulativeSpendAmount: balanceAfter },
      });
    });
  }

  async getSummary(userId: string) {
    const account = await (this.prisma as any).digitalAssetAccount.findUnique({
      where: { userId },
    });
    return {
      cumulativeSpendAmount: account?.cumulativeSpendAmount ?? 0,
      modules: [
        { key: 'assetValue', title: '资产价值', status: 'COMING_SOON', description: '规则待公布' },
        { key: 'level', title: '资产等级', status: 'COMING_SOON', description: '待开放' },
        { key: 'benefits', title: '权益兑换', status: 'COMING_SOON', description: '待开放' },
        { key: 'equity', title: '工资/期权/股权', status: 'COMING_SOON', description: '规则待公布' },
      ],
    };
  }

  async listLedgers(userId: string, query: { page?: number; pageSize?: number; type?: string }) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where: any = { userId };
    if (query.type) where.type = query.type;

    const [items, total] = await Promise.all([
      (this.prisma as any).digitalAssetLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      (this.prisma as any).digitalAssetLedger.count({ where }),
    ]);

    return {
      items: items.map((ledger: any) => ({
        id: ledger.id,
        type: ledger.type,
        direction: ledger.direction,
        amount: ledger.amount,
        balanceAfter: ledger.balanceAfter,
        title: this.getLedgerTitle(ledger),
        description: ledger.reason ?? undefined,
        orderId: ledger.orderId ?? undefined,
        createdAt: ledger.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  private async writeRefundReversal(tx: any, params: {
    idempotencyKey: string;
    refund: any | null;
    refundId: string | null;
    afterSale: any | null;
    afterSaleId: string | null;
  }) {
    const existing = await tx.digitalAssetLedger.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return;

    const orderId = params.refund?.orderId ?? params.afterSale?.orderId;
    if (!orderId) return;

    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return;

    const account = await tx.digitalAssetAccount.findUnique({ where: { userId: order.userId } });
    if (!account) return;

    const creditLedgers = await tx.digitalAssetLedger.findMany({
      where: { orderId, direction: 'CREDIT' },
    });
    const itemAllocations = creditLedgers
      .flatMap((ledger: any) => (ledger.meta?.itemAllocations ?? []) as any[]);
    if (itemAllocations.length === 0) return;

    const debitLedgers = await tx.digitalAssetLedger.findMany({
      where: { orderId, direction: 'DEBIT' },
    });
    const alreadyReversedByItem = new Map<string, number>();
    for (const ledger of debitLedgers) {
      for (const item of ledger.meta?.reversedItems ?? []) {
        alreadyReversedByItem.set(
          item.orderItemId,
          roundMoney((alreadyReversedByItem.get(item.orderItemId) ?? 0) + item.reversedAmount),
        );
      }
    }
    const orderRemainingAmount = roundMoney(
      itemAllocations.reduce((sum: number, item: any) => sum + item.assetAmount, 0)
        - Array.from(alreadyReversedByItem.values()).reduce((sum, value) => sum + value, 0),
    );
    if (orderRemainingAmount <= 0) return;

    const reversedItems = this.calculateReversedItems({
      refund: params.refund,
      afterSale: params.afterSale,
      itemAllocations,
      alreadyReversedByItem,
      orderRemainingAmount,
    });
    const amount = roundMoney(reversedItems.reduce((sum, item) => sum + item.reversedAmount, 0));
    if (amount <= 0) return;

    const balanceAfter = roundMoney(account.cumulativeSpendAmount - amount);
    if (balanceAfter < 0) throw new BadRequestException('数字资产累计消费不能扣成负数');

    await tx.digitalAssetLedger.create({
      data: {
        accountId: account.id,
        userId: order.userId,
        type: 'REFUND_REVERSAL',
        direction: 'DEBIT',
        amount,
        balanceAfter,
        orderId,
        refundId: params.refundId,
        afterSaleId: params.afterSaleId,
        idempotencyKey: params.idempotencyKey,
        meta: {
          reversedItems,
        },
      },
    });
    await tx.digitalAssetAccount.update({
      where: { id: account.id },
      data: { cumulativeSpendAmount: balanceAfter },
    });
  }

  private calculateReversedItems(params: {
    refund: any | null;
    afterSale: any | null;
    itemAllocations: any[];
    alreadyReversedByItem: Map<string, number>;
    orderRemainingAmount: number;
  }) {
    const { refund, afterSale, itemAllocations, alreadyReversedByItem } = params;
    const byItemId = new Map(itemAllocations.map((item) => [item.orderItemId, item]));
    const refundItems = refund?.items ?? [];

    if (refundItems.length > 0) {
      let orderRemaining = params.orderRemainingAmount;
      const reversedItems = [];
      for (const refundItem of refundItems) {
        const allocation = byItemId.get(refundItem.orderItemId);
        if (!allocation) continue;
        const alreadyReversedAmount = alreadyReversedByItem.get(refundItem.orderItemId) ?? 0;
        const lineRemaining = roundMoney(allocation.assetAmount - alreadyReversedAmount);
        const reversedAmount = clampReversalAmount({
          requestedAmount: refundItem.amount,
          lineRemainingAmount: lineRemaining,
          orderRemainingAmount: orderRemaining,
        });
        if (reversedAmount <= 0) continue;
        orderRemaining = roundMoney(orderRemaining - reversedAmount);
        reversedItems.push({
          orderItemId: refundItem.orderItemId,
          quantity: refundItem.quantity,
          originalAssetAmount: allocation.assetAmount,
          alreadyReversedAmount,
          reversedAmount,
        });
      }
      return reversedItems;
    }

    if (afterSale?.orderItemId) {
      const allocation = byItemId.get(afterSale.orderItemId);
      if (!allocation) return [];
      const alreadyReversedAmount = alreadyReversedByItem.get(afterSale.orderItemId) ?? 0;
      const lineRemaining = roundMoney(allocation.assetAmount - alreadyReversedAmount);
      const shippingPaymentRefundAmount = afterSale.shippingPayment?.status === 'REFUNDED'
        ? afterSale.shippingPayment.amount
        : 0;
      const requestedAmount = calculateRefundProductAmount({
        refundAmount: afterSale.refundAmount ?? refund?.amount ?? 0,
        returnShippingFee: afterSale.returnShippingFee,
        shippingPaymentRefundAmount,
      });
      const reversedAmount = clampReversalAmount({
        requestedAmount,
        lineRemainingAmount: lineRemaining,
        orderRemainingAmount: params.orderRemainingAmount,
      });
      if (reversedAmount <= 0) return [];
      return [{
        orderItemId: afterSale.orderItemId,
        quantity: afterSale.orderItem?.quantity ?? 1,
        originalAssetAmount: allocation.assetAmount,
        alreadyReversedAmount,
        reversedAmount,
      }];
    }

    let orderRemaining = params.orderRemainingAmount;
    const rawRefundAmount = afterSale?.refundAmount ?? refund?.amount;
    const requestedAmount = calculateRefundProductAmount({
      refundAmount: rawRefundAmount ?? orderRemaining,
      returnShippingFee: afterSale?.returnShippingFee,
      shippingPaymentRefundAmount: afterSale?.shippingPayment?.status === 'REFUNDED'
        ? afterSale.shippingPayment.amount
        : 0,
    });
    if (requestedAmount <= 0) return [];

    let remainingRequested = requestedAmount;
    const reversedItems = [];
    for (const allocation of itemAllocations) {
      const alreadyReversedAmount = alreadyReversedByItem.get(allocation.orderItemId) ?? 0;
      const lineRemaining = roundMoney(allocation.assetAmount - alreadyReversedAmount);
      const reversedAmount = clampReversalAmount({
        requestedAmount: remainingRequested,
        lineRemainingAmount: lineRemaining,
        orderRemainingAmount: orderRemaining,
      });
      if (reversedAmount <= 0) continue;
      orderRemaining = roundMoney(orderRemaining - reversedAmount);
      remainingRequested = roundMoney(remainingRequested - reversedAmount);
      reversedItems.push({
        orderItemId: allocation.orderItemId,
        quantity: allocation.quantity,
        originalAssetAmount: allocation.assetAmount,
        alreadyReversedAmount,
        reversedAmount,
      });
      if (orderRemaining <= 0 || remainingRequested <= 0) break;
    }
    return reversedItems;
  }

  private async findOrCreateAccount(tx: any, userId: string) {
    const existing = await tx.digitalAssetAccount.findUnique({ where: { userId } });
    if (existing) return existing;
    return tx.digitalAssetAccount.create({
      data: {
        userId,
        cumulativeSpendAmount: 0,
      },
    });
  }

  private getLedgerTitle(ledger: any): string {
    if (ledger.type === 'REFUND_REVERSAL') return '退款扣回';
    if (ledger.type === 'ADMIN_ADJUSTMENT') return ledger.direction === 'CREDIT' ? '后台增加' : '后台扣减';
    if (ledger.type === 'BACKFILL') return '历史订单入账';
    return '确认收货入账';
  }

  private async withSerializableRetry<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_MAX_RETRIES; attempt++) {
      try {
        return await (this.prisma as any).$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < SERIALIZABLE_MAX_RETRIES - 1) continue;
        throw err;
      }
    }
    throw new Error('unreachable serializable retry state');
  }
}
