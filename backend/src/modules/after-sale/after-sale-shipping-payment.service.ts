import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  AfterSaleRequest,
  AfterSaleShippingPayment,
  Prisma,
} from "@prisma/client";
import { createHash } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { getConfigValue } from "./after-sale.utils";
import { AFTER_SALE_CONFIG_KEYS } from "./after-sale.constants";
import { AlipayService } from "../payment/alipay.service";
import { WechatPayService } from "../payment/wechat-pay.service";
import { decryptJsonValue } from "../../common/security/encryption";
import { DEFAULT_SKU_WEIGHT_GRAM } from "../../common/constants/shipping.constants";
import { assertActiveUserWriteBarrier } from "../../common/transactions/active-user-write-barrier";
import { RedisCoordinatorService } from "../../common/infra/redis-coordinator.service";
import {
  PaymentOperationLockContext,
  withPaymentOperationLock,
} from "../../common/payments/payment-operation-lock";

type Tx = Prisma.TransactionClient;
const SERIALIZABLE_MAX_RETRIES = 3;

type ChannelRefundResult = {
  success: boolean;
  pending?: boolean;
  providerRefundId?: string;
  message: string;
  outTradeNo?: string;
  outRefundNo?: string;
  refundAmountFen?: number;
  totalAmountFen?: number;
};

type TrustedAuthSessionContext = {
  sessionId?: string;
  authIdentityId?: string;
};

type ShippingPaymentScene = "APP" | "MINI_PROGRAM";

type ShippingPaymentParamState = {
  version: 1;
  state: "CREATING" | "READY" | "UNCERTAIN";
  requestFingerprint: string;
  owner?: string;
  params?: AfterSaleShippingPaymentBuyerResponse["paymentParams"];
  startedAt?: string;
  updatedAt: string;
};

export type AfterSaleShippingPaymentBuyerResponse = Pick<
  AfterSaleShippingPayment,
  | "id"
  | "afterSaleId"
  | "merchantPaymentNo"
  | "amount"
  | "status"
  | "paymentScene"
> & {
  paymentParams: {
    channel?: "alipay" | "wechat";
    scene?: "mini_program";
    orderStr?: string;
    appId?: string;
    partnerId?: string;
    timestamp?: string;
    timeStamp?: string;
    nonceStr?: string;
    prepayId?: string;
    packageVal?: string;
    package?: string;
    signType?: string;
    paySign?: string;
  };
};

@Injectable()
export class AfterSaleShippingPaymentService {
  private readonly logger = new Logger(AfterSaleShippingPaymentService.name);
  private shippingRuleService: any = null;
  private wechatPayService?: WechatPayService;
  private readonly wechatRefundQueryFailureMs = 6 * 60 * 60_000;

  constructor(
    private prisma: PrismaService,
    @Optional() private alipayService?: AlipayService,
    @Optional() private redisCoord?: RedisCoordinatorService,
  ) {}

  setShippingRuleService(service: any) {
    this.shippingRuleService = service;
  }

  setWechatPayService(service?: WechatPayService) {
    this.wechatPayService = service;
  }

  setPaymentOperationCoordinator(service: RedisCoordinatorService) {
    this.redisCoord = service;
  }

  async estimateReturnShippingFee(afterSaleId: string): Promise<number> {
    return this.withSerializableRetry((tx) =>
      this.estimateReturnShippingFeeInTx(tx, afterSaleId),
    );
  }

  async createOrGetPayment(
    afterSaleId: string,
  ): Promise<AfterSaleShippingPayment> {
    return this.withSerializableRetry(async (tx) => {
      const request = await tx.afterSaleRequest.findUnique({
        where: { id: afterSaleId },
      });
      if (!request) throw new NotFoundException("售后单不存在");
      this.assertBuyerShippingPaymentAllowed(request);

      return this.upsertPaymentInTx(tx, request);
    });
  }

  async createOrGetPaymentForBuyer(
    userId: string,
    afterSaleId: string,
  ): Promise<AfterSaleShippingPaymentBuyerResponse> {
    const payment = await this.withSerializableRetry(async (tx) => {
      await assertActiveUserWriteBarrier(tx, userId);
      const request = await tx.afterSaleRequest.findFirst({
        where: { id: afterSaleId, userId },
      });
      if (!request) throw new NotFoundException("售后单不存在");
      this.assertBuyerShippingPaymentAllowed(request);

      return this.upsertPaymentInTx(tx, request, "APP");
    });

    const paymentParams = await this.buildPaymentParams(payment, "APP");
    return {
      id: payment.id,
      afterSaleId: payment.afterSaleId,
      merchantPaymentNo: payment.merchantPaymentNo,
      amount: payment.amount,
      status: payment.status,
      paymentScene: payment.paymentScene,
      paymentParams,
    };
  }

  async createOrGetMiniProgramPaymentForBuyer(
    userId: string,
    afterSaleId: string,
    authContext: TrustedAuthSessionContext,
  ): Promise<AfterSaleShippingPaymentBuyerResponse> {
    // 先校验精确 JWT 会话身份，再创建资金单，避免留下无法支付的记录。
    const openId = await this.resolveMiniProgramOpenId(userId, authContext);
    const payment = await this.withSerializableRetry(async (tx) => {
      await assertActiveUserWriteBarrier(tx, userId);
      const request = await tx.afterSaleRequest.findFirst({
        where: { id: afterSaleId, userId },
      });
      if (!request) throw new NotFoundException("售后单不存在");
      this.assertBuyerShippingPaymentAllowed(request);
      return this.upsertPaymentInTx(tx, request, "MINI_PROGRAM");
    });

    const paymentParams = await this.buildPaymentParams(
      payment,
      "MINI_PROGRAM",
      openId,
    );
    return {
      id: payment.id,
      afterSaleId: payment.afterSaleId,
      merchantPaymentNo: payment.merchantPaymentNo,
      amount: payment.amount,
      status: payment.status,
      paymentScene: payment.paymentScene,
      paymentParams,
    };
  }

  /**
   * 用户取消退货运费支付。必须先查单/关单，只有渠道明确未支付终态后
   * 才把本地资金单置为 CLOSED，避免注销永久被 stale UNPAID 卡住。
   */
  async cancelPaymentForBuyer(userId: string, afterSaleId: string) {
    const payment = await this.prisma.afterSaleShippingPayment.findFirst({
      where: { afterSaleId, afterSale: { userId } },
    });
    if (!payment) throw new NotFoundException("退货运费支付单不存在");

    return withPaymentOperationLock({
      coordinator: this.redisCoord,
      namespace: "after-sale-shipping:payment-operation",
      subjectId: payment.id,
      operation: async (lock) => {
        await lock.assertOwned();
        const current = await this.prisma.afterSaleShippingPayment.findFirst({
          where: { id: payment.id, afterSale: { userId } },
        });
        if (!current) throw new NotFoundException("退货运费支付单不存在");
        if (current.status === "CLOSED") return { ok: true, status: "CLOSED" as const };
        if (!["UNPAID", "PENDING", "FAILED"].includes(current.status)) {
          throw new ConflictException("当前退货运费支付状态不可取消");
        }

        await this.closeProviderPaymentSafely(current);
        await lock.assertOwned();
        const result = await this.withSerializableRetry(async (tx) => {
          await assertActiveUserWriteBarrier(tx, userId);
          const updated = await tx.afterSaleShippingPayment.updateMany({
            where: {
              id: current.id,
              status: { in: ["UNPAID", "PENDING", "FAILED"] },
            },
            data: {
              status: "CLOSED",
              failureReason: "USER_CANCELED_AFTER_PROVIDER_CLOSE",
            },
          });
          if (updated.count === 1) return { ok: true, status: "CLOSED" as const };
          const latest = await tx.afterSaleShippingPayment.findUnique({
            where: { id: current.id },
          });
          if (latest?.status === "CLOSED") return { ok: true, status: "CLOSED" as const };
          throw new ConflictException("支付状态已变化，请刷新后确认");
        });
        await lock.assertOwned();
        return result;
      },
    });
  }

  async handlePaymentSuccess(
    merchantPaymentNo: string,
    providerPaymentNo?: string | null,
    paidAt?: Date,
  ): Promise<void> {
    const confirmedAt = paidAt ?? new Date();

    const refundAfterSuccess = await this.withSerializableRetry(async (tx) => {
      const payment = await tx.afterSaleShippingPayment.findUnique({
        where: { merchantPaymentNo },
      });
      if (!payment) throw new NotFoundException("售后退货运费支付单不存在");
      if (payment.status === "PAID") {
        const request = await tx.afterSaleRequest.findUnique({
          where: { id: payment.afterSaleId },
        });
        if (!request) throw new NotFoundException("售后单不存在");
        if (request.status === "APPROVED") return null;
        return {
          afterSaleId: payment.afterSaleId,
          reason:
            payment.failureReason ||
            `售后单状态已变更为 ${request.status}，准备原路退还退货运费`,
        };
      }
      if (payment.status === "FAILED" && payment.paidAt) return null;
      if (payment.status === "REFUNDING") {
        return {
          afterSaleId: payment.afterSaleId,
          reason: this.normalizeRefundRetryReason(payment.failureReason),
        };
      }
      if (payment.status === "REFUNDED") return null;
      if (!["UNPAID", "PENDING", "FAILED", "CLOSED"].includes(payment.status)) {
        return null;
      }

      const request = await tx.afterSaleRequest.findUnique({
        where: { id: payment.afterSaleId },
      });
      if (!request) throw new NotFoundException("售后单不存在");
      const nonActiveRefundReason =
        request.status === "APPROVED"
          ? null
          : `售后单状态已变更为 ${request.status}，准备原路退还退货运费`;

      const updated = await tx.afterSaleShippingPayment.updateMany({
        where: {
          merchantPaymentNo,
          status: { in: ["UNPAID", "PENDING", "FAILED", "CLOSED"] },
        },
        data: {
          status: "PAID",
          providerPaymentNo: providerPaymentNo ?? payment.providerPaymentNo,
          paidAt: confirmedAt,
          failureReason: nonActiveRefundReason,
        },
      });
      if (updated.count === 0) return null;

      if (request.status !== "APPROVED") {
        const refundReason = `售后单状态已变更为 ${request.status}，准备原路退还退货运费`;
        return {
          afterSaleId: payment.afterSaleId,
          reason: refundReason,
        };
      }

      await tx.afterSaleRequest.update({
        where: { id: payment.afterSaleId },
        data: { returnShippingPaidAt: confirmedAt },
      });
      return null;
    });

    if (refundAfterSuccess) {
      await this.refundShippingPayment(
        refundAfterSuccess.afterSaleId,
        refundAfterSuccess.reason,
      );
    }
  }

  async handlePaymentFailure(
    merchantPaymentNo: string,
    reason: string,
  ): Promise<void> {
    await this.withSerializableRetry(async (tx) => {
      const payment = await tx.afterSaleShippingPayment.findUnique({
        where: { merchantPaymentNo },
      });
      if (!payment) throw new NotFoundException("售后退货运费支付单不存在");
      if (payment.status === "FAILED" && payment.paidAt) {
        return;
      }
      if (
        ["PAID", "CLOSED", "REFUNDING", "REFUNDED"].includes(payment.status)
      ) {
        return;
      }

      await tx.afterSaleShippingPayment.updateMany({
        where: {
          merchantPaymentNo,
          status: { in: ["UNPAID", "PENDING", "FAILED"] },
        },
        data: {
          status: "FAILED",
          failureReason: reason,
        },
      });
    });
  }

  async refundShippingPayment(
    afterSaleId: string,
    reason: string,
  ): Promise<void> {
    const paymentToRefund = await this.withSerializableRetry(async (tx) => {
      const payment = await tx.afterSaleShippingPayment.findUnique({
        where: { afterSaleId },
      });
      if (!payment || payment.status === "REFUNDED") {
        return null;
      }

      if (payment.status === "REFUNDING") {
        await tx.afterSaleShippingPayment.updateMany({
          where: { afterSaleId, status: "REFUNDING" },
          data: {
            failureReason: `退货运费退款中: ${reason}`,
          },
        });
        return payment.provider === "WECHAT_PAY" ? null : payment;
      }

      if (
        payment.status === "PAID" ||
        (payment.status === "FAILED" && payment.paidAt)
      ) {
        const updated = await tx.afterSaleShippingPayment.updateMany({
          where: { afterSaleId, status: payment.status },
          data: {
            status: "REFUNDING",
            failureReason: `退货运费退款中: ${reason}`,
          },
        });
        return updated.count === 1 ? payment : null;
      }

      await tx.afterSaleShippingPayment.update({
        where: { afterSaleId },
        data: {
          status: "CLOSED",
          failureReason: reason,
        },
      });
      return null;
    });

    if (!paymentToRefund) return;

    const isWechatRefund = paymentToRefund.provider === "WECHAT_PAY";
    const merchantRefundNo = isWechatRefund
      ? this.getWechatMerchantRefundNo(afterSaleId)
      : this.getMerchantRefundNo(afterSaleId);
    let result: ChannelRefundResult;
    try {
      if (isWechatRefund) {
        if (
          !this.wechatPayService?.isAvailable?.() ||
          !this.wechatPayService?.refund
        ) {
          throw new Error("微信退款服务不可用");
        }
        result = await this.wechatPayService.refund({
          outTradeNo: paymentToRefund.merchantPaymentNo,
          outRefundNo: merchantRefundNo,
          refundAmount: paymentToRefund.amount,
          totalAmount: paymentToRefund.amount,
          reason,
        });
      } else {
        if (!this.alipayService?.refund) {
          throw new Error("支付宝退款服务不可用");
        }
        result = await this.alipayService.refund({
          merchantOrderNo: paymentToRefund.merchantPaymentNo,
          refundAmount: paymentToRefund.amount,
          merchantRefundNo,
          refundReason: reason,
        });
      }
    } catch (err: any) {
      result = {
        success: false,
        message:
          err?.message || (isWechatRefund ? "微信退款异常" : "支付宝退款异常"),
      };
    }

    if (
      isWechatRefund &&
      result.success &&
      !result.pending &&
      !this.wechatRefundResultMatchesPayment(
        result,
        paymentToRefund,
        merchantRefundNo,
      )
    ) {
      this.logger.warn(
        `微信退货运费同步退款成功返回缺少可验证字段，等待通知/查单确认: payment=${paymentToRefund.merchantPaymentNo}`,
      );
      result = {
        ...result,
        pending: true,
        message: result.message || "微信退款成功状态待确认",
      };
    }

    await this.withSerializableRetry(async (tx) => {
      await tx.afterSaleShippingPayment.updateMany({
        where: result.success
          ? { afterSaleId, status: { in: ["REFUNDING", "FAILED"] } }
          : { afterSaleId, status: "REFUNDING" },
        data: result.success
          ? result.pending
            ? {
                status: "REFUNDING",
                failureReason: `退货运费微信退款处理中: ${result.message || merchantRefundNo}`,
              }
            : {
                status: "REFUNDED",
                refundedAt: new Date(),
                failureReason: null,
              }
          : {
              status: "FAILED",
              failureReason: `退货运费退款失败: ${
                result.message ||
                (isWechatRefund ? "微信退款失败" : "支付宝退款失败")
              }`,
            },
      });
    });
  }

  async handleWechatRefundNotify(args: {
    merchantPaymentNo: string;
    outRefundNo?: string | null;
    tradeState: string;
    providerRefundId?: string | null;
    refundAmountFen?: number;
    totalAmountFen?: number;
  }): Promise<void> {
    await this.withSerializableRetry(async (tx) => {
      const payment = await tx.afterSaleShippingPayment.findUnique({
        where: { merchantPaymentNo: args.merchantPaymentNo },
      });
      if (!payment) {
        this.logger.warn(
          `微信退货运费退款通知未找到支付单: ${args.merchantPaymentNo}`,
        );
        return;
      }
      if (payment.provider !== "WECHAT_PAY") {
        this.logger.warn(
          `微信退货运费退款通知命中非微信支付单: payment=${args.merchantPaymentNo} provider=${payment.provider}`,
        );
        return;
      }
      if (
        args.outRefundNo !== this.getWechatMerchantRefundNo(payment.afterSaleId)
      ) {
        this.logger.warn(
          `微信退货运费退款通知退款单号不匹配: payment=${args.merchantPaymentNo} outRefundNo=${args.outRefundNo || "<empty>"}`,
        );
        return;
      }
      if (!this.wechatRefundAmountMatchesPayment(args, payment.amount)) {
        this.logger.warn(
          `微信退货运费退款通知金额不匹配: payment=${args.merchantPaymentNo}`,
        );
        return;
      }

      if (args.tradeState === "SUCCESS") {
        await tx.afterSaleShippingPayment.updateMany({
          where: {
            merchantPaymentNo: args.merchantPaymentNo,
            provider: "WECHAT_PAY",
            status: { in: ["REFUNDING", "FAILED"] },
          },
          data: {
            status: "REFUNDED",
            refundedAt: new Date(),
            failureReason: null,
          },
        });
        return;
      }

      if (args.tradeState === "PROCESSING") {
        await tx.afterSaleShippingPayment.updateMany({
          where: {
            merchantPaymentNo: args.merchantPaymentNo,
            provider: "WECHAT_PAY",
            status: { in: ["PAID", "REFUNDING", "FAILED"] },
          },
          data: {
            status: "REFUNDING",
            failureReason: `退货运费微信退款处理中: ${args.outRefundNo || args.providerRefundId || "UNKNOWN"}`,
          },
        });
        return;
      }

      if (["CLOSED", "ABNORMAL", "FAILED"].includes(args.tradeState)) {
        await tx.afterSaleShippingPayment.updateMany({
          where: {
            merchantPaymentNo: args.merchantPaymentNo,
            provider: "WECHAT_PAY",
            status: { in: ["REFUNDING", "FAILED"] },
          },
          data: {
            status: "FAILED",
            failureReason: `退货运费微信退款失败: ${args.tradeState}`,
          },
        });
      }
    });
  }

  @Cron("30 */10 * * * *")
  async retryStaleWechatShippingRefunds(): Promise<void> {
    if (
      !this.wechatPayService?.isAvailable?.() ||
      !this.wechatPayService?.queryRefund
    )
      return;

    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const candidates = await this.withSerializableRetry((tx) =>
      tx.afterSaleShippingPayment.findMany({
        where: {
          provider: "WECHAT_PAY",
          status: "REFUNDING",
          updatedAt: { lte: cutoff },
        },
        orderBy: { updatedAt: "asc" },
        take: 20,
      }),
    );

    for (const payment of candidates) {
      const refund = await this.wechatPayService.queryRefund(
        this.getWechatMerchantRefundNo(payment.afterSaleId),
      );
      if (!refund) {
        const failureCutoff = new Date(
          Date.now() - this.wechatRefundQueryFailureMs,
        );
        if (payment.updatedAt <= failureCutoff) {
          await this.withSerializableRetry((tx) =>
            tx.afterSaleShippingPayment.updateMany({
              where: {
                id: payment.id,
                provider: "WECHAT_PAY",
                status: "REFUNDING",
              },
              data: {
                status: "FAILED",
                failureReason: "微信退货运费退款查单无结果，请人工确认后重试",
              },
            }),
          );
          this.logger.error(
            `微信退货运费退款查单长期无结果，已转 FAILED: payment=${payment.merchantPaymentNo}`,
          );
        } else {
          this.logger.warn(
            `微信退货运费退款查单无结果，保持 REFUNDING: payment=${payment.merchantPaymentNo}`,
          );
        }
        continue;
      }
      if (refund.outTradeNo !== payment.merchantPaymentNo) {
        this.logger.warn(
          `微信退货运费退款查单返回订单号不匹配: payment=${payment.merchantPaymentNo} provider=${refund.outTradeNo}`,
        );
        continue;
      }
      await this.handleWechatRefundNotify({
        merchantPaymentNo: payment.merchantPaymentNo,
        outRefundNo: refund.outRefundNo,
        tradeState: refund.status,
        providerRefundId: refund.providerRefundId,
        refundAmountFen: refund.refundAmountFen ?? refund.refundAmount,
        totalAmountFen: refund.totalAmountFen ?? refund.totalAmount,
      });
    }
  }

  private normalizeRefundRetryReason(reason?: string | null): string {
    return reason?.replace(/^退货运费退款中:\s*/, "") || "退货运费退款重试";
  }

  private async upsertPaymentInTx(
    tx: Tx,
    request: AfterSaleRequest,
    paymentScene: ShippingPaymentScene = "APP",
  ): Promise<AfterSaleShippingPayment> {
    const amount = await this.resolveReturnShippingFeeInTx(tx, request);
    const order = (tx as any).order?.findUnique
      ? await (tx as any).order.findUnique({
          where: { id: request.orderId },
          select: { checkoutSession: { select: { paymentChannel: true } } },
        })
      : null;
    const provider =
      paymentScene === "MINI_PROGRAM"
        ? "WECHAT_PAY"
        : order?.checkoutSession?.paymentChannel === "WECHAT_PAY"
          ? "WECHAT_PAY"
          : "ALIPAY";
    const existingPayment = await tx.afterSaleShippingPayment.findUnique({
      where: { afterSaleId: request.id },
    });
    if (existingPayment) {
      const existingScene = existingPayment.paymentScene ?? "APP";
      if (
        ["UNPAID", "PENDING", "FAILED"].includes(existingPayment.status) &&
        (existingScene !== paymentScene ||
          (paymentScene === "MINI_PROGRAM" &&
            existingPayment.provider !== "WECHAT_PAY"))
      ) {
        throw new ConflictException({
          code: "PAYMENT_SCENE_MISMATCH",
          message: "该退货运费支付已由另一端发起，请在原端完成或联系客服关单",
          currentScene: existingScene,
          requestedScene: paymentScene,
        });
      }
      return existingPayment;
    }
    const merchantPaymentNo = this.getMerchantPaymentNo(request.id, provider);

    return tx.afterSaleShippingPayment.upsert({
      where: { merchantPaymentNo },
      create: {
        afterSaleId: request.id,
        amount,
        status: "UNPAID",
        merchantPaymentNo,
        provider,
        paymentScene,
      },
      update: {},
    });
  }

  private async resolveReturnShippingFeeInTx(
    tx: Tx,
    request: AfterSaleRequest,
  ): Promise<number> {
    if (request.returnShippingFee != null) {
      return Math.max(0, Math.round(request.returnShippingFee * 100) / 100);
    }

    return this.estimateReturnShippingFeeInTx(tx, request.id);
  }

  private async estimateReturnShippingFeeInTx(
    tx: Tx,
    afterSaleId: string,
  ): Promise<number> {
    if (this.shippingRuleService?.calculateShippingDetail) {
      try {
        const request = (await tx.afterSaleRequest.findUnique({
          where: { id: afterSaleId },
          include: {
            order: {
              select: {
                addressSnapshot: true,
                items: {
                  select: {
                    quantity: true,
                    isPrize: true,
                    productSnapshot: true,
                    sku: { select: { weightGram: true } },
                  },
                },
              },
            },
            orderItem: {
              select: {
                quantity: true,
                productSnapshot: true,
                sku: { select: { weightGram: true } },
              },
            },
          },
        })) as any;
        if (request) {
          const detail = await this.shippingRuleService.calculateShippingDetail(
            0,
            this.resolveRegionCode(request.order?.addressSnapshot),
            this.calculateReturnWeightGram(request),
            tx,
          );
          const fee = Number(detail?.fee);
          if (Number.isFinite(fee) && fee >= 0) {
            return this.roundMoney(fee);
          }
          throw new Error("calculateShippingDetail returned invalid fee");
        }
      } catch (err) {
        // 估算失败不阻断售后，沿用默认退货运费配置兜底。
      }
    }

    const configured = await getConfigValue(
      tx as any,
      AFTER_SALE_CONFIG_KEYS.RETURN_SHIPPING_FEE_DEFAULT,
      10,
    );
    return this.roundMoney(configured);
  }

  private roundMoney(value: number): number {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.max(0, Math.round(amount * 100) / 100);
  }

  private normalizeSkuWeightGram(value: unknown): number {
    const weightGram = Number(value);
    return Number.isFinite(weightGram) && weightGram > 0
      ? Math.trunc(weightGram)
      : DEFAULT_SKU_WEIGHT_GRAM;
  }

  private normalizeSnapshotProduct(
    productSnapshot: unknown,
  ): Record<string, any> | null {
    if (!productSnapshot || Array.isArray(productSnapshot)) {
      return null;
    }
    if (typeof productSnapshot === "string") {
      try {
        const parsed = JSON.parse(productSnapshot);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, any>)
          : null;
      } catch {
        return null;
      }
    }
    return typeof productSnapshot === "object"
      ? (productSnapshot as Record<string, any>)
      : null;
  }

  private normalizePositiveInt(value: unknown): number {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0
      ? Math.trunc(normalized)
      : 0;
  }

  private getBundleSnapshotWeightPerUnit(
    productSnapshot: unknown,
    orderItemQuantity: unknown,
  ): number | null {
    const snapshot = this.normalizeSnapshotProduct(productSnapshot);
    if (snapshot?.productType !== "BUNDLE") {
      return null;
    }

    const bundleWeight = Number(snapshot.bundleTotalWeightGram);
    if (Number.isFinite(bundleWeight) && bundleWeight > 0) {
      return Math.trunc(bundleWeight);
    }

    const bundleItems = Array.isArray(snapshot.bundleItems)
      ? snapshot.bundleItems
      : [];
    if (bundleItems.length === 0) {
      return null;
    }

    const quantity = this.normalizePositiveInt(orderItemQuantity);
    const derivedWeight = bundleItems.reduce((sum: number, item: any) => {
      const weightGram = Number(item?.weightGram);
      if (!Number.isFinite(weightGram) || weightGram <= 0) {
        return sum;
      }

      const quantityPerBundle = this.normalizePositiveInt(
        item?.quantityPerBundle,
      );
      if (quantityPerBundle > 0) {
        return sum + Math.trunc(weightGram) * quantityPerBundle;
      }

      const totalQuantity = this.normalizePositiveInt(item?.totalQuantity);
      if (totalQuantity > 0 && quantity > 0) {
        return (
          sum +
          Math.trunc(weightGram) *
            Math.max(1, Math.round(totalQuantity / quantity))
        );
      }

      return sum;
    }, 0);

    return derivedWeight > 0 ? derivedWeight : null;
  }

  private getReturnItemWeightGram(item: any): number {
    const quantity = this.normalizePositiveInt(item?.quantity);
    if (quantity <= 0) {
      return 0;
    }

    const snapshotWeight = this.getBundleSnapshotWeightPerUnit(
      item?.productSnapshot,
      quantity,
    );
    if (snapshotWeight) {
      return snapshotWeight * quantity;
    }

    return quantity * this.normalizeSkuWeightGram(item?.sku?.weightGram);
  }

  private calculateReturnWeightGram(request: any): number {
    const items = request.orderItem
      ? [request.orderItem]
      : (request.order?.items ?? []).filter((item: any) => !item.isPrize);

    const total = items.reduce((sum: number, item: any) => {
      return sum + this.getReturnItemWeightGram(item);
    }, 0);

    return total > 0 ? total : DEFAULT_SKU_WEIGHT_GRAM;
  }

  private resolveRegionCode(addressSnapshot: unknown): string | undefined {
    const decrypted = decryptJsonValue<any>(addressSnapshot);
    let address = decrypted;
    if (typeof address === "string") {
      try {
        address = JSON.parse(address);
      } catch {
        return undefined;
      }
    }
    if (!address || typeof address !== "object" || Array.isArray(address)) {
      return undefined;
    }
    const regionCode = String(address.regionCode ?? "").trim();
    return regionCode || undefined;
  }

  private assertBuyerShippingPaymentAllowed(request: AfterSaleRequest): void {
    if (request.status !== "APPROVED") {
      throw new BadRequestException("售后单未审批通过，不能支付退货运费");
    }
    if (!request.requiresReturn || request.returnShippingPayer !== "BUYER") {
      throw new BadRequestException("当前售后单不需要买家支付退货运费");
    }
    if (request.returnShippingFeeDeducted) {
      throw new BadRequestException("退货运费已从退款金额中扣除，无需单独支付");
    }
  }

  private getMerchantPaymentNo(
    afterSaleId: string,
    provider: "ALIPAY" | "WECHAT_PAY",
  ): string {
    const legacy = `AS_SHIP_PAY_${afterSaleId}`;
    if (provider === "ALIPAY") return legacy;
    return legacy.length <= 32
      ? legacy
      : `AS_SHIP_PAY_${this.shortToken(afterSaleId)}`;
  }

  private getMerchantRefundNo(afterSaleId: string): string {
    return `AS_SHIP_REFUND_${afterSaleId}`;
  }

  private getWechatMerchantRefundNo(afterSaleId: string): string {
    return `AS_SHIP_REF_${this.shortToken(afterSaleId)}`;
  }

  private shortToken(value: string): string {
    return createHash("sha256")
      .update(value)
      .digest("hex")
      .slice(0, 16)
      .toUpperCase();
  }

  private wechatRefundAmountMatchesPayment(
    args: { refundAmountFen?: number; totalAmountFen?: number },
    paymentAmount: number,
  ): boolean {
    const expectedFen = WechatPayService.yuanToFenAmount(
      Number(paymentAmount),
      "payment.amount",
    );
    return (
      Number.isInteger(expectedFen) &&
      Number.isInteger(args.refundAmountFen) &&
      Number.isInteger(args.totalAmountFen) &&
      args.refundAmountFen === expectedFen &&
      args.totalAmountFen === expectedFen
    );
  }

  private wechatRefundResultMatchesPayment(
    result: ChannelRefundResult,
    payment: AfterSaleShippingPayment,
    expectedRefundNo: string,
  ): boolean {
    return (
      result.outTradeNo === payment.merchantPaymentNo &&
      result.outRefundNo === expectedRefundNo &&
      this.wechatRefundAmountMatchesPayment(result, payment.amount)
    );
  }

  private async buildPaymentParams(
    payment: AfterSaleShippingPayment,
    requestedScene: ShippingPaymentScene,
    miniProgramOpenId?: string,
  ): Promise<AfterSaleShippingPaymentBuyerResponse["paymentParams"]> {
    const storedScene = payment.paymentScene ?? "APP";
    if (storedScene !== requestedScene) {
      throw new ConflictException({
        code: "PAYMENT_SCENE_MISMATCH",
        message: "该退货运费支付由另一端发起",
        currentScene: storedScene,
        requestedScene,
      });
    }
    if (!["UNPAID", "PENDING", "FAILED"].includes(payment.status)) {
      return {};
    }
    if (payment.provider === "WECHAT_PAY") {
      if (requestedScene === "MINI_PROGRAM") {
        return this.buildFencedMiniProgramWechatPaymentParams(
          payment,
          miniProgramOpenId,
        );
      }
      return this.buildFencedAppPaymentParams(payment);
    }
    if (requestedScene === "MINI_PROGRAM") {
      throw new ConflictException("小程序退货运费只支持微信支付");
    }
    return this.buildFencedAppPaymentParams(payment);
  }

  private async buildFencedAppPaymentParams(
    payment: AfterSaleShippingPayment,
  ): Promise<AfterSaleShippingPaymentBuyerResponse["paymentParams"]> {
    return withPaymentOperationLock({
      coordinator: this.redisCoord,
      namespace: "after-sale-shipping:payment-operation",
      subjectId: payment.id,
      operation: async (lock) => {
        await lock.assertOwned();
        const current = await this.withSerializableRetry(async (tx) => {
          const row = await tx.afterSaleShippingPayment.findUnique({
            where: { id: payment.id },
            include: { afterSale: { select: { userId: true } } },
          });
          if (!row) throw new NotFoundException("退货运费支付单不存在");
          await assertActiveUserWriteBarrier(tx, row.afterSale.userId);
          if (row.paymentScene !== "APP" || !["UNPAID", "PENDING", "FAILED"].includes(row.status)) {
            throw new ConflictException("退货运费支付单状态已变化");
          }
          return row as AfterSaleShippingPayment;
        });
        await lock.assertOwned();
        const params = current.provider === "WECHAT_PAY"
          ? await this.buildWechatPaymentParams(current, "APP")
          : await this.buildAlipayPaymentParams(current);
        await lock.assertOwned();
        return params;
      },
    });
  }

  private async closeProviderPaymentSafely(
    payment: AfterSaleShippingPayment,
  ): Promise<void> {
    if (payment.provider === "WECHAT_PAY") {
      if (!this.wechatPayService?.isAvailable?.()) {
        throw new ServiceUnavailableException("微信支付服务暂不可用");
      }
      const queried = await this.wechatPayService.queryOrder(payment.merchantPaymentNo);
      if (queried.outcome === "UNKNOWN") {
        throw new ServiceUnavailableException("正在确认退货运费支付状态，请稍后重试");
      }
      if (queried.outcome === "FOUND") {
        if (!this.wechatPayService.matchesPaymentScene(queried, payment.paymentScene)) {
          throw new BadRequestException("退货运费支付场景校验失败");
        }
        const expectedFen = WechatPayService.yuanToFenAmount(payment.amount, "payment.amount");
        if (queried.totalAmountFen !== expectedFen) {
          throw new BadRequestException("退货运费支付金额校验失败");
        }
        if (queried.tradeState === "SUCCESS") {
          if (!queried.transactionId) {
            throw new ServiceUnavailableException("正在确认退货运费支付状态");
          }
          await this.handlePaymentSuccess(
            payment.merchantPaymentNo,
            queried.transactionId,
            queried.paidAt,
          );
          throw new ConflictException("退货运费已支付成功，不可取消");
        }
      }
      if (queried.outcome === "DEFINITIVE_NOT_FOUND") return;
      const closed = await this.wechatPayService.closeOrder(payment.merchantPaymentNo);
      if (!closed.success || !closed.terminal || closed.alreadyPaid) {
        throw new ServiceUnavailableException("退货运费支付尚未安全关闭，请稍后重试");
      }
      return;
    }

    if (!this.alipayService?.queryOrder || !this.alipayService?.closeOrder) {
      throw new ServiceUnavailableException("支付宝服务暂不可用");
    }
    const queried = await this.alipayService.queryOrder(payment.merchantPaymentNo);
    if (queried && ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(queried.tradeStatus)) {
      if (Math.abs(Number(queried.totalAmount) - payment.amount) > 0.001) {
        throw new BadRequestException("退货运费支付金额校验失败");
      }
      await this.handlePaymentSuccess(
        payment.merchantPaymentNo,
        queried.tradeNo,
      );
      throw new ConflictException("退货运费已支付成功，不可取消");
    }
    if (queried?.tradeStatus === "TRADE_CLOSED") return;
    const closed = await this.alipayService.closeOrder(payment.merchantPaymentNo);
    if (!closed.success || closed.alreadyPaid) {
      throw new ServiceUnavailableException("退货运费支付尚未安全关闭，请稍后重试");
    }
  }

  private normalizePaymentParamState(raw: unknown): ShippingPaymentParamState | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const state = raw as Partial<ShippingPaymentParamState>;
    if (
      state.version !== 1 ||
      !["CREATING", "READY", "UNCERTAIN"].includes(String(state.state)) ||
      typeof state.requestFingerprint !== "string"
    ) {
      return null;
    }
    return state as ShippingPaymentParamState;
  }

  private paymentParamFingerprint(
    payment: AfterSaleShippingPayment,
    openId: string,
  ): string {
    return createHash("sha256")
      .update(JSON.stringify({
        provider: payment.provider,
        paymentScene: payment.paymentScene,
        merchantPaymentNo: payment.merchantPaymentNo,
        amountFen: WechatPayService.yuanToFenAmount(payment.amount, "payment.amount"),
        description: `爱买买退货运费-${payment.afterSaleId}`,
        payerHash: createHash("sha256").update(openId).digest("hex"),
      }))
      .digest("hex");
  }

  private async buildFencedMiniProgramWechatPaymentParams(
    payment: AfterSaleShippingPayment,
    miniProgramOpenId?: string,
  ): Promise<AfterSaleShippingPaymentBuyerResponse["paymentParams"]> {
    if (!miniProgramOpenId) {
      throw new UnauthorizedException("小程序登录会话已失效，请重新登录");
    }
    return withPaymentOperationLock({
      coordinator: this.redisCoord,
      namespace: "after-sale-shipping:payment-operation",
      subjectId: payment.id,
      operation: (lock) => this.createFencedMiniProgramWechatPaymentParams(
        payment.id,
        miniProgramOpenId,
        lock,
      ),
    });
  }

  private async createFencedMiniProgramWechatPaymentParams(
    paymentId: string,
    openId: string,
    lock: PaymentOperationLockContext,
  ): Promise<AfterSaleShippingPaymentBuyerResponse["paymentParams"]> {
    await lock.assertOwned();
    const initial = await this.prisma.afterSaleShippingPayment.findUnique({
      where: { id: paymentId },
    });
    if (!initial) throw new NotFoundException("售后退货运费支付单不存在");
    if (
      initial.provider !== "WECHAT_PAY" ||
      initial.paymentScene !== "MINI_PROGRAM"
    ) {
      throw new ConflictException("退货运费支付场景不匹配");
    }
    const requestFingerprint = this.paymentParamFingerprint(initial, openId);
    const claimed = await this.claimShippingPaymentParamFence({
      paymentId,
      requestFingerprint,
      owner: lock.owner,
      openId,
    });
    if (claimed.readyParams) {
      await lock.assertOwned();
      return claimed.readyParams;
    }

    try {
      if (claimed.previousState === "UNCERTAIN") {
        await this.reconcileUncertainShippingWechatPreorder(claimed.payment);
        await lock.assertOwned();
      }
      const params = await this.buildWechatPaymentParams(
        claimed.payment,
        "MINI_PROGRAM",
        openId,
      );
      await lock.assertOwned();
      await this.finishShippingPaymentParamFence({
        paymentId,
        owner: lock.owner,
        requestFingerprint,
        state: "READY",
        params,
        openId,
      });
      return params;
    } catch (error) {
      await this.finishShippingPaymentParamFence({
        paymentId,
        owner: lock.owner,
        requestFingerprint,
        state: "UNCERTAIN",
      }).catch(() => undefined);
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      this.logger.error(
        `退货运费小程序预下单失败: payment=${claimed.payment.merchantPaymentNo}`,
      );
      throw new ServiceUnavailableException("支付服务暂不可用，请稍后重试");
    }
  }

  private async claimShippingPaymentParamFence(input: {
    paymentId: string;
    requestFingerprint: string;
    owner: string;
    openId: string;
  }): Promise<{
    payment: AfterSaleShippingPayment;
    previousState: "NONE" | "UNCERTAIN";
    readyParams?: AfterSaleShippingPaymentBuyerResponse["paymentParams"];
  }> {
    return this.withSerializableRetry(async (tx) => {
      const payment = await tx.afterSaleShippingPayment.findUnique({
        where: { id: input.paymentId },
        include: { afterSale: { select: { userId: true } } },
      });
      if (!payment) throw new NotFoundException("售后退货运费支付单不存在");
      await assertActiveUserWriteBarrier(tx, payment.afterSale.userId);
      if (
        payment.provider !== "WECHAT_PAY" ||
        payment.paymentScene !== "MINI_PROGRAM" ||
        !["UNPAID", "PENDING", "FAILED"].includes(payment.status)
      ) {
        throw new ConflictException("退货运费支付单状态已变化");
      }
      if (
        payment.miniProgramPayerOpenId &&
        payment.miniProgramPayerOpenId !== input.openId
      ) {
        throw new ConflictException("小程序支付身份快照不一致");
      }
      const existing = this.normalizePaymentParamState(payment.paymentParamState);
      if (
        existing &&
        existing.requestFingerprint !== input.requestFingerprint
      ) {
        throw new ConflictException("退货运费支付请求快照不一致");
      }
      if (existing?.state === "READY") {
        if (!existing.params || Object.keys(existing.params).length === 0) {
          throw new ServiceUnavailableException("退货运费支付参数快照异常");
        }
        return {
          payment: payment as AfterSaleShippingPayment,
          previousState: "NONE" as const,
          readyParams: existing.params,
        };
      }

      const previousState = existing?.state === "CREATING" || existing?.state === "UNCERTAIN"
        ? "UNCERTAIN" as const
        : "NONE" as const;
      const now = new Date().toISOString();
      const next: ShippingPaymentParamState = {
        version: 1,
        state: "CREATING",
        requestFingerprint: input.requestFingerprint,
        owner: input.owner,
        startedAt: now,
        updatedAt: now,
      };
      const updated = await tx.afterSaleShippingPayment.updateMany({
        where: {
          id: payment.id,
          status: payment.status,
        },
        data: {
          status: "PENDING",
          paymentParamState: next as unknown as Prisma.InputJsonValue,
        },
      });
      if (updated.count !== 1) {
        throw new ServiceUnavailableException("退货运费支付单状态已变化");
      }
      return {
        payment: {
          ...payment,
          status: "PENDING",
          paymentParamState: next,
        } as AfterSaleShippingPayment,
        previousState,
      };
    });
  }

  private async finishShippingPaymentParamFence(input: {
    paymentId: string;
    owner: string;
    requestFingerprint: string;
    state: "READY" | "UNCERTAIN";
    params?: AfterSaleShippingPaymentBuyerResponse["paymentParams"];
    openId?: string;
  }): Promise<void> {
    await this.withSerializableRetry(async (tx) => {
      const payment = await tx.afterSaleShippingPayment.findUnique({
        where: { id: input.paymentId },
      });
      if (!payment) throw new NotFoundException("售后退货运费支付单不存在");
      const current = this.normalizePaymentParamState(payment.paymentParamState);
      if (
        current?.state !== "CREATING" ||
        current.owner !== input.owner ||
        current.requestFingerprint !== input.requestFingerprint
      ) {
        throw new ServiceUnavailableException("退货运费支付协调状态已变化");
      }
      if (
        input.openId &&
        payment.miniProgramPayerOpenId &&
        payment.miniProgramPayerOpenId !== input.openId
      ) {
        throw new ConflictException("小程序支付身份快照不一致");
      }
      const next: ShippingPaymentParamState = {
        version: 1,
        state: input.state,
        requestFingerprint: input.requestFingerprint,
        ...(input.state === "READY" ? { params: input.params ?? {} } : {}),
        updatedAt: new Date().toISOString(),
      };
      const updated = await tx.afterSaleShippingPayment.updateMany({
        where: {
          id: payment.id,
          status: { in: ["UNPAID", "PENDING", "FAILED"] },
        },
        data: {
          status: "PENDING",
          paymentParamState: next as unknown as Prisma.InputJsonValue,
          ...(input.state === "READY" && input.openId
            ? { miniProgramPayerOpenId: input.openId }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw new ServiceUnavailableException("退货运费支付单状态已变化");
      }
    });
  }

  private async reconcileUncertainShippingWechatPreorder(
    payment: AfterSaleShippingPayment,
  ): Promise<void> {
    if (!this.wechatPayService?.isAvailable?.()) {
      throw new ServiceUnavailableException("微信支付服务暂不可用");
    }
    let queried: Awaited<ReturnType<WechatPayService["queryOrder"]>>;
    try {
      queried = await this.wechatPayService.queryOrder(payment.merchantPaymentNo);
    } catch {
      throw new ServiceUnavailableException("正在确认退货运费支付状态，请稍后重试");
    }
    if (queried.outcome === "UNKNOWN") {
      throw new ServiceUnavailableException("正在确认退货运费支付状态，请稍后重试");
    }
    if (queried.outcome === "DEFINITIVE_NOT_FOUND") return;
    if (!this.wechatPayService.matchesPaymentScene(queried, "MINI_PROGRAM")) {
      throw new BadRequestException("退货运费支付场景校验失败");
    }
    const expectedFen = WechatPayService.yuanToFenAmount(payment.amount, "payment.amount");
    if (queried.totalAmountFen !== expectedFen) {
      throw new BadRequestException("退货运费支付金额校验失败");
    }
    if (queried.tradeState === "SUCCESS") {
      if (!queried.transactionId) {
        throw new ServiceUnavailableException("正在确认退货运费支付状态");
      }
      await this.handlePaymentSuccess(
        payment.merchantPaymentNo,
        queried.transactionId,
        queried.paidAt,
      );
      throw new ConflictException({
        code: "PAYMENT_ALREADY_COMPLETED",
        message: "退货运费已支付成功",
      });
    }
    if (queried.tradeState === "NOTPAY") return;
    throw new ConflictException("原退货运费支付单已进入不可重复预下单状态");
  }

  private async buildWechatPaymentParams(
    payment: AfterSaleShippingPayment,
    requestedScene: ShippingPaymentScene,
    miniProgramOpenId?: string,
  ): Promise<AfterSaleShippingPaymentBuyerResponse["paymentParams"]> {
    if (
      payment.status !== "UNPAID" &&
      payment.status !== "PENDING" &&
      payment.status !== "FAILED"
    ) {
      return {};
    }
    if (!this.wechatPayService?.isAvailable?.()) {
      return {};
    }

    if (requestedScene === "MINI_PROGRAM") {
      if (!miniProgramOpenId) {
        throw new UnauthorizedException("小程序登录会话已失效，请重新登录");
      }
      const wxParams = await this.wechatPayService.createMiniProgramOrder({
        outTradeNo: payment.merchantPaymentNo,
        amount: payment.amount,
        description: `爱买买退货运费-${payment.afterSaleId}`,
        openId: miniProgramOpenId,
      });
      return {
        channel: "wechat",
        scene: "mini_program",
        appId: wxParams.appId,
        timeStamp: wxParams.timeStamp,
        timestamp: wxParams.timeStamp,
        nonceStr: wxParams.nonceStr,
        prepayId: wxParams.prepayId,
        package: wxParams.package,
        signType: wxParams.signType,
        paySign: wxParams.paySign,
      };
    }

    const wxParams = await this.wechatPayService.createAppOrder({
      outTradeNo: payment.merchantPaymentNo,
      amount: payment.amount,
      description: `爱买买退货运费-${payment.afterSaleId}`,
    });
    return {
      channel: "wechat",
      appId: wxParams.appId,
      partnerId: wxParams.partnerId,
      timestamp: wxParams.timestamp,
      nonceStr: wxParams.nonceStr,
      prepayId: wxParams.prepayId,
      packageVal: wxParams.packageVal,
      signType: wxParams.signType,
      paySign: wxParams.paySign,
    };
  }

  private async buildAlipayPaymentParams(
    payment: AfterSaleShippingPayment,
  ): Promise<AfterSaleShippingPaymentBuyerResponse["paymentParams"]> {
    if (
      payment.status !== "UNPAID" &&
      payment.status !== "PENDING" &&
      payment.status !== "FAILED"
    ) {
      return {};
    }
    if (!this.alipayService?.createAppPayOrder) {
      return {};
    }
    if (this.alipayService.isAvailable && !this.alipayService.isAvailable()) {
      return {};
    }

    const orderStr = await this.alipayService.createAppPayOrder({
      merchantOrderNo: payment.merchantPaymentNo,
      totalAmount: payment.amount,
      subject: `爱买买退货运费-${payment.afterSaleId}`,
    });
    return { channel: "alipay", orderStr };
  }

  private async resolveMiniProgramOpenId(
    userId: string,
    authContext?: TrustedAuthSessionContext,
  ): Promise<string> {
    if (!this.wechatPayService?.isMiniProgramAvailable?.()) {
      throw new ServiceUnavailableException("微信小程序支付暂不可用");
    }
    const miniProgramAppId = this.wechatPayService.getMiniProgramAppId?.();
    if (!miniProgramAppId) {
      throw new ServiceUnavailableException("微信小程序支付暂不可用");
    }
    if (!authContext?.sessionId || !authContext.authIdentityId) {
      throw new UnauthorizedException("小程序登录会话已失效，请重新登录");
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: authContext.sessionId,
        userId,
        authIdentityId: authContext.authIdentityId,
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
      select: {
        authIdentity: {
          select: {
            userId: true,
            provider: true,
            identifier: true,
            appId: true,
            verified: true,
          },
        },
      },
    });
    const identity = session?.authIdentity;
    if (
      !identity ||
      identity.userId !== userId ||
      identity.provider !== "WECHAT" ||
      identity.appId !== miniProgramAppId ||
      !identity.verified ||
      !identity.identifier?.trim()
    ) {
      throw new BadRequestException("当前账号未绑定微信小程序身份，请重新登录");
    }
    return identity.identifier.trim();
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
        if (err?.code === "P2034" && attempt < SERIALIZABLE_MAX_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
    throw new Error("Serializable transaction retry exhausted");
  }
}
