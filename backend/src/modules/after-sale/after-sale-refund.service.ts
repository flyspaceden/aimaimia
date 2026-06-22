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
import { RewardDeductionService } from '../bonus/reward-deduction.service';
import { DigitalAssetService } from '../digital-asset/digital-asset.service';
import { GroupBuyRebateDeductionService } from '../group-buy/group-buy-rebate-deduction.service';
import { sanitizeErrorForLog, sanitizeStringForLog } from '../../common/logging/log-sanitizer';
import { ProductBundleService } from '../product/product-bundle.service';

type Operator = { type: AfterSaleOperatorType; id?: string };
type Tx = Prisma.TransactionClient;
const SERIALIZABLE_MAX_RETRIES = 3;

type StartRefundLease = {
  refund: Refund;
  amount: number;
  orderId: string;
  merchantRefundNo: string;
  shouldInitiate: boolean;
  shouldCloseSuccess?: boolean;
};

type RefundInitiationResult = {
  success: boolean;
  pending?: boolean;
  providerRefundId?: string | null;
  message?: string | null;
};

@Injectable()
export class AfterSaleRefundService {
  private readonly logger = new Logger(AfterSaleRefundService.name);
  private readonly pendingRefundReconcileDelaysMs = [15_000, 45_000, 90_000];
  private rewardDeductionService: RewardDeductionService | null = null;
  private digitalAssetService: DigitalAssetService | null = null;
  private groupBuyRebateDeductionService: GroupBuyRebateDeductionService | null = null;

  constructor(
    private prisma: PrismaService,
    private paymentService: PaymentService,
    private afterSaleRewardService: AfterSaleRewardService,
    private statusHistory: AfterSaleStatusHistoryService,
    private inboxService: InboxService,
    private productBundleService: ProductBundleService = new ProductBundleService(),
  ) {}

  setRewardDeductionService(service: RewardDeductionService) {
    this.rewardDeductionService = service;
  }

  setDigitalAssetService(service: DigitalAssetService) {
    this.digitalAssetService = service;
  }

  setGroupBuyRebateDeductionService(service: GroupBuyRebateDeductionService) {
    this.groupBuyRebateDeductionService = service;
  }

  private buildRestockMovements(orderItem: {
    skuId: string;
    quantity: number;
    companyId?: string | null;
    productSnapshot?: any;
  }): Array<{ skuId: string; quantity: number }> {
    const bundleItems = orderItem.productSnapshot?.bundleItems;
    if (Array.isArray(bundleItems) && bundleItems.length > 0) {
      return this.productBundleService
        .buildInventoryMovements({
          skuId: orderItem.skuId,
          quantity: orderItem.quantity,
          companyId: orderItem.companyId ?? '',
          productSnapshot: orderItem.productSnapshot,
        })
        .map((movement) => ({
          skuId: movement.skuId,
          quantity: movement.quantity,
        }));
    }

    return [{ skuId: orderItem.skuId, quantity: orderItem.quantity }];
  }

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

    let result: RefundInitiationResult;
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

    const providerRefundId = this.sanitizeProviderRefundId(result.providerRefundId);
    if (result.success) {
      if (result.pending) {
        await this.savePendingProviderRefundId(refund.id, providerRefundId);
        this.schedulePendingRefundReconcile(refund.id);
      } else {
        await this.handleRefundSuccess(refund.id, providerRefundId);
      }
    } else {
      await this.handleRefundFailure(refund.id, this.sanitizeProviderMessage(result.message));
    }

    return refund;
  }

  async handleRefundSuccess(
    refundId: string,
    providerRefundId?: string | null,
  ): Promise<void> {
    const completed = await this.withSerializableRetry(
      async (tx) => {
        const refund = await tx.refund.findUnique({ where: { id: refundId } });
        if (!refund) throw new NotFoundException('退款单不存在');
        if (!refund.afterSaleId) {
          throw new BadRequestException('退款单未关联售后申请');
        }

        const request = await tx.afterSaleRequest.findUnique({
          where: { id: refund.afterSaleId },
          include: {
            order: {
              select: {
                checkoutSession: { select: { paymentChannel: true } },
                payments: {
                  where: { status: 'PAID', deletedAt: null },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: { channel: true },
                },
              },
            },
            orderItem: {
              select: {
                skuId: true,
                quantity: true,
                companyId: true,
                isPrize: true,
                productSnapshot: true,
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
            const restockMovements = this.buildRestockMovements(request.orderItem);
            const restockSkuIds = [...new Set(restockMovements.map((movement) => movement.skuId))];
            const existingRestockLedgers = restockSkuIds.length > 0
              ? await tx.inventoryLedger.findMany({
                  where: {
                    skuId: { in: restockSkuIds },
                    type: InventoryType.RELEASE,
                    refType: 'AFTER_SALE',
                    refId: request.id,
                  },
                  select: { skuId: true },
                })
              : [];
            const existingRestockSkuIds = new Set(
              existingRestockLedgers.map((ledger: { skuId: string }) => ledger.skuId),
            );

            for (const movement of restockMovements) {
              if (existingRestockSkuIds.has(movement.skuId)) {
                continue;
              }
              const restockLedger = await tx.inventoryLedger.createMany({
                data: [{
                  skuId: movement.skuId,
                  type: InventoryType.RELEASE,
                  qty: movement.quantity,
                  refType: 'AFTER_SALE',
                  refId: request.id,
                }],
                skipDuplicates: true,
              });

              if (restockLedger.count === 1) {
                await tx.productSKU.update({
                  where: { id: movement.skuId },
                  data: { stock: { increment: movement.quantity } },
                });
              } else {
                // findMany 预查未命中却被 partial unique index 拦截 = ledger 已存在但前面漏判；
                // 不能 increment（避免双发），但必须留下告警让监控可见。
                this.logger.warn(
                  `售后回填库存被静默跳过（findMany 漏判，partial unique index 拦截）: afterSaleId=${request.id}, skuId=${movement.skuId}, quantity=${movement.quantity}`,
                );
              }
            }
          }

          await this.restoreDeductedPointsInTx(tx, refundId, request);
          await this.restoreGroupBuyRebateDeductionInTx(tx, refundId, request);

          return {
            orderId: request.orderId,
            userId: request.userId,
            amount: refund.amount,
            refundDestination: this.formatRefundDestination(
              request.order?.checkoutSession?.paymentChannel ?? request.order?.payments?.[0]?.channel,
            ),
          };
        }

        return null;
      },
    );

    if (!completed) return;

    await this.reverseDigitalAssetAfterRefund(refundId);
    await this.afterSaleRewardService.voidRewardsForOrder(completed.orderId);
    await this.afterSaleRewardService.checkAndMarkOrderRefunded(completed.orderId);
    await this.inboxService.send({
      userId: completed.userId,
      category: 'transaction',
      type: 'refund_credited',
      title: '退款已到账',
      content: `您的退款 ${completed.amount.toFixed(2)} 元已原路退回${completed.refundDestination}。`,
      target: { route: '/orders' },
    }).catch(() => {});
  }

  private async reverseDigitalAssetAfterRefund(refundId: string): Promise<void> {
    if (!this.digitalAssetService) return;
    try {
      await this.digitalAssetService.reverseRefund(refundId);
    } catch (err: any) {
      const safeErr = sanitizeErrorForLog(err);
      this.logger.error(
        `售后退款数字资产扣减失败: refundId=${refundId}, error=${safeErr.message}`,
        safeErr.stack,
      );
      try {
        await this.digitalAssetService.recordRefundReversalFailure(refundId, err, {
          source: 'AFTER_SALE_REFUND',
        });
      } catch (recordErr: any) {
        const safeRecordErr = sanitizeErrorForLog(recordErr);
        this.logger.error(
          `售后退款数字资产扣减失败记录写入失败: refundId=${refundId}, error=${safeRecordErr.message}`,
          safeRecordErr.stack,
        );
      }
    }
  }

  private formatRefundDestination(channel?: string | null): string {
    if (channel === 'WECHAT_PAY') return '微信支付账户';
    if (channel === 'ALIPAY') return '支付宝账户';
    return '原支付账户';
  }

  private async restoreDeductedPointsInTx(
    tx: Tx,
    refundId: string,
    request: any,
  ): Promise<void> {
    if (!this.rewardDeductionService) return;

    const order = await tx.order.findUnique({
      where: { id: request.orderId },
      select: { checkoutSessionId: true },
    });
    if (!order?.checkoutSessionId) return;

    const session = await (tx as any).checkoutSession.findUnique({
      where: { id: order.checkoutSessionId },
      select: {
        deductionGroupId: true,
        discountAmount: true,
        goodsAmount: true,
      },
    });
    if (!session?.deductionGroupId || (session.discountAmount ?? 0) <= 0) return;

    const refundGoodsAmount = await this.resolveOriginalGoodsRefundAmount(tx, request);
    if (refundGoodsAmount === null || refundGoodsAmount <= 0) {
      this.logger.warn(
        `跳过退款积分返还（缺商品原价口径金额）：refundId=${refundId}, afterSaleId=${request.id}`,
      );
      return;
    }

    const priorRestoredLedgers = await (tx as any).rewardLedger.findMany({
      where: {
        refType: 'REFUND_RESTORE',
        meta: { path: ['groupId'], equals: session.deductionGroupId },
        deletedAt: null,
      },
      select: {
        refId: true,
        meta: true,
      },
    });
    const seenRefundIds = new Set<string>();
    const priorGoodsRefundAmount = priorRestoredLedgers.reduce((sum: number, ledger: any) => {
      if (ledger.refId && seenRefundIds.has(ledger.refId)) return sum;
      if (ledger.refId) seenRefundIds.add(ledger.refId);
      const amount = Number(ledger.meta?.originalGoodsRefundAmount ?? 0);
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
    const cumulativeGoodsRefundAmount = Number(
      (priorGoodsRefundAmount + refundGoodsAmount).toFixed(2),
    );
    const originalGoodsCents = Math.round(Number(session.goodsAmount || 0) * 100);
    const cumulativeGoodsRefundCents = Math.round(cumulativeGoodsRefundAmount * 100);
    const isFinalRefund = cumulativeGoodsRefundCents >= originalGoodsCents;

    await this.rewardDeductionService.refundDeduction(tx, {
      refundId,
      orderId: request.orderId,
      originalGoodsAmount: session.goodsAmount,
      originalGoodsRefundAmount: refundGoodsAmount,
      originalDeductAmount: session.discountAmount,
      deductionGroupId: session.deductionGroupId,
      isFinalRefund,
      cumulativeGoodsRefundAmount,
    });
  }

  private async restoreGroupBuyRebateDeductionInTx(
    tx: Tx,
    refundId: string,
    request: any,
  ): Promise<void> {
    if (!this.groupBuyRebateDeductionService) return;

    const order = await tx.order.findUnique({
      where: { id: request.orderId },
      select: { checkoutSessionId: true },
    });
    if (!order?.checkoutSessionId) return;

    const session = await (tx as any).checkoutSession.findUnique({
      where: { id: order.checkoutSessionId },
      select: {
        groupBuyRebateDeductionGroupId: true,
        groupBuyRebateDeductionAmount: true,
        goodsAmount: true,
      },
    });
    if (
      !session?.groupBuyRebateDeductionGroupId ||
      (session.groupBuyRebateDeductionAmount ?? 0) <= 0
    ) {
      return;
    }

    const refundGoodsAmount = await this.resolveOriginalGoodsRefundAmount(tx, request);
    if (refundGoodsAmount === null || refundGoodsAmount <= 0) {
      this.logger.warn(
        `跳过退款团购返还余额抵扣返还（缺商品原价口径金额）：refundId=${refundId}, afterSaleId=${request.id}`,
      );
      return;
    }

    const priorRestoredLedgers = await (tx as any).groupBuyRebateLedger.findMany({
      where: {
        refType: 'REFUND_RESTORE',
        meta: { path: ['groupId'], equals: session.groupBuyRebateDeductionGroupId },
        deletedAt: null,
      },
      select: {
        refId: true,
        meta: true,
      },
    });
    const seenRefundIds = new Set<string>();
    const priorGoodsRefundAmount = priorRestoredLedgers.reduce((sum: number, ledger: any) => {
      if (ledger.refId && seenRefundIds.has(ledger.refId)) return sum;
      if (ledger.refId) seenRefundIds.add(ledger.refId);
      const amount = Number(ledger.meta?.originalGoodsRefundAmount ?? 0);
      return Number.isFinite(amount) ? sum + amount : sum;
    }, 0);
    const cumulativeGoodsRefundAmount = Number(
      (priorGoodsRefundAmount + refundGoodsAmount).toFixed(2),
    );
    const originalGoodsCents = Math.round(Number(session.goodsAmount || 0) * 100);
    const cumulativeGoodsRefundCents = Math.round(cumulativeGoodsRefundAmount * 100);
    const isFinalRefund = cumulativeGoodsRefundCents >= originalGoodsCents;

    await this.groupBuyRebateDeductionService.refundDeduction(tx, {
      refundId,
      orderId: request.orderId,
      originalGoodsAmount: session.goodsAmount,
      originalGoodsRefundAmount: refundGoodsAmount,
      originalDeductAmount: session.groupBuyRebateDeductionAmount,
      deductionGroupId: session.groupBuyRebateDeductionGroupId,
      isFinalRefund,
      cumulativeGoodsRefundAmount,
    });
  }

  private async resolveOriginalGoodsRefundAmount(
    tx: Tx,
    request: any,
  ): Promise<number | null> {
    if (
      request.orderItem &&
      !request.orderItem.isPrize &&
      request.orderItem.skuId &&
      request.orderItem.quantity > 0
    ) {
      const orderItem = await (tx as any).orderItem.findFirst({
        where: {
          orderId: request.orderId,
          skuId: request.orderItem.skuId,
          isPrize: false,
          deletedAt: null,
        },
        select: { unitPrice: true },
      });
      if (orderItem?.unitPrice !== undefined && orderItem?.unitPrice !== null) {
        return Number((request.orderItem.quantity * orderItem.unitPrice).toFixed(2));
      }
    }

    const orderItems = await (tx as any).orderItem.findMany({
      where: {
        orderId: request.orderId,
        isPrize: false,
        deletedAt: null,
      },
      select: {
        quantity: true,
        unitPrice: true,
      },
    });
    if (!orderItems.length) return null;

    return Number(
      orderItems
        .reduce((sum: number, item: any) => sum + item.quantity * item.unitPrice, 0)
        .toFixed(2),
    );
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

    if (lease.fromStatus === 'REFUNDING') {
      await this.paymentService.reconcileWechatRefundBeforeRetry(lease.refund);
      return lease.refund;
    }

    const result: RefundInitiationResult = await this.paymentService.initiateRefund(
      lease.refund.orderId,
      lease.refund.amount,
      lease.refund.merchantRefundNo,
    );
    const providerRefundId = this.sanitizeProviderRefundId(result.providerRefundId);
    if (result.success) {
      if (result.pending) {
        await this.savePendingProviderRefundId(lease.refund.id, providerRefundId);
        this.schedulePendingRefundReconcile(lease.refund.id);
      } else {
        await this.handleRefundSuccess(lease.refund.id, providerRefundId);
      }
    } else {
      await this.handleRefundFailure(
        lease.refund.id,
        this.sanitizeProviderMessage(result.message),
      );
    }
    return lease.refund;
  }

  private async savePendingProviderRefundId(
    refundId: string,
    providerRefundId: string | null,
  ): Promise<void> {
    if (!providerRefundId) return;

    await this.withSerializableRetry(async (tx) => {
      await tx.refund.updateMany({
        where: { id: refundId, status: 'REFUNDING' },
        data: { providerRefundId },
      });
    });
  }

  private schedulePendingRefundReconcile(refundId: string): void {
    for (const delayMs of this.pendingRefundReconcileDelaysMs) {
      const timer = setTimeout(() => {
        void this.reconcilePendingRefund(refundId, delayMs);
      }, delayMs);
      if (typeof (timer as any).unref === 'function') {
        (timer as any).unref();
      }
    }
  }

  private async reconcilePendingRefund(refundId: string, delayMs: number): Promise<void> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        orderId: true,
        amount: true,
        status: true,
        merchantRefundNo: true,
        paymentId: true,
        providerRefundId: true,
      },
    });

    if (!refund || refund.status !== 'REFUNDING') return;

    try {
      await this.paymentService.reconcileWechatRefundBeforeRetry(refund);
    } catch (err: any) {
      const msg = sanitizeStringForLog(err?.message || 'UNKNOWN', { maxStringLength: 256 });
      this.logger.warn(
        `售后 pending 退款短延迟查单失败: refundId=${refundId}, delayMs=${delayMs}, error=${msg}`,
      );
    }
  }

  private sanitizeProviderRefundId(providerRefundId?: string | null): string | null {
    if (!providerRefundId) return null;
    return sanitizeStringForLog(providerRefundId, { maxStringLength: 256 }) || null;
  }

  private sanitizeProviderMessage(message?: string | null): string {
    return sanitizeStringForLog(message || 'UNKNOWN', { maxStringLength: 256 });
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

  private async withSerializableRetry<T>(
    operation: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < SERIALIZABLE_MAX_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < SERIALIZABLE_MAX_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
    throw new Error('Serializable transaction retry exhausted');
  }
}
