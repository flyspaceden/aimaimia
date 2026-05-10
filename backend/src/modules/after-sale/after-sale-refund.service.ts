import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AfterSaleOperatorType,
  AfterSaleStatus,
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
    const { refund, amount, orderId, merchantRefundNo, shouldInitiate } = await this.prisma.$transaction(
      async (tx): Promise<StartRefundLease> => {
        const created = await this.createOrGetRefundInTx(tx, afterSaleId);
        const { request, refund } = created;
        const fromStatus = request.status;

        if (refund.status === 'REFUNDED') {
          await tx.afterSaleRequest.update({
            where: { id: afterSaleId },
            data: {
              status: 'REFUNDED',
              refundId: refund.id,
            },
          });
          return {
            refund,
            amount: request.refundAmount || 0,
            orderId: request.orderId,
            merchantRefundNo: created.merchantRefundNo,
            shouldInitiate: false,
          };
        }

        if (created.wasCreated) {
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
          await tx.refund.update({
            where: { id: refund.id },
            data: { status: 'REFUNDING' },
          });
          await tx.refundStatusHistory.create({
            data: {
              refundId: refund.id,
              fromStatus: 'FAILED',
              toStatus: 'REFUNDING',
              remark: '售后退款重新发起',
              operatorId: operator.id ?? operator.type,
            },
          });
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
          shouldInitiate: true,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!shouldInitiate) return refund;

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
        if (refund.status === 'REFUNDED') {
          return null;
        }
        if (!refund.afterSaleId) {
          throw new BadRequestException('退款单未关联售后申请');
        }

        const request = await tx.afterSaleRequest.findUnique({
          where: { id: refund.afterSaleId },
        });
        if (!request) throw new NotFoundException('售后单不存在');

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
        if (refund.status === 'FAILED') return;

        await tx.refund.update({
          where: { id: refundId },
          data: { status: 'FAILED' },
        });
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
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtext('refund-retry'),
            hashtext(${refundId})
          )
        `;

        const refund = await tx.refund.findUnique({ where: { id: refundId } });
        if (!refund) throw new NotFoundException('退款单不存在');
        if (!['FAILED', 'REFUNDING'].includes(refund.status)) {
          throw new BadRequestException('当前退款状态不需要重试');
        }

        const recentRetry = await tx.refundStatusHistory.findFirst({
          where: {
            refundId,
            toStatus: 'REFUNDING',
            remark: { contains: '手动重试' },
            createdAt: { gte: new Date(Date.now() - 30_000) },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (recentRetry) {
          throw new BadRequestException('请勿频繁重试，请 30 秒后再试');
        }

        if (refund.status === 'FAILED') {
          await tx.refund.updateMany({
            where: { id: refundId, status: 'FAILED' },
            data: { status: 'REFUNDING' },
          });
        }
        await tx.refundStatusHistory.create({
          data: {
            refundId,
            fromStatus: refund.status,
            toStatus: 'REFUNDING',
            remark: '管理员手动重试开始',
            operatorId: operator.id ?? operator.type,
          },
        });

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
