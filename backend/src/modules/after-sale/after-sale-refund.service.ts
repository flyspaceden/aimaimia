import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AfterSaleType,
  AfterSaleOperatorType,
  AfterSaleStatus,
  InventoryType,
  Prisma,
  Refund,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { AfterSaleRewardService } from './after-sale-reward.service';
import { AfterSaleStatusHistoryService } from './after-sale-status-history.service';
import { InboxService } from '../inbox/inbox.service';
import { sanitizeStringForLog } from '../../common/logging/log-sanitizer';

type Operator = { type: AfterSaleOperatorType; id?: string };
type Tx = Prisma.TransactionClient;
type StartRefundLease = {
  refund: Refund;
  amount: number;
  orderId: string;
  merchantRefundNo: string;
  shouldInitiate: boolean;
  shouldCloseSuccess?: boolean;
};

@Injectable()
export class AfterSaleRefundService {
  private readonly logger = new Logger(AfterSaleRefundService.name);

  constructor(
    private prisma: PrismaService,
    private paymentService: PaymentService,
    private afterSaleRewardService: AfterSaleRewardService,
    private statusHistory: AfterSaleStatusHistoryService,
    private inboxService: InboxService,
  ) {}

  async createOrGetRefund(afterSaleId: string): Promise<Refund> {
    return this.prisma.$transaction(
      async (tx) => {
        const { refund } = await this.createOrGetRefundInTx(tx, afterSaleId);
        await tx.afterSaleRequest.update({
          where: { id: afterSaleId },
          data: { refundId: refund.id },
        });
        return refund;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async startRefund(afterSaleId: string, operator: Operator): Promise<Refund> {
    const {
      refund,
      amount,
      orderId,
      merchantRefundNo,
      shouldInitiate,
      shouldCloseSuccess,
    } = await this.prisma.$transaction(
      async (tx): Promise<StartRefundLease> => {
        const created = await this.createOrGetRefundInTx(tx, afterSaleId);
        const { request, refund } = created;
        const fromStatus = request.status;
        let acquiredProviderLease = false;

        if (refund.status === 'REFUNDED') {
          return {
            refund,
            amount: request.refundAmount || 0,
            orderId: request.orderId,
            merchantRefundNo: created.merchantRefundNo,
            shouldInitiate: false,
            shouldCloseSuccess: true,
          };
        }

        if (created.wasCreated) {
          acquiredProviderLease = true;
          await tx.refundStatusHistory.create({
            data: {
              refundId: refund.id,
              fromStatus: null,
              toStatus: 'REFUNDING',
              remark: '售后退款发起',
              operatorId: operator.id ?? operator.type,
            },
          });
        } else if (refund.status === 'FAILED') {
          const retryLease = await this.acquireProviderRetryLeaseInTx(
            tx,
            refund,
            operator.id ?? operator.type,
            '售后退款重试开始',
          );
          acquiredProviderLease = retryLease.acquired;
        }

        await tx.afterSaleRequest.update({
          where: { id: afterSaleId },
          data: {
            status: 'REFUNDING',
            refundId: refund.id,
          },
        });

        if (fromStatus !== 'REFUNDING') {
          await this.statusHistory.create(tx, {
            afterSaleId,
            fromStatus,
            toStatus: 'REFUNDING',
            reason: '售后退款发起',
            operatorType: operator.type,
            operatorId: operator.id,
            meta: { refundId: refund.id, merchantRefundNo: created.merchantRefundNo },
          });
        }

        return {
          refund,
          amount: request.refundAmount || 0,
          orderId: request.orderId,
          merchantRefundNo: created.merchantRefundNo,
          shouldInitiate: acquiredProviderLease,
          shouldCloseSuccess: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!shouldInitiate) {
      if (shouldCloseSuccess) {
        await this.handleRefundSuccess(refund.id, refund.providerRefundId ?? null);
      }
      return refund;
    }

    let result: { success: boolean; providerRefundId?: string; message: string };
    try {
      result = await this.paymentService.initiateRefund(
        orderId,
        amount,
        merchantRefundNo,
      );
    } catch (err: any) {
      const msg = sanitizeStringForLog(err?.message || 'UNKNOWN', { maxStringLength: 256 });
      await this.handleRefundFailure(refund.id, `售后退款发起异常: ${msg}`);
      this.logger.error(
        `售后退款发起异常: afterSaleId=${afterSaleId}, refundId=${refund.id}, error=${msg}`,
      );
      return refund;
    }

    if (result.success) {
      await this.handleRefundSuccess(refund.id, result.providerRefundId || null);
    } else {
      await this.handleRefundFailure(refund.id, result.message);
    }

    return refund;
  }

  async handleRefundSuccess(
    refundId: string,
    providerRefundId?: string | null,
  ): Promise<void> {
    const completed = await this.prisma.$transaction(
      async (tx) => {
        const refund = await tx.refund.findUnique({ where: { id: refundId } });
        if (!refund) throw new NotFoundException('退款单不存在');
        if (!refund.afterSaleId) {
          throw new BadRequestException('退款单未关联售后申请');
        }

        const request = await tx.afterSaleRequest.findUnique({
          where: { id: refund.afterSaleId },
          include: {
            orderItem: {
              select: {
                skuId: true,
                quantity: true,
                isPrize: true,
              },
            },
          },
        });
        if (!request) throw new NotFoundException('售后单不存在');

        if (refund.status !== 'REFUNDED') {
          await tx.refund.update({
            where: { id: refundId },
            data: {
              status: 'REFUNDED',
              providerRefundId: providerRefundId ?? refund.providerRefundId ?? undefined,
            },
          });
          await tx.refundStatusHistory.create({
            data: {
              refundId,
              fromStatus: refund.status,
              toStatus: 'REFUNDED',
              remark: '售后退款成功',
              operatorId: 'AFTER_SALE_REFUND_SERVICE',
            },
          });
        }

        if (request.status !== 'REFUNDED') {
          await tx.afterSaleRequest.update({
            where: { id: request.id },
            data: {
              status: 'REFUNDED',
              refundId,
            },
          });
          await this.statusHistory.create(tx, {
            afterSaleId: request.id,
            fromStatus: request.status,
            toStatus: 'REFUNDED',
            reason: '退款到账',
            operatorType: AfterSaleOperatorType.SYSTEM,
            meta: { refundId, providerRefundId: providerRefundId ?? null },
          });

          const shouldRestockReturnedItem =
            request.requiresReturn &&
            (
              request.afterSaleType === AfterSaleType.NO_REASON_RETURN ||
              request.afterSaleType === AfterSaleType.QUALITY_RETURN
            ) &&
            request.orderItem &&
            !request.orderItem.isPrize &&
            Boolean(request.orderItem.skuId) &&
            request.orderItem.quantity > 0;

          if (shouldRestockReturnedItem && request.orderItem) {
            const restockLedger = await tx.inventoryLedger.createMany({
              data: [{
                skuId: request.orderItem.skuId,
                type: InventoryType.RELEASE,
                qty: request.orderItem.quantity,
                refType: 'AFTER_SALE',
                refId: request.id,
              }],
              skipDuplicates: true,
            });

            if (restockLedger.count === 1) {
              await tx.productSKU.update({
                where: { id: request.orderItem.skuId },
                data: { stock: { increment: request.orderItem.quantity } },
              });
            }
          }

          return {
            orderId: request.orderId,
            userId: request.userId,
            amount: refund.amount,
          };
        }

        return null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!completed) return;

    await this.afterSaleRewardService.voidRewardsForOrder(completed.orderId);
    await this.afterSaleRewardService.checkAndMarkOrderRefunded(completed.orderId);
    await this.inboxService.send({
      userId: completed.userId,
      category: 'transaction',
      type: 'refund_credited',
      title: '退款已到账',
      content: `您的退款 ${completed.amount.toFixed(2)} 元已原路退回支付宝账户。`,
      target: { route: '/orders' },
    }).catch(() => {});
  }

  async handleRefundFailure(refundId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const refund = await tx.refund.findUnique({ where: { id: refundId } });
        if (!refund) throw new NotFoundException('退款单不存在');
        if (refund.status === 'FAILED' || refund.status === 'REFUNDED') return;

        const updated = await tx.refund.updateMany({
          where: { id: refundId, status: 'REFUNDING' },
          data: { status: 'FAILED' },
        });
        if (updated.count === 0) return;
        await tx.refundStatusHistory.create({
          data: {
            refundId,
            fromStatus: refund.status,
            toStatus: 'FAILED',
            remark: sanitizeStringForLog(reason, { maxStringLength: 256 }),
            operatorId: 'AFTER_SALE_REFUND_SERVICE',
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async retryRefund(refundId: string, operator: Operator): Promise<Refund> {
    const lease = await this.prisma.$transaction(
      async (tx) => {
        const refund = await tx.refund.findUnique({ where: { id: refundId } });
        if (!refund) throw new NotFoundException('退款单不存在');
        if (!['FAILED', 'REFUNDING'].includes(refund.status)) {
          throw new BadRequestException('当前退款状态不需要重试');
        }

        const retryLease = await this.acquireProviderRetryLeaseInTx(
          tx,
          refund,
          operator.id ?? operator.type,
          '管理员手动重试开始',
        );
        if (retryLease.blockedByRecent) {
          throw new BadRequestException('请勿频繁重试，请 30 秒后再试');
        }
        if (!retryLease.acquired) throw new BadRequestException('当前退款状态不需要重试');

        return {
          refund,
          fromStatus: refund.status,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const result = await this.paymentService.initiateRefund(
      lease.refund.orderId,
      lease.refund.amount,
      lease.refund.merchantRefundNo,
    );
    if (result.success) {
      await this.handleRefundSuccess(lease.refund.id, result.providerRefundId || null);
    } else {
      await this.handleRefundFailure(lease.refund.id, result.message);
    }
    return lease.refund;
  }

  private async acquireProviderRetryLeaseInTx(
    tx: Tx,
    refund: Pick<Refund, 'id' | 'status'>,
    operatorId: string,
    remark: string,
  ): Promise<{ acquired: boolean; blockedByRecent: boolean }> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('refund-retry'),
        hashtext(${refund.id})
      )
    `;

    const recentRetry = await tx.refundStatusHistory.findFirst({
      where: {
        refundId: refund.id,
        toStatus: 'REFUNDING',
        remark: { contains: '重试开始' },
        createdAt: { gte: new Date(Date.now() - 30_000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recentRetry) return { acquired: false, blockedByRecent: true };

    if (refund.status === 'FAILED') {
      const retryLease = await tx.refund.updateMany({
        where: { id: refund.id, status: 'FAILED' },
        data: { status: 'REFUNDING' },
      });
      if (retryLease.count === 0) return { acquired: false, blockedByRecent: false };
    } else if (refund.status !== 'REFUNDING') {
      return { acquired: false, blockedByRecent: false };
    }

    await tx.refundStatusHistory.create({
      data: {
        refundId: refund.id,
        fromStatus: refund.status,
        toStatus: 'REFUNDING',
        remark,
        operatorId,
      },
    });

    return { acquired: true, blockedByRecent: false };
  }

  private async createOrGetRefundInTx(tx: Tx, afterSaleId: string): Promise<{
    request: {
      id: string;
      orderId: string;
      userId: string;
      status: AfterSaleStatus;
      refundAmount: number | null;
      reason: string;
    };
    refund: Refund;
    merchantRefundNo: string;
    wasCreated: boolean;
  }> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('after-sale-refund-start'),
        hashtext(${afterSaleId})
      )
    `;

    const request = await tx.afterSaleRequest.findUnique({
      where: { id: afterSaleId },
      select: {
        id: true,
        orderId: true,
        userId: true,
        status: true,
        refundAmount: true,
        reason: true,
      },
    });
    if (!request) throw new NotFoundException('售后单不存在');
    if (!request.refundAmount || request.refundAmount <= 0) {
      throw new BadRequestException('退款金额无效');
    }

    const merchantRefundNo = `AS-${afterSaleId}`;
    const existingRefund = await tx.refund.findUnique({
      where: { merchantRefundNo },
    });
    const refund = await tx.refund.upsert({
      where: { merchantRefundNo },
      create: {
        orderId: request.orderId,
        afterSaleId,
        amount: request.refundAmount,
        status: 'REFUNDING',
        merchantRefundNo,
        reason: `售后退款: ${request.reason}`,
      },
      update: {
        afterSaleId,
        orderId: request.orderId,
        amount: request.refundAmount,
      },
    });

    if (refund.afterSaleId !== afterSaleId) {
      throw new BadRequestException('退款单售后关联不一致');
    }

    return { request, refund, merchantRefundNo, wasCreated: !existingRefund };
  }
}
