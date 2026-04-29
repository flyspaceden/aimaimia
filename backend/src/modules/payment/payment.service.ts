import { Injectable, Logger, NotFoundException, BadRequestException, UnauthorizedException, NotImplementedException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeStringForLog } from '../../common/logging/log-sanitizer';
import { AlipayService } from './alipay.service';
import { CheckoutService } from '../order/checkout.service';
import { CouponService } from '../coupon/coupon.service';
import { InboxService } from '../inbox/inbox.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly autoRefundReason = '订单取消后支付成功，系统自动退款';
  private readonly autoRefundOperator = 'SYSTEM_AUTO';
  private readonly autoRefundRetryBatchSize = 20;
  private readonly autoRefundRetryCooldownMs = 5 * 60_000;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private alipayService: AlipayService,
    @Optional() private checkoutService?: CheckoutService,
    @Optional() private couponService?: CouponService,
    @Optional() private inboxService?: InboxService,
  ) {}

  /** 查询订单的支付记录 */
  async getByOrderId(orderId: string, userId: string) {
    // 验证订单归属
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('订单未找到');

    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => ({
      id: p.id,
      channel: p.channel,
      amount: p.amount,
      status: p.status,
      merchantOrderNo: p.merchantOrderNo,
      paidAt: p.paidAt?.toISOString() || null,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  /**
   * 发起渠道退款
   * 按 payment.channel 分发到对应的支付渠道退款 API
   * @param orderId 订单 ID
   * @param amount 退款金额（元）
   * @param merchantRefundNo 商户退款单号（可选，用于幂等）
   * @returns 退款结果
   */
  async initiateRefund(
    orderId: string,
    amount: number,
    merchantRefundNo?: string,
  ): Promise<{ success: boolean; providerRefundId?: string; message: string }> {
    this.logger.log(
      `发起渠道退款: orderId=${this.maskBizId(orderId)}, amount=${amount}, merchantRefundNo=${merchantRefundNo ? this.maskBizId(merchantRefundNo) : 'N/A'}`,
    );

    // 查询订单对应的支付记录，确定退款渠道
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: 'PAID' },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      this.logger.warn(`订单 ${this.maskBizId(orderId)} 无已支付的支付记录，跳过渠道退款`);
      return { success: false, message: '未找到对应的支付记录' };
    }

    if (payment.channel === 'ALIPAY') {
      if (!this.alipayService.isAvailable()) {
        this.logger.error(`支付宝 SDK 未初始化，无法退款: orderId=${this.maskBizId(orderId)}`);
        return { success: false, message: '支付宝 SDK 未初始化' };
      }
      const refundNo = merchantRefundNo || `REFUND-${Date.now()}`;
      const result = await this.alipayService.refund({
        merchantOrderNo: payment.merchantOrderNo,
        refundAmount: amount,
        merchantRefundNo: refundNo,
        refundReason: '用户退款',
      });
      return {
        success: result.success,
        providerRefundId: result.success ? refundNo : undefined,
        message: result.message,
      };
    }

    // 微信支付暂未接入，v1.0 仅支持支付宝
    throw new NotImplementedException(`退款渠道 ${payment.channel} 暂未接入`);
  }

  /** 自动退款补偿任务：重试长时间停留在 FAILED/REFUNDING 的自动退款记录 */
  @Cron('0 */10 * * * *')
  async retryStaleAutoRefunds() {
    const cutoff = new Date(Date.now() - this.autoRefundRetryCooldownMs);
    const candidates = await this.prisma.refund.findMany({
      where: {
        deletedAt: null,
        status: { in: ['FAILED', 'REFUNDING'] },
        updatedAt: { lte: cutoff },
        OR: [
          // 自动退款（订单取消后支付成功）：需订单状态为 CANCELED
          { merchantRefundNo: { startsWith: 'AUTO-' }, order: { status: 'CANCELED' } },
          // 售后退款（管理员仲裁 / 卖家同意 / 超时自动）
          { merchantRefundNo: { startsWith: 'AS-' } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: this.autoRefundRetryBatchSize,
    });

    if (candidates.length === 0) return;
    this.logger.warn(`自动退款补偿任务启动：待重试 ${candidates.length} 条`);

    for (const refund of candidates) {
      try {
        if (refund.status === 'FAILED') {
          const moved = await this.prisma.$transaction(async (tx) => {
            const cas = await tx.refund.updateMany({
              where: { id: refund.id, status: 'FAILED' },
              data: { status: 'REFUNDING' },
            });
            if (cas.count === 0) return false;
            await tx.refundStatusHistory.create({
              data: {
                refundId: refund.id,
                fromStatus: 'FAILED',
                toStatus: 'REFUNDING',
                remark: '自动退款补偿重试',
                operatorId: this.autoRefundOperator,
              },
            });
            return true;
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

          if (!moved) continue;
        }

        const result = await this.initiateRefund(refund.orderId, refund.amount, refund.merchantRefundNo);
        if (result.success) {
          await this.updateAutoRefundRecord({
            refundId: refund.id,
            toStatus: 'REFUNDED',
            fromStatuses: ['REFUNDING', 'FAILED'],
            providerRefundId: result.providerRefundId || null,
            remark: '自动退款补偿成功',
          });
        } else {
          await this.updateAutoRefundRecord({
            refundId: refund.id,
            toStatus: 'FAILED',
            fromStatuses: ['REFUNDING'],
            remark: `自动退款补偿失败: ${result.message}`,
          });
        }
      } catch (err: any) {
        const msg = sanitizeStringForLog(err?.message || 'UNKNOWN', { maxStringLength: 256 });
        await this.updateAutoRefundRecord({
          refundId: refund.id,
          toStatus: 'FAILED',
          fromStatuses: ['REFUNDING'],
          remark: `自动退款补偿异常: ${msg}`,
        });
      }
    }
  }

  /**
   * C12修复：HMAC-SHA256 签名验证
   * - 生产环境：PAYMENT_WEBHOOK_SECRET 必须配置，否则拒绝回调
   * - 开发环境：无 secret 时跳过验签（允许 mock 回调）
   * - 使用 timingSafeEqual 防止时序攻击
   */
  private verifySignature(
    rawPayload: any,
    payloadFallback: Record<string, unknown>,
    headerSignature?: string,
  ): boolean {
    const secret = this.configService.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('PAYMENT_WEBHOOK_SECRET 未配置，生产环境拒绝处理回调');
        return false;
      }
      // 开发环境无 secret 时跳过验签
      this.logger.warn('开发环境跳过签名验证（PAYMENT_WEBHOOK_SECRET 未配置）');
      return true;
    }

    const payload = rawPayload && typeof rawPayload === 'object'
      ? rawPayload
      : payloadFallback;
    if (!payload || typeof payload !== 'object') {
      this.logger.warn('支付回调缺少可验签 payload');
      return false;
    }

    const { signature: payloadSignature, ...body } = payload as Record<string, unknown>;
    const providedSignature =
      typeof headerSignature === 'string' && headerSignature
        ? headerSignature
        : (typeof payloadSignature === 'string' ? payloadSignature : undefined);
    if (!providedSignature) {
      this.logger.warn('支付回调缺少 signature 字段');
      return false;
    }

    // 按 key 排序后序列化，确保签名计算的确定性
    const canonicalPayload = JSON.stringify(body, Object.keys(body).sort());
    const expected = crypto.createHmac('sha256', secret).update(canonicalPayload).digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(providedSignature, 'utf8'),
        Buffer.from(expected, 'utf8'),
      );
    } catch {
      // Buffer 长度不一致会抛异常
      return false;
    }
  }

  /**
   * 支付回调处理
   *
   * 生产环境由支付服务商（微信支付/支付宝）异步通知调用。
   * 接入真实支付后需要：
   * 1. 验证回调签名（防伪造）— 已实现 HMAC-SHA256
   * 2. 解密回调数据（微信支付 v3 使用 AES-256-GCM）
   * 3. 返回支付渠道要求的应答格式
   */
  async handlePaymentCallback(body: {
    merchantOrderNo: string;
    providerTxnId: string;
    status: 'SUCCESS' | 'FAILED';
    paidAt?: string;
    rawPayload?: any;
    signature?: string;
    /** 支付宝回调已在 controller 层用证书验签，跳过内部 HMAC 验证 */
    skipSignatureVerification?: boolean;
  }) {
    const { merchantOrderNo, providerTxnId, status, paidAt, rawPayload, signature, skipSignatureVerification } = body;

    // C12修复：HMAC-SHA256 签名验证（支付宝回调已在 controller 层完成验签，可跳过）
    if (!skipSignatureVerification && !this.verifySignature(rawPayload, { merchantOrderNo, providerTxnId, status, paidAt }, signature)) {
      this.logger.error('支付回调签名验证失败');
      throw new UnauthorizedException('支付回调签名验证失败');
    }

    if (!merchantOrderNo || !status) {
      throw new BadRequestException('缺少必要参数 merchantOrderNo 或 status');
    }

    // F1: 检测新结算流程（CheckoutSession-based）
    if (this.checkoutService) {
      const session = await this.checkoutService.findByMerchantOrderNo(merchantOrderNo);
      if (session) {
        this.logger.log(
          `支付回调：检测到 CheckoutSession 流程，merchantOrderNo=${this.maskBizId(merchantOrderNo)}`,
        );
        if (status === 'SUCCESS') {
          const result = await this.checkoutService.handlePaymentSuccess(
            merchantOrderNo,
            providerTxnId,
            paidAt,
          );
          this.logger.log(
            `CheckoutSession 支付回调成功：创建 ${result.orderIds.length} 笔订单`,
          );

          // 通知相关商家有新订单待发货
          this.notifySellersForOrders(result.orderIds).catch((err) =>
            this.logger.warn(`新订单通知商家失败(checkout): ${(err as Error).message}`),
          );

          return { code: 'SUCCESS', message: '处理成功', orderIds: result.orderIds };
        } else {
          // H7+M17修复：支付失败分支使用 Serializable 事务 + P2034 重试
          // 与 SUCCESS 分支（handlePaymentSuccess）隔离级别对称，防止并发竞态
          const MAX_RETRIES = 3;
          let failHandled = false;
          for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
              const failResult = await this.prisma.$transaction(async (tx) => {
                // CAS: ACTIVE → FAILED（原子性状态转换）
                const updateResult = await tx.checkoutSession.updateMany({
                  where: { merchantOrderNo, status: 'ACTIVE' },
                  data: { status: 'FAILED' },
                });
                if (updateResult.count === 0) {
                  // 会话已非 ACTIVE，返回标记跳过后续处理
                  return { skipped: true };
                }
                // 释放预留奖励（在同一事务内，保证原子性）
                if (session.rewardId) {
                  await tx.rewardLedger.updateMany({
                    where: { id: session.rewardId, status: 'RESERVED' },
                    data: { status: 'AVAILABLE', refType: null, refId: null },
                  });
                }
                return { skipped: false };
              }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

              if (failResult.skipped) {
                this.logger.warn(
                  `CheckoutSession 支付失败回调忽略：会话非 ACTIVE，merchantOrderNo=${this.maskBizId(merchantOrderNo)}`,
                );
              } else {
                failHandled = true;
                this.logger.warn(
                  `CheckoutSession 支付失败：merchantOrderNo=${this.maskBizId(merchantOrderNo)}`,
                );
              }
              break; // 成功则跳出重试循环
            } catch (e: any) {
              if (e?.code === 'P2034' && attempt < MAX_RETRIES - 1) {
                this.logger.warn(
                  `CheckoutSession 支付失败回调序列化冲突，第 ${attempt + 1}/${MAX_RETRIES} 次重试`,
                );
                continue;
              }
              throw e;
            }
          }

          // 事务成功后：释放已锁定的平台红包（在事务外执行，CouponService 有自己的事务）
          if (failHandled && session.couponInstanceIds && session.couponInstanceIds.length > 0 && this.couponService) {
            try {
              await this.couponService.releaseCoupons(session.couponInstanceIds);
              this.logger.log(
                `已释放 ${session.couponInstanceIds.length} 张平台红包（支付失败）`,
              );
            } catch (couponErr: any) {
              this.logger.error(
                `释放红包失败（支付失败）：${couponErr.message}`,
              );
            }
          }

          return { code: 'SUCCESS', message: '处理成功' };
        }
      }
    }

    // 旧流程：查找 Payment 记录
    const payment = await this.prisma.payment.findUnique({
      where: { merchantOrderNo },
      include: { order: true },
    });

    if (!payment) {
      this.logger.warn(`支付回调：未找到 merchantOrderNo=${this.maskBizId(merchantOrderNo)}`);
      throw new NotFoundException('支付记录未找到');
    }

    if (status === 'SUCCESS') {
      // H04修复：原子性状态转换，使用 updateMany + 状态条件实现幂等
      // 仅当 Payment 处于 INIT 或 PENDING 状态时才处理，避免并发重复回调
      // L3修复：Serializable 隔离级别 + P2034 重试，防止并发回调竞态
      let updated: {
        autoRefund?: { orderId: string; amount: number; merchantRefundNo: string; refundId: string };
      } | null | undefined = undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          updated = await this.prisma.$transaction(async (tx) => {
            // 原子性更新 Payment 状态（CAS：仅 INIT/PENDING → PAID）
            const result = await tx.payment.updateMany({
              where: {
                id: payment.id,
                status: { in: ['INIT', 'PENDING'] },
              },
              data: {
                status: 'PAID',
                providerTxnId,
                paidAt: paidAt ? new Date(paidAt) : new Date(),
                rawNotifyPayload: rawPayload ?? null,
              },
            });

            if (result.count === 0) {
              // 已处理过（幂等），返回 null 标记跳过后续逻辑
              return null;
            }

            let autoRefund:
              | { orderId: string; amount: number; merchantRefundNo: string; refundId: string }
              | undefined;

            // N07修复：CAS 更新订单状态，防止与取消操作并发竞态
            const orderCas = await tx.order.updateMany({
              where: { id: payment.orderId, status: 'PENDING_PAYMENT' },
              data: { status: 'PAID', paidAt: paidAt ? new Date(paidAt) : new Date() },
            });

            if (orderCas.count > 0) {
              await tx.orderStatusHistory.create({
                data: {
                  orderId: payment.orderId,
                  fromStatus: 'PENDING_PAYMENT',
                  toStatus: 'PAID',
                  reason: '支付回调确认',
                  meta: { providerTxnId, merchantOrderNo },
                },
              });
            } else {
              // S06修复：订单已被取消但支付成功 → 记录冲突并标记需要退款
              const currentOrder = await tx.order.findUnique({ where: { id: payment.orderId } });
              if (currentOrder?.status === 'CANCELED') {
                this.logger.warn(
                  `S06: 支付回调到达但订单已取消，需自动退款: orderId=${this.maskBizId(payment.orderId)}`,
                );
                const merchantRefundNo = `AUTO-${merchantOrderNo}`;
                let refund = await tx.refund.findUnique({
                  where: { merchantRefundNo },
                });
                if (!refund) {
                  refund = await tx.refund.create({
                    data: {
                      orderId: payment.orderId,
                      paymentId: payment.id,
                      amount: payment.amount,
                      status: 'REFUNDING',
                      merchantRefundNo,
                      reason: this.autoRefundReason,
                      rawNotifyPayload: rawPayload ?? null,
                    },
                  });
                  await tx.refundStatusHistory.create({
                    data: {
                      refundId: refund.id,
                      toStatus: 'REFUNDING',
                      remark: '支付回调触发自动退款',
                      operatorId: this.autoRefundOperator,
                    },
                  });
                }
                autoRefund = {
                  orderId: payment.orderId,
                  amount: payment.amount,
                  merchantRefundNo,
                  refundId: refund.id,
                };
                await tx.orderStatusHistory.create({
                  data: {
                    orderId: payment.orderId,
                    fromStatus: 'CANCELED',
                    toStatus: 'CANCELED',
                    reason: '支付回调到达但订单已取消，已创建自动退款记录',
                    meta: {
                      providerTxnId,
                      merchantOrderNo,
                      autoRefundRequired: true,
                      refundId: refund.id,
                      merchantRefundNo,
                    },
                  },
                });
              } else {
                this.logger.warn(
                  `支付回调：订单 ${this.maskBizId(payment.orderId)} 状态非 PENDING_PAYMENT（当前: ${currentOrder?.status}），跳过订单更新`,
                );
              }
            }

            return { autoRefund };
          }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          });
          break; // 成功则跳出重试循环
        } catch (err: any) {
          if (err?.code === 'P2034' && attempt < 2) {
            // 序列化冲突，随机退避后重试
            await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
            continue;
          }
          throw err;
        }
      }

      // 幂等：已处理过的回调直接返回成功
      if (updated === null) {
        this.logger.log(`支付回调：merchantOrderNo=${this.maskBizId(merchantOrderNo)} 已处理，跳过（幂等）`);
        return { code: 'SUCCESS', message: '已处理' };
      }

      this.logger.log(
        `支付回调成功：merchantOrderNo=${this.maskBizId(merchantOrderNo)}，providerTxnId=${this.maskBizId(providerTxnId)}`,
      );

      // 通知相关商家有新订单待发货（非自动退款场景）
      if (updated && !updated.autoRefund) {
        this.notifySellersForOrders([payment.orderId]).catch((err) =>
          this.logger.warn(`新订单通知商家失败(legacy): ${(err as Error).message}`),
        );
      }

      // 订单已取消但支付成功：提交后立即尝试渠道自动退款（事务外执行，避免长事务）
      if (updated?.autoRefund) {
        const { orderId, amount, merchantRefundNo, refundId } = updated.autoRefund;
        try {
          const refundResult = await this.initiateRefund(orderId, amount, merchantRefundNo);
          if (refundResult.success) {
            await this.updateAutoRefundRecord({
              refundId,
              toStatus: 'REFUNDED',
              fromStatuses: ['REFUNDING', 'FAILED'],
              providerRefundId: refundResult.providerRefundId || null,
              rawNotifyPayload: rawPayload ?? null,
              remark: '自动退款成功',
            });
            await this.prisma.orderStatusHistory.create({
              data: {
                orderId,
                fromStatus: 'CANCELED',
                toStatus: 'CANCELED',
                reason: '订单取消后支付成功，系统已发起自动退款',
                meta: {
                  autoRefund: true,
                  providerTxnId,
                  merchantOrderNo,
                  merchantRefundNo,
                  refundId,
                  providerRefundId: refundResult.providerRefundId || null,
                },
              },
            });
          } else {
            await this.updateAutoRefundRecord({
              refundId,
              toStatus: 'FAILED',
              fromStatuses: ['REFUNDING'],
              rawNotifyPayload: rawPayload ?? null,
              remark: `自动退款失败: ${refundResult.message}`,
            });
            await this.prisma.orderStatusHistory.create({
              data: {
                orderId,
                fromStatus: 'CANCELED',
                toStatus: 'CANCELED',
                reason: '订单取消后支付成功，自动退款发起失败，需人工处理',
                meta: {
                  autoRefund: true,
                  providerTxnId,
                  merchantOrderNo,
                  merchantRefundNo,
                  refundId,
                  message: refundResult.message,
                },
              },
            });
            this.logger.error(
              `自动退款发起失败: orderId=${this.maskBizId(orderId)}, merchantRefundNo=${this.maskBizId(merchantRefundNo)}, message=${refundResult.message}`,
            );
          }
        } catch (err: any) {
          const msg = sanitizeStringForLog(err?.message || 'UNKNOWN', { maxStringLength: 256 });
          await this.updateAutoRefundRecord({
            refundId,
            toStatus: 'FAILED',
            fromStatuses: ['REFUNDING'],
            rawNotifyPayload: rawPayload ?? null,
            remark: `自动退款异常: ${msg}`,
          });
          this.logger.error(
            `自动退款异常: orderId=${this.maskBizId(orderId)}, merchantRefundNo=${this.maskBizId(merchantRefundNo)}, error=${msg}`,
          );
          try {
            await this.prisma.orderStatusHistory.create({
              data: {
                orderId,
                fromStatus: 'CANCELED',
                toStatus: 'CANCELED',
                reason: '订单取消后支付成功，自动退款异常，需人工处理',
                meta: {
                  autoRefund: true,
                  providerTxnId,
                  merchantOrderNo,
                  merchantRefundNo,
                  refundId,
                  error: msg,
                },
              },
            });
          } catch {
            // 审计留痕失败不影响回调应答
          }
        }
      }
    } else {
      // 支付失败：同样使用原子性状态转换
      const failResult = await this.prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: { in: ['INIT', 'PENDING'] },
        },
        data: {
          status: 'FAILED',
          rawNotifyPayload: rawPayload ?? null,
        },
      });

      if (failResult.count === 0) {
        // 已处理过（幂等）
        this.logger.log(`支付回调：merchantOrderNo=${this.maskBizId(merchantOrderNo)} 已处理，跳过（幂等）`);
        return { code: 'SUCCESS', message: '已处理' };
      }

      this.logger.warn(`支付回调失败：merchantOrderNo=${this.maskBizId(merchantOrderNo)}`);
    }

    // 返回标准应答（微信支付/支付宝均需要返回 SUCCESS 表示已收到）
    return { code: 'SUCCESS', message: '处理成功' };
  }

  private async updateAutoRefundRecord(params: {
    refundId: string;
    fromStatuses: string[];
    toStatus: 'REFUNDING' | 'REFUNDED' | 'FAILED';
    remark: string;
    providerRefundId?: string | null;
    rawNotifyPayload?: any;
  }): Promise<boolean> {
    const { refundId, fromStatuses, toStatus, remark, providerRefundId, rawNotifyPayload } = params;
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.refund.findUnique({
        where: { id: refundId },
        select: { id: true, status: true },
      });
      if (!current || !fromStatuses.includes(current.status)) return false;

      await tx.refund.update({
        where: { id: refundId },
        data: {
          status: toStatus,
          providerRefundId: providerRefundId ?? undefined,
          rawNotifyPayload: rawNotifyPayload ?? undefined,
        },
      });

      await tx.refundStatusHistory.create({
        data: {
          refundId,
          fromStatus: current.status,
          toStatus,
          remark,
          operatorId: this.autoRefundOperator,
        },
      });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * 通知相关商家有新订单待发货
   * 查询订单涉及的所有商家，向每个商家的 OWNER 发送站内消息
   */
  private async notifySellersForOrders(orderIds: string[]): Promise<void> {
    if (!this.inboxService || orderIds.length === 0) return;

    // 查询所有订单涉及的去重 companyId
    const orderItems = await this.prisma.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { companyId: true },
      distinct: ['companyId'],
    });

    const companyIds = orderItems
      .map((item) => item.companyId)
      .filter((id): id is string => !!id);

    if (companyIds.length === 0) return;

    // 查每个商家的 OWNER 用户
    const staffList = await this.prisma.companyStaff.findMany({
      where: {
        companyId: { in: companyIds },
        role: 'OWNER',
        status: 'ACTIVE',
      },
      select: { userId: true, companyId: true },
    });

    for (const staff of staffList) {
      await this.inboxService.send({
        userId: staff.userId,
        category: 'order',
        type: 'new_order',
        title: '新订单待发货',
        content: '您有新的订单需要处理，请尽快安排发货。',
        // 卖家路由不在买家 App 路由表中，省略 target 让消息变为纯信息（不可点击跳转）
        // 卖家应在卖家后台 web 处理订单，将来可考虑发独立卖家通知渠道
      });
    }
  }

  private maskBizId(value: string): string {
    const safe = sanitizeStringForLog(value || '', { maxStringLength: 128 });
    if (!safe) return '[EMPTY]';
    if (safe.length <= 8) return '[ID_REDACTED]';
    return `${safe.slice(0, 4)}***${safe.slice(-4)}`;
  }
}
