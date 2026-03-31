import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentService } from '../payment/payment.service';
import { AfterSaleRewardService } from './after-sale-reward.service';
import { getConfigValue } from './after-sale.utils';
import { AFTER_SALE_CONFIG_KEYS } from './after-sale.constants';

/** P2034 序列化冲突重试次数 */
const MAX_RETRIES = 3;

/** 每批处理的最大数量 */
const BATCH_SIZE = 100;

/**
 * 售后超时自动处理 Cron 服务
 *
 * 每小时检查：
 * 1. 卖家审核超时 → 自动同意（REQUESTED/UNDER_REVIEW → APPROVED）
 * 2. 买家寄回超时 → 自动关闭（APPROVED → CANCELED）
 * 3. 卖家签收超时 → 自动签收（RETURN_SHIPPING → RECEIVED_BY_SELLER）
 * 4. 买家确认超时 → 自动完成（REPLACEMENT_SHIPPED → COMPLETED）
 */
@Injectable()
export class AfterSaleTimeoutService {
  private readonly logger = new Logger(AfterSaleTimeoutService.name);

  constructor(
    private prisma: PrismaService,
    private paymentService: PaymentService,
    private afterSaleRewardService: AfterSaleRewardService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleTimeouts(): Promise<void> {
    this.logger.log('开始检查售后超时...');
    await this.handleSellerReviewTimeout();
    await this.handleBuyerShipTimeout();
    await this.handleSellerReceiveTimeout();
    await this.handleBuyerConfirmTimeout();
    this.logger.log('售后超时检查完成');
  }

  // ========== 1. 卖家审核超时自动同意 ==========

  /**
   * 卖家审核超时 → 自动同意
   * REQUESTED/UNDER_REVIEW + createdAt 超过 SELLER_REVIEW_TIMEOUT_DAYS → APPROVED
   * 如果 requiresReturn=false 且为退货类型 → 自动触发退款
   */
  private async handleSellerReviewTimeout(): Promise<void> {
    const timeoutDays = await getConfigValue(
      this.prisma,
      AFTER_SALE_CONFIG_KEYS.SELLER_REVIEW_TIMEOUT_DAYS,
    );

    const cutoff = new Date(Date.now() - timeoutDays * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.afterSaleRequest.findMany({
      where: {
        status: { in: ['REQUESTED', 'UNDER_REVIEW'] },
        createdAt: { lt: cutoff },
      },
      take: BATCH_SIZE,
      select: {
        id: true,
        status: true,
        orderId: true,
        afterSaleType: true,
        requiresReturn: true,
        refundAmount: true,
        reason: true,
      },
    });

    if (candidates.length === 0) return;

    this.logger.log(`卖家审核超时：发现 ${candidates.length} 条待处理`);

    let successCount = 0;
    let failCount = 0;

    for (const request of candidates) {
      try {
        await this.autoApprove(request);
        successCount++;
        this.logger.log(
          `卖家审核超时自动同意：售后 ${request.id}，订单 ${request.orderId}`,
        );
      } catch (err) {
        failCount++;
        this.logger.error(
          `卖家审核超时处理失败：售后 ${request.id}, error=${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `卖家审核超时处理完成：成功 ${successCount}，失败 ${failCount}`,
    );
  }

  /**
   * 单条自动同意处理（Serializable + CAS + P2034 重试）
   */
  private async autoApprove(request: {
    id: string;
    status: string;
    orderId: string;
    afterSaleType: string;
    requiresReturn: boolean;
    refundAmount: number | null;
    reason: string;
  }): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const now = new Date();

            // CAS 更新：仅当仍为 REQUESTED/UNDER_REVIEW 时才同意
            const cas = await tx.afterSaleRequest.updateMany({
              where: {
                id: request.id,
                status: { in: ['REQUESTED', 'UNDER_REVIEW'] },
              },
              data: {
                status: 'APPROVED',
                approvedAt: now,
                reviewNote: '卖家审核超时，系统自动同意',
              },
            });

            if (cas.count === 0) {
              this.logger.log(`售后 ${request.id} 已非待审核状态，跳过`);
              return;
            }

            // 如果不需要退回商品且为退货类型 → 在事务内创建退款记录
            const isReturnType =
              request.afterSaleType === 'NO_REASON_RETURN' ||
              request.afterSaleType === 'QUALITY_RETURN';

            if (!request.requiresReturn && isReturnType) {
              await this.createRefundInTx(tx, request);
            }
          },
          {
            timeout: 15000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        // 事务提交后，异步触发支付退款（与卖家端 triggerRefund 模式一致）
        const isReturnType =
          request.afterSaleType === 'NO_REASON_RETURN' ||
          request.afterSaleType === 'QUALITY_RETURN';
        if (!request.requiresReturn && isReturnType && request.refundAmount && request.refundAmount > 0) {
          this.asyncRefund(request);
        }

        return; // 成功退出重试
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `autoApprove 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: id=${request.id}`,
          );
          continue;
        }
        throw err;
      }
    }
  }

  // ========== 2. 买家寄回超时自动关闭 ==========

  /**
   * 买家退货寄回超时 → 自动关闭
   * APPROVED + requiresReturn=true + approvedAt 超过 BUYER_SHIP_TIMEOUT_DAYS → CANCELED
   */
  private async handleBuyerShipTimeout(): Promise<void> {
    const timeoutDays = await getConfigValue(
      this.prisma,
      AFTER_SALE_CONFIG_KEYS.BUYER_SHIP_TIMEOUT_DAYS,
    );

    const cutoff = new Date(Date.now() - timeoutDays * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.afterSaleRequest.findMany({
      where: {
        status: 'APPROVED',
        requiresReturn: true,
        approvedAt: { lt: cutoff },
      },
      take: BATCH_SIZE,
      select: { id: true, orderId: true },
    });

    if (candidates.length === 0) return;

    this.logger.log(`买家寄回超时：发现 ${candidates.length} 条待处理`);

    let successCount = 0;
    let failCount = 0;

    for (const request of candidates) {
      try {
        await this.autoCancelBuyerShip(request.id);
        successCount++;
        this.logger.log(
          `买家寄回超时自动关闭：售后 ${request.id}，订单 ${request.orderId}`,
        );
      } catch (err) {
        failCount++;
        this.logger.error(
          `买家寄回超时处理失败：售后 ${request.id}, error=${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `买家寄回超时处理完成：成功 ${successCount}，失败 ${failCount}`,
    );
  }

  private async autoCancelBuyerShip(id: string): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const cas = await tx.afterSaleRequest.updateMany({
              where: { id, status: 'APPROVED' },
              data: { status: 'CANCELED' },
            });
            if (cas.count === 0) {
              this.logger.log(`售后 ${id} 已非 APPROVED 状态，跳过`);
            }
          },
          {
            timeout: 10000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
        return;
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `autoCancelBuyerShip 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: id=${id}`,
          );
          continue;
        }
        throw err;
      }
    }
  }

  // ========== 3. 卖家签收退货超时自动签收 ==========

  /**
   * 卖家签收退货超时 → 自动签收
   * RETURN_SHIPPING + returnShippedAt 超过 SELLER_RECEIVE_TIMEOUT_DAYS → RECEIVED_BY_SELLER
   * 如果为退货类型 → 自动触发退款
   * 如果为换货类型 → 保持 RECEIVED_BY_SELLER（等待卖家发货）
   */
  private async handleSellerReceiveTimeout(): Promise<void> {
    const timeoutDays = await getConfigValue(
      this.prisma,
      AFTER_SALE_CONFIG_KEYS.SELLER_RECEIVE_TIMEOUT_DAYS,
    );

    const cutoff = new Date(Date.now() - timeoutDays * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.afterSaleRequest.findMany({
      where: {
        status: 'RETURN_SHIPPING',
        returnShippedAt: { lt: cutoff },
      },
      take: BATCH_SIZE,
      select: {
        id: true,
        orderId: true,
        afterSaleType: true,
        refundAmount: true,
        reason: true,
      },
    });

    if (candidates.length === 0) return;

    this.logger.log(`卖家签收超时：发现 ${candidates.length} 条待处理`);

    let successCount = 0;
    let failCount = 0;

    for (const request of candidates) {
      try {
        await this.autoReceiveBySeller(request);
        successCount++;
        this.logger.log(
          `卖家签收超时自动签收：售后 ${request.id}，订单 ${request.orderId}`,
        );
      } catch (err) {
        failCount++;
        this.logger.error(
          `卖家签收超时处理失败：售后 ${request.id}, error=${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `卖家签收超时处理完成：成功 ${successCount}，失败 ${failCount}`,
    );
  }

  private async autoReceiveBySeller(request: {
    id: string;
    orderId: string;
    afterSaleType: string;
    refundAmount: number | null;
    reason: string;
  }): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const now = new Date();

            const cas = await tx.afterSaleRequest.updateMany({
              where: { id: request.id, status: 'RETURN_SHIPPING' },
              data: {
                status: 'RECEIVED_BY_SELLER',
                sellerReceivedAt: now,
              },
            });

            if (cas.count === 0) {
              this.logger.log(`售后 ${request.id} 已非 RETURN_SHIPPING 状态，跳过`);
              return;
            }

            // 退货类型 → 自动触发退款
            const isReturnType =
              request.afterSaleType === 'NO_REASON_RETURN' ||
              request.afterSaleType === 'QUALITY_RETURN';

            if (isReturnType) {
              await this.createRefundInTx(tx, request);
            }
            // 换货类型（QUALITY_EXCHANGE）→ 保持 RECEIVED_BY_SELLER，等卖家发换货
          },
          {
            timeout: 15000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        // 事务提交后异步退款
        const isReturnType =
          request.afterSaleType === 'NO_REASON_RETURN' ||
          request.afterSaleType === 'QUALITY_RETURN';
        if (isReturnType && request.refundAmount && request.refundAmount > 0) {
          this.asyncRefund(request);
        }

        return;
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `autoReceiveBySeller 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: id=${request.id}`,
          );
          continue;
        }
        throw err;
      }
    }
  }

  // ========== 4. 买家确认换货超时自动完成 ==========

  /**
   * 买家确认收货超时 → 自动完成
   * REPLACEMENT_SHIPPED + updatedAt 超过 BUYER_CONFIRM_TIMEOUT_DAYS → COMPLETED
   * 换货完成后触发奖励归平台
   */
  private async handleBuyerConfirmTimeout(): Promise<void> {
    const timeoutDays = await getConfigValue(
      this.prisma,
      AFTER_SALE_CONFIG_KEYS.BUYER_CONFIRM_TIMEOUT_DAYS,
    );

    const cutoff = new Date(Date.now() - timeoutDays * 24 * 60 * 60 * 1000);

    // 使用 updatedAt 作为 REPLACEMENT_SHIPPED 时间代理
    // （卖家发出换货时 updatedAt 会被更新为当前时间）
    const candidates = await this.prisma.afterSaleRequest.findMany({
      where: {
        status: 'REPLACEMENT_SHIPPED',
        updatedAt: { lt: cutoff },
      },
      take: BATCH_SIZE,
      select: { id: true, orderId: true },
    });

    if (candidates.length === 0) return;

    this.logger.log(`买家确认超时：发现 ${candidates.length} 条待处理`);

    let successCount = 0;
    let failCount = 0;

    for (const request of candidates) {
      try {
        await this.autoCompleteBuyerConfirm(request);
        successCount++;
        this.logger.log(
          `买家确认超时自动完成：售后 ${request.id}，订单 ${request.orderId}`,
        );
      } catch (err) {
        failCount++;
        this.logger.error(
          `买家确认超时处理失败：售后 ${request.id}, error=${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `买家确认超时处理完成：成功 ${successCount}，失败 ${failCount}`,
    );
  }

  private async autoCompleteBuyerConfirm(request: {
    id: string;
    orderId: string;
  }): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const cas = await tx.afterSaleRequest.updateMany({
              where: { id: request.id, status: 'REPLACEMENT_SHIPPED' },
              data: { status: 'COMPLETED' },
            });

            if (cas.count === 0) {
              this.logger.log(`售后 ${request.id} 已非 REPLACEMENT_SHIPPED 状态，跳过`);
              return;
            }

            // 记录售后完成事件
            const order = await tx.order.findUnique({
              where: { id: request.orderId },
              select: { status: true },
            });

            if (order) {
              await tx.orderStatusHistory.create({
                data: {
                  orderId: request.orderId,
                  fromStatus: order.status,
                  toStatus: order.status,
                  reason: '买家确认收货超时，系统自动完成售后',
                  meta: {
                    type: 'AFTER_SALE_COMPLETED',
                    afterSaleId: request.id,
                    trigger: 'TIMEOUT',
                  },
                },
              });
            }
          },
          {
            timeout: 10000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        // 事务提交后异步触发奖励归平台
        const capturedOrderId = request.orderId;
        setImmediate(() => {
          this.afterSaleRewardService
            .voidRewardsForOrder(capturedOrderId)
            .catch((err: any) => {
              this.logger.error(
                `换货完成后奖励归平台失败: orderId=${capturedOrderId}, error=${err?.message}`,
              );
            });
        });

        return;
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
          this.logger.warn(
            `autoCompleteBuyerConfirm 序列化冲突，重试 ${attempt + 1}/${MAX_RETRIES}: id=${request.id}`,
          );
          continue;
        }
        throw err;
      }
    }
  }

  // ========== 共用：事务内创建退款记录 ==========

  /**
   * 在事务内创建 Refund 记录并将售后状态更新为 REFUNDING
   * 与 seller-after-sale.service.ts 的 triggerRefund 模式一致
   */
  private async createRefundInTx(
    tx: Prisma.TransactionClient,
    request: {
      id: string;
      orderId: string;
      refundAmount: number | null;
      reason: string;
    },
  ): Promise<void> {
    if (!request.refundAmount || request.refundAmount <= 0) {
      this.logger.warn(
        `售后 ${request.id} 退款金额无效: ${request.refundAmount}`,
      );
      return;
    }

    const merchantRefundNo = `AS-TIMEOUT-${request.id}-${Date.now()}`;

    const refund = await tx.refund.create({
      data: {
        orderId: request.orderId,
        amount: request.refundAmount,
        status: 'REFUNDING',
        merchantRefundNo,
        reason: `售后超时自动退款: ${request.reason}`,
      },
    });

    await tx.afterSaleRequest.update({
      where: { id: request.id },
      data: {
        status: 'REFUNDING',
        refundId: refund.id,
      },
    });
  }

  // ========== 共用：异步退款（事务外） ==========

  /**
   * 事务提交后异步调用支付退款
   * 与 seller-after-sale.service.ts 的模式一致
   */
  private asyncRefund(request: {
    id: string;
    orderId: string;
    refundAmount: number | null;
    reason: string;
  }): void {
    const capturedOrderId = request.orderId;
    const merchantRefundNo = `AS-TIMEOUT-${request.id}-${Date.now()}`;

    setImmediate(async () => {
      try {
        const result = await this.paymentService.initiateRefund(
          request.orderId,
          request.refundAmount!,
          merchantRefundNo,
        );
        if (result.success) {
          await this.prisma.afterSaleRequest.updateMany({
            where: { id: request.id, status: 'REFUNDING' },
            data: { status: 'REFUNDED' },
          });
          // 退款成功后触发奖励归平台
          await this.afterSaleRewardService
            .voidRewardsForOrder(capturedOrderId)
            .catch((voidErr: any) => {
              this.logger.error(
                `退款成功后奖励归平台失败: orderId=${capturedOrderId}, error=${voidErr?.message}`,
              );
            });
        }
        // 退款失败则保持 REFUNDING 状态，由补偿任务重试
      } catch (err) {
        this.logger.error(
          `售后超时退款调用失败: afterSaleId=${request.id}, error=${(err as Error).message}`,
        );
      }
    });
  }
}
