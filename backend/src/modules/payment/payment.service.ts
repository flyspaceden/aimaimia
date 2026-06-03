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
import type { AfterSaleRefundService } from '../after-sale/after-sale-refund.service';
import type { AfterSaleShippingPaymentService } from '../after-sale/after-sale-shipping-payment.service';
import type { RewardDeductionService } from '../bonus/reward-deduction.service';
import { WechatPayService } from './wechat-pay.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly autoRefundReason = '订单取消后支付成功，系统自动退款';
  private readonly autoRefundOperator = 'SYSTEM_AUTO';
  private readonly autoRefundRetryBatchSize = 20;
  private readonly autoRefundRetryCooldownMs = 5 * 60_000;
  private afterSaleRefundService: AfterSaleRefundService | null = null;
  private afterSaleShippingPaymentService: AfterSaleShippingPaymentService | null = null;
  private rewardDeductionService: RewardDeductionService | null = null;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private alipayService: AlipayService,
    @Optional() private checkoutService?: CheckoutService,
    @Optional() private couponService?: CouponService,
    @Optional() private inboxService?: InboxService,
    @Optional() private wechatPayService?: WechatPayService,
  ) {}

  setAfterSaleRefundService(service: AfterSaleRefundService) {
    this.afterSaleRefundService = service;
  }

  setAfterSaleShippingPaymentService(service: AfterSaleShippingPaymentService) {
    this.afterSaleShippingPaymentService = service;
  }

  setRewardDeductionService(service: RewardDeductionService) {
    this.rewardDeductionService = service;
  }

  /**
   * P5 第三轮：金额校验 helper（active-query 和 notify 两个路径共用）
   *
   * 安全要求（CLAUDE.md 钱链路安全清单）：
   * - 支付宝声称的支付金额必须 === session 创建时锁定的 expectedTotal
   * - 不一致 → 拒绝建单 + 错误日志（防恶意构造请求/中间人篡改）
   *
   * 抛 BadRequestException 让上层调用方决定如何响应：
   * - active-query：异常上抛给前端 → 前端停止轮询并提示
   * - notify：catch 后日志 + 仍返 'success' 给支付宝（避免支付宝无限重试），
   *   依靠运维告警人工介入
   * - 售后退货运费支付单缺失：抛 NotFoundException，让 notify 返回 failure 触发支付宝重试
   */
  assertAlipayAmountMatchesSession(
    session: { expectedTotal: number; merchantOrderNo: string | null },
    claimedAmount: string,
    source: 'active-query' | 'notify',
  ): void {
    const expectedAmountStr = session.expectedTotal.toFixed(2);
    if (claimedAmount !== expectedAmountStr) {
      this.logger.error(
        `[${source}] 金额校验失败：支付宝=${claimedAmount} session=${expectedAmountStr} ` +
        `merchantOrderNo=${session.merchantOrderNo ? this.maskBizId(session.merchantOrderNo) : 'N/A'} ` +
        `→ 拒绝建单，请人工核查（可能为恶意篡改）`,
      );
      throw new BadRequestException('支付金额校验失败，请联系客服');
    }
  }

  assertWechatAmountMatchesSession(
    session: { expectedTotal: number; merchantOrderNo: string | null },
    claimedAmountFen: number,
    source: string,
  ): void {
    const expectedFen = WechatPayService.yuanToFenAmount(
      Number(session.expectedTotal),
      'session.expectedTotal',
    );
    this.assertWechatFenAmountMatches(
      expectedFen,
      claimedAmountFen,
      '微信支付金额校验失败，请联系客服',
      `[${source}] 微信金额校验失败：微信=${claimedAmountFen} session=${expectedFen} ` +
      `merchantOrderNo=${session.merchantOrderNo ? this.maskBizId(session.merchantOrderNo) : 'N/A'} ` +
      `→ 拒绝建单，请人工核查（可能为恶意篡改）`,
    );
  }

  async assertAfterSaleShippingPaymentAmountMatches(
    outTradeNo: string,
    totalAmount: string,
  ): Promise<void> {
    const payment = await this.prisma.afterSaleShippingPayment.findUnique({
      where: { merchantPaymentNo: outTradeNo },
      select: { amount: true, status: true },
    });
    if (!payment) {
      throw new NotFoundException('售后退货运费支付单不存在');
    }

    this.assertAfterSaleShippingPaymentAmountValueMatches(
      outTradeNo,
      payment.amount,
      totalAmount,
    );
  }

  async assertWechatAfterSaleShippingPaymentAmountMatches(
    outTradeNo: string,
    claimedAmountFen: number,
  ): Promise<void> {
    const payment = await this.prisma.afterSaleShippingPayment.findUnique({
      where: { merchantPaymentNo: outTradeNo },
      select: { amount: true, status: true },
    });
    if (!payment) {
      throw new NotFoundException('售后退货运费支付单不存在');
    }

    const expectedFen = WechatPayService.yuanToFenAmount(Number(payment.amount), 'payment.amount');
    this.assertWechatFenAmountMatches(
      expectedFen,
      claimedAmountFen,
      '售后退货运费金额不匹配',
      `微信售后退货运费金额校验失败：微信=${claimedAmountFen} payment=${expectedFen} ` +
      `merchantPaymentNo=${this.maskBizId(outTradeNo)}`,
    );
  }

  async assertWechatPaymentAmountMatches(
    merchantOrderNo: string,
    claimedAmountFen: number,
  ): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { merchantOrderNo, deletedAt: null },
      select: { amount: true, merchantOrderNo: true },
    });
    if (!payment) {
      throw new NotFoundException('支付记录不存在，无法校验微信支付金额');
    }

    const expectedFen = WechatPayService.yuanToFenAmount(Number(payment.amount), 'payment.amount');
    this.assertWechatFenAmountMatches(
      expectedFen,
      claimedAmountFen,
      '微信支付金额校验失败，请联系客服',
      `微信支付记录金额校验失败：微信=${claimedAmountFen} payment=${expectedFen} ` +
      `merchantOrderNo=${this.maskBizId(merchantOrderNo)}`,
    );
  }

  private assertWechatFenAmountMatches(
    expectedFen: number,
    claimedAmountFen: number,
    errorMessage: string,
    logMessage: string,
  ): void {
    if (!Number.isInteger(expectedFen) || !Number.isInteger(claimedAmountFen)) {
      throw new BadRequestException('微信支付金额格式错误');
    }
    if (expectedFen !== claimedAmountFen) {
      this.logger.error(logMessage);
      throw new BadRequestException(errorMessage);
    }
  }

  private assertAfterSaleShippingPaymentAmountValueMatches(
    merchantPaymentNo: string,
    expectedAmount: number,
    totalAmount: string,
  ): void {
    const actualAmount = Number(totalAmount);
    if (!Number.isFinite(actualAmount)) {
      throw new BadRequestException('售后退货运费金额格式错误');
    }

    const expectedFen = Math.round(expectedAmount * 100);
    const actualFen = Math.round(actualAmount * 100);
    if (expectedFen !== actualFen) {
      throw new BadRequestException(
        `售后退货运费金额不匹配: expected=${expectedFen}, actual=${actualFen}`,
      );
    }
  }

  /**
   * P5 第三轮：App 端主动查询支付订单状态并落单
   *
   * 触发场景：
   * - App 调起支付宝 SDK 后，无论 resultStatus 是 9000/8000/6004/4000（除 6001 用户取消外），
   *   立即调用此接口让后端去支付宝主动查询真实状态
   * - 解决沙箱 notify 慢/丢失导致的"已扣款但订单未生成"问题
   * - notify 异步路径仍然保留，本接口为主动确认 + 兜底
   *
   * 流程：
   * 1. 校验 session 存在 + 属于当前用户 + 渠道支持主动查询
   * 2. 已 COMPLETED → 直接返回（幂等）
   * 3. 按 session.paymentChannel dispatch 到渠道查单
   * 4. 渠道成功态 → 校验金额一致 → 复用 handlePaymentCallback 建单
   * 5. 中间态 / 查询异常 → 返回当前 session 状态（不标失败，让前端 polling 兜底）
   *
   * 安全要点（CLAUDE.md 钱链路安全清单）：
   * - 金额校验：渠道返回的 totalAmount 必须等于 session.expectedTotal，防恶意篡改
   * - 幂等：依赖 handlePaymentSuccess 内部的 Serializable + CAS（已实现）
   * - 跳过签名校验：query 是后端主动调用，没有"对方签名"概念，复用 skipSignatureVerification:true
   */
  async confirmAlipayCheckout(sessionId: string, userId: string) {
    return this.confirmCheckout(sessionId, userId);
  }

  async confirmCheckout(sessionId: string, userId: string) {
    if (sessionId?.startsWith('AS_SHIP_PAY_')) {
      return this.confirmAfterSaleShippingPayment(sessionId, userId);
    }

    if (!this.checkoutService) {
      throw new BadRequestException('结算服务未启用');
    }

    // 1. 校验 session 存在 + 属于当前用户
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { orders: { select: { id: true } } },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('结算会话不存在');
    }

    // 2. 校验支付渠道
    if (session.paymentChannel !== 'ALIPAY' && session.paymentChannel !== 'WECHAT_PAY') {
      throw new BadRequestException('当前会话支付渠道不支持主动查询');
    }

    // 3. 已 COMPLETED 直接返回（幂等：active-query 可能被前端重试多次）
    if (session.status === 'COMPLETED') {
      return {
        status: session.status,
        orderIds: session.orders.map((o) => o.id),
        expectedTotal: session.expectedTotal,
        confirmedBy: 'already-completed' as const,
      };
    }

    // 4. EXPIRED / FAILED → 直接返回当前状态（不重新查询）
    if (session.status === 'EXPIRED' || session.status === 'FAILED') {
      return {
        status: session.status,
        orderIds: session.orders.map((o) => o.id),
        expectedTotal: session.expectedTotal,
        confirmedBy: 'terminal-state' as const,
      };
    }

    if (!session.merchantOrderNo) {
      this.logger.warn(`active-query: session ${this.maskBizId(sessionId)} 无 merchantOrderNo，无法查询`);
      return {
        status: session.status,
        orderIds: session.orders.map((o) => o.id),
        expectedTotal: session.expectedTotal,
        confirmedBy: 'no-merchant-order-no' as const,
      };
    }

    if (session.paymentChannel === 'ALIPAY') {
      // 5. 调支付宝查询接口
      let queryResult: { tradeStatus: string; tradeNo: string; totalAmount: string } | null = null;
      try {
        queryResult = await this.alipayService.queryOrder(session.merchantOrderNo);
      } catch (err: any) {
        this.logger.error(`active-query 调用支付宝异常: ${err.message}`);
        // 异常不抛给前端，让 polling 兜底
        return {
          status: session.status,
          orderIds: session.orders.map((o) => o.id),
          expectedTotal: session.expectedTotal,
          confirmedBy: 'query-error' as const,
        };
      }

      if (!queryResult) {
        // 支付宝未查到该订单（可能用户还没付）
        return {
          status: session.status,
          orderIds: session.orders.map((o) => o.id),
          expectedTotal: session.expectedTotal,
          confirmedBy: 'not-found' as const,
        };
      }

      const { tradeStatus, tradeNo, totalAmount } = queryResult;

      // 6. 仅 TRADE_SUCCESS / TRADE_FINISHED 视为成功，其他中间态原样返回
      if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
        this.logger.log(
          `active-query: 支付宝返回 ${tradeStatus}，session ${this.maskBizId(sessionId)} 保持当前状态 ${session.status}`,
        );
        return {
          status: session.status,
          orderIds: session.orders.map((o) => o.id),
          expectedTotal: session.expectedTotal,
          confirmedBy: `alipay-${tradeStatus.toLowerCase()}` as const,
        };
      }

      // 7. 金额校验（防恶意篡改）— CLAUDE.md 钱链路安全清单要求
      this.assertAlipayAmountMatchesSession(
        { expectedTotal: session.expectedTotal, merchantOrderNo: session.merchantOrderNo },
        totalAmount,
        'active-query',
      );

      // 8. 复用 handlePaymentCallback 建单（含 Serializable + CAS 幂等）
      await this.handlePaymentCallback({
        merchantOrderNo: session.merchantOrderNo,
        providerTxnId: tradeNo,
        status: 'SUCCESS',
        paidAt: new Date().toISOString(),
        rawPayload: { source: 'active-query', tradeStatus, tradeNo, totalAmount },
        skipSignatureVerification: true,
      });
    } else {
      if (!this.wechatPayService?.isAvailable()) {
        this.logger.warn(`active-query 微信支付未启用，session ${this.maskBizId(sessionId)} 保持当前状态 ${session.status}`);
        return {
          status: session.status,
          orderIds: session.orders.map((o) => o.id),
          expectedTotal: session.expectedTotal,
          confirmedBy: 'query-error' as const,
        };
      }

      let queryResult: {
        tradeState: string;
        transactionId?: string;
        outTradeNo: string;
        totalAmountFen: number;
        totalAmount: number;
        paidAt?: Date;
      } | null = null;
      try {
        queryResult = await this.wechatPayService.queryOrder(session.merchantOrderNo);
      } catch (err: any) {
        this.logger.error(`active-query 调用微信支付异常: ${err.message}`);
        return {
          status: session.status,
          orderIds: session.orders.map((o) => o.id),
          expectedTotal: session.expectedTotal,
          confirmedBy: 'query-error' as const,
        };
      }

      if (!queryResult) {
        return {
          status: session.status,
          orderIds: session.orders.map((o) => o.id),
          expectedTotal: session.expectedTotal,
          confirmedBy: 'not-found' as const,
        };
      }

      const { tradeState, transactionId, totalAmountFen, paidAt } = queryResult;
      if (tradeState !== 'SUCCESS') {
        this.logger.log(
          `active-query: 微信支付返回 ${tradeState}，session ${this.maskBizId(sessionId)} 保持当前状态 ${session.status}`,
        );
        return {
          status: session.status,
          orderIds: session.orders.map((o) => o.id),
          expectedTotal: session.expectedTotal,
          confirmedBy: `wechat-${tradeState.toLowerCase()}` as const,
        };
      }

      if (!transactionId) {
        throw new BadRequestException('微信支付成功但缺少交易流水号');
      }

      this.assertWechatAmountMatchesSession(
        { expectedTotal: session.expectedTotal, merchantOrderNo: session.merchantOrderNo },
        totalAmountFen,
        'active-query',
      );

      await this.handlePaymentCallback({
        merchantOrderNo: session.merchantOrderNo,
        providerTxnId: transactionId,
        status: 'SUCCESS',
        paidAt: paidAt?.toISOString() ?? new Date().toISOString(),
        rawPayload: { source: 'active-query', ...queryResult },
        skipSignatureVerification: true,
      });
    }

    // 9. 重新读取 session 拿最新 orderIds（handlePaymentCallback 可能刚建完单）
    const refreshed = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { orders: { select: { id: true } } },
    });

    return {
      status: refreshed?.status ?? 'COMPLETED',
      orderIds: refreshed?.orders.map((o) => o.id) ?? [],
      expectedTotal: session.expectedTotal,
      confirmedBy: 'active-query-success' as const,
    };
  }

  private async confirmAfterSaleShippingPayment(
    merchantPaymentNo: string,
    userId: string,
  ) {
    const payment = await this.prisma.afterSaleShippingPayment.findUnique({
      where: { merchantPaymentNo },
      include: { afterSale: { select: { userId: true } } },
    });
    if (!payment || payment.afterSale.userId !== userId) {
      throw new NotFoundException('售后退货运费支付单不存在');
    }

    if (payment.provider === 'WECHAT_PAY') {
      if (!this.wechatPayService?.isAvailable()) {
        this.logger.warn(`active-query 微信支付未启用，售后退货运费支付单 ${this.maskBizId(merchantPaymentNo)} 保持当前状态 ${payment.status}`);
        return {
          status: payment.status,
          orderIds: [],
          expectedTotal: payment.amount,
          confirmedBy: 'query-error' as const,
        };
      }

      let queryResult: {
        tradeState: string;
        transactionId?: string;
        outTradeNo: string;
        totalAmountFen?: number;
        amountFen?: number;
        paidAt?: Date;
      } | null = null;
      try {
        queryResult = await this.wechatPayService.queryOrder(merchantPaymentNo);
      } catch (err: any) {
        this.logger.error(`active-query 售后退货运费调用微信异常: ${err.message}`);
        return {
          status: payment.status,
          orderIds: [],
          expectedTotal: payment.amount,
          confirmedBy: 'query-error' as const,
        };
      }

      if (!queryResult) {
        return {
          status: payment.status,
          orderIds: [],
          expectedTotal: payment.amount,
          confirmedBy: 'not-found' as const,
        };
      }

      const { tradeState, transactionId, paidAt } = queryResult;
      if (tradeState !== 'SUCCESS') {
        this.logger.log(
          `active-query: 微信支付返回 ${tradeState}，售后退货运费支付单 ${this.maskBizId(merchantPaymentNo)} 保持当前状态 ${payment.status}`,
        );
        return {
          status: payment.status,
          orderIds: [],
          expectedTotal: payment.amount,
          confirmedBy: `wechat-${tradeState.toLowerCase()}` as const,
        };
      }

      if (!transactionId) {
        this.logger.error(
          `active-query 售后退货运费调用微信异常: SUCCESS 缺少 transactionId，merchantPaymentNo=${this.maskBizId(merchantPaymentNo)}`,
        );
        return {
          status: payment.status,
          orderIds: [],
          expectedTotal: payment.amount,
          confirmedBy: 'query-error' as const,
        };
      }

      const claimedAmountFen = queryResult.totalAmountFen ?? queryResult.amountFen;
      if (typeof claimedAmountFen !== 'number' || !Number.isInteger(claimedAmountFen)) {
        this.logger.error(
          `active-query 售后退货运费调用微信异常: SUCCESS 缺少有效金额，merchantPaymentNo=${this.maskBizId(merchantPaymentNo)}`,
        );
        return {
          status: payment.status,
          orderIds: [],
          expectedTotal: payment.amount,
          confirmedBy: 'query-error' as const,
        };
      }
      await this.assertWechatAfterSaleShippingPaymentAmountMatches(
        merchantPaymentNo,
        claimedAmountFen,
      );

      await this.handlePaymentCallback({
        merchantOrderNo: merchantPaymentNo,
        providerTxnId: transactionId,
        status: 'SUCCESS',
        paidAt: paidAt?.toISOString() ?? new Date().toISOString(),
        rawPayload: { source: 'active-query', ...queryResult },
        skipSignatureVerification: true,
      });

      return {
        status: 'PAID',
        orderIds: [],
        expectedTotal: payment.amount,
        confirmedBy: 'active-query-success' as const,
      };
    }

    let queryResult: { tradeStatus: string; tradeNo: string; totalAmount: string } | null = null;
    try {
      queryResult = await this.alipayService.queryOrder(merchantPaymentNo);
    } catch (err: any) {
      this.logger.error(`active-query 售后退货运费调用支付宝异常: ${err.message}`);
      return {
        status: payment.status,
        orderIds: [],
        expectedTotal: payment.amount,
        confirmedBy: 'query-error' as const,
      };
    }

    if (!queryResult) {
      return {
        status: payment.status,
        orderIds: [],
        expectedTotal: payment.amount,
        confirmedBy: 'not-found' as const,
      };
    }

    const { tradeStatus, tradeNo, totalAmount } = queryResult;
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      this.logger.log(
        `active-query: 支付宝返回 ${tradeStatus}，售后退货运费支付单 ${this.maskBizId(merchantPaymentNo)} 保持当前状态 ${payment.status}`,
      );
      return {
        status: payment.status,
        orderIds: [],
        expectedTotal: payment.amount,
        confirmedBy: `alipay-${tradeStatus.toLowerCase()}` as const,
      };
    }

    this.assertAfterSaleShippingPaymentAmountValueMatches(
      merchantPaymentNo,
      payment.amount,
      totalAmount,
    );

    await this.handlePaymentCallback({
      merchantOrderNo: merchantPaymentNo,
      providerTxnId: tradeNo,
      status: 'SUCCESS',
      paidAt: new Date().toISOString(),
      rawPayload: { source: 'active-query', tradeStatus, tradeNo, totalAmount },
      skipSignatureVerification: true,
    });

    return {
      status: ['REFUNDING', 'REFUNDED'].includes(payment.status) ? payment.status : 'PAID',
      orderIds: [],
      expectedTotal: payment.amount,
      confirmedBy: 'active-query-success' as const,
    };
  }

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
   * 按支付渠道分发到对应的退款 API
   *
   * 双架构兼容（Bug 89 修复）：
   * - 旧架构：Payment 行存在 → 用 Payment.channel + Payment.merchantOrderNo
   * - 新架构（CheckoutSession-based）：无 Payment 行 → 通过 Order.checkoutSessionId 找到
   *   CheckoutSession.paymentChannel + CheckoutSession.merchantOrderNo 路由
   *
   * @param orderId 订单 ID
   * @param amount 退款金额（元）
   * @param merchantRefundNo 商户退款单号（可选，用于幂等）
   * @returns 退款结果
   */
  async initiateRefund(
    orderId: string,
    amount: number,
    merchantRefundNo?: string,
  ): Promise<{ success: boolean; pending?: boolean; providerRefundId?: string; message: string }> {
    this.logger.log(
      `发起渠道退款: orderId=${this.maskBizId(orderId)}, amount=${amount}, merchantRefundNo=${merchantRefundNo ? this.maskBizId(merchantRefundNo) : 'N/A'}`,
    );

    // 路径 1：旧架构 — 查 Payment 行
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, status: 'PAID' },
      orderBy: { createdAt: 'desc' },
    });

    let channel: string | null = null;
    let providerOrderNo: string | null = null;
    let originalPaymentAmount: number | null = null;

    if (payment) {
      channel = payment.channel;
      providerOrderNo = payment.merchantOrderNo;
      originalPaymentAmount = payment.amount;
    } else {
      // 路径 2：新架构 — 通过 Order.checkoutSessionId 找 CheckoutSession
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { checkoutSessionId: true },
      });
      if (!order?.checkoutSessionId) {
        this.logger.warn(`订单 ${this.maskBizId(orderId)} 无 Payment 行也无 checkoutSessionId，跳过渠道退款`);
        return { success: false, message: '未找到对应的支付记录' };
      }
      const session = await this.prisma.checkoutSession.findUnique({
        where: { id: order.checkoutSessionId },
        select: { merchantOrderNo: true, paymentChannel: true, status: true, expectedTotal: true },
      });
      if (!session?.merchantOrderNo || !session.paymentChannel) {
        this.logger.warn(
          `订单 ${this.maskBizId(orderId)} CheckoutSession 无支付凭据（merchantOrderNo/paymentChannel 缺失）`,
        );
        return { success: false, message: '结算会话支付凭据缺失，无法发起退款' };
      }
      if (!['PAID', 'COMPLETED'].includes(session.status)) {
        this.logger.warn(
          `订单 ${this.maskBizId(orderId)} CheckoutSession 状态异常（${session.status}），拒绝发起退款`,
        );
        return { success: false, message: `结算会话状态异常（${session.status}），无法发起退款` };
      }
      channel = session.paymentChannel as string;
      providerOrderNo = session.merchantOrderNo;
      originalPaymentAmount = session.expectedTotal;
      this.logger.log(
        `走 CheckoutSession 退款路径: orderId=${this.maskBizId(orderId)}, channel=${channel}`,
      );
    }

    if (channel === 'ALIPAY') {
      if (!this.alipayService.isAvailable()) {
        this.logger.error(`支付宝 SDK 未初始化，无法退款: orderId=${this.maskBizId(orderId)}`);
        return { success: false, pending: false, message: '支付宝 SDK 未初始化' };
      }
      const refundNo = merchantRefundNo || `REFUND-${Date.now()}`;
      const result = await this.alipayService.refund({
        merchantOrderNo: providerOrderNo!,
        refundAmount: amount,
        merchantRefundNo: refundNo,
        refundReason: '用户退款',
      });
      return {
        success: result.success,
        pending: false,
        providerRefundId: result.success ? refundNo : undefined,
        message: result.message,
      };
    }

    if (channel === 'WECHAT_PAY') {
      if (!this.wechatPayService?.isAvailable()) {
        this.logger.error(`微信支付 SDK 未初始化，无法退款: orderId=${this.maskBizId(orderId)}`);
        return { success: false, pending: false, message: '微信支付 SDK 未初始化' };
      }
      const refundNo = merchantRefundNo || `REFUND-${Date.now()}`;
      const result = await this.wechatPayService.refund({
        outTradeNo: providerOrderNo!,
        outRefundNo: refundNo,
        refundAmount: amount,
        totalAmount: originalPaymentAmount!,
        reason: '用户退款',
      });
      return {
        success: result.success,
        pending: result.pending,
        providerRefundId: result.success ? result.providerRefundId : undefined,
        message: result.message,
      };
    }

    throw new NotImplementedException(`退款渠道 ${channel} 暂未接入`);
  }

  /**
   * 发起渠道转账（提现）。
   */
  async initiateTransfer(params: {
    channel: 'ALIPAY' | 'WECHAT_PAY' | 'UNIONPAY' | 'AGGREGATOR' | 'WECHAT' | 'BANKCARD';
    amount: number;
    outBizNo: string;
    payeeAccount: string;
    payeeRealName: string;
    remark?: string;
  }): Promise<{
    success: boolean;
    processing: boolean;
    outBizNo: string;
    providerOrderId?: string;
    providerFundOrderId?: string;
    providerStatus?: string;
    errorCode?: string;
    errorMessage?: string;
  }> {
    this.logger.log(
      `发起渠道转账: channel=${params.channel}, outBizNo=${this.maskBizId(params.outBizNo)}, amount=${params.amount}`,
    );

    if (params.channel === 'ALIPAY') {
      if (!this.alipayService.isAvailable()) {
        this.logger.error(`支付宝 SDK 未初始化，无法转账: outBizNo=${this.maskBizId(params.outBizNo)}`);
        return {
          success: false,
          processing: false,
          outBizNo: params.outBizNo,
          errorMessage: '支付宝 SDK 未初始化',
        };
      }

      const result = await this.alipayService.transferToAccount({
        outBizNo: params.outBizNo,
        amount: params.amount,
        payeeAccount: params.payeeAccount,
        payeeRealName: params.payeeRealName,
        remark: params.remark,
      });

      return {
        success: result.success,
        processing: result.processing,
        outBizNo: result.outBizNo,
        providerOrderId: result.orderId,
        providerFundOrderId: result.payFundOrderId,
        providerStatus: result.providerStatus,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      };
    }

    throw new NotImplementedException(`提现渠道 ${params.channel} 暂未接入`);
  }

  async handleWechatRefundNotify(args: {
    outTradeNo: string;
    outRefundNo?: string | null;
    providerRefundId?: string | null;
    tradeState: string;
    amountFen?: number;
    totalAmountFen?: number;
    rawPayload?: any;
  }): Promise<void> {
    const outTradeNo = args.outTradeNo || '';
    const outRefundNo = args.outRefundNo || '';

    if (outTradeNo.startsWith('AS_SHIP_PAY_')) {
      if (!this.afterSaleShippingPaymentService) {
        this.logger.error(
          `微信售后退货运费退款通知无法处理：AfterSaleShippingPaymentService 未注入 outTradeNo=${this.maskBizId(outTradeNo)}`,
        );
        return;
      }
      await this.afterSaleShippingPaymentService.handleWechatRefundNotify({
        merchantPaymentNo: outTradeNo,
        outRefundNo,
        tradeState: args.tradeState,
        providerRefundId: args.providerRefundId,
        refundAmountFen: args.amountFen,
        totalAmountFen: args.totalAmountFen,
      });
      return;
    }

    if (!outRefundNo) {
      this.logger.warn(`微信退款通知缺少 outRefundNo: outTradeNo=${this.maskBizId(outTradeNo)}`);
      return;
    }

    const refund = await this.prisma.refund.findFirst({
      where: { merchantRefundNo: outRefundNo, deletedAt: null },
      select: {
        id: true,
        merchantRefundNo: true,
        status: true,
        amount: true,
      },
    });
    if (!refund) {
      this.logger.warn(`微信退款通知未找到 Refund 记录: outRefundNo=${this.maskBizId(outRefundNo)}`);
      return;
    }

    const providerRefundId = args.providerRefundId || null;
    const tradeState = args.tradeState;
    const merchantRefundNo = refund.merchantRefundNo;

    if (merchantRefundNo.startsWith('AS-')) {
      if (tradeState === 'SUCCESS') {
        if (!this.isWechatRefundNotifyAmountValid(refund, args.amountFen, outRefundNo)) {
          return;
        }
        if (!this.afterSaleRefundService) {
          this.logger.error(
            `微信售后退款成功通知无法闭环：AfterSaleRefundService 未注入 refundId=${this.maskBizId(refund.id)}`,
          );
          return;
        }
        await this.afterSaleRefundService.handleRefundSuccess(refund.id, providerRefundId);
        return;
      }

      if (tradeState === 'PROCESSING') {
        await this.saveWechatPendingRefundId(refund.id, providerRefundId);
        return;
      }

      if (['CLOSED', 'ABNORMAL', 'FAILED'].includes(tradeState)) {
        if (!this.afterSaleRefundService) {
          this.logger.error(
            `微信售后退款失败通知无法闭环：AfterSaleRefundService 未注入 refundId=${this.maskBizId(refund.id)}`,
          );
          return;
        }
        await this.afterSaleRefundService.handleRefundFailure(
          refund.id,
          `微信退款失败: ${tradeState}`,
        );
      }
      return;
    }

    if (merchantRefundNo.startsWith('AUTO-CANCEL-') || merchantRefundNo.startsWith('AUTO-')) {
      if (tradeState === 'SUCCESS') {
        if (!this.isWechatRefundNotifyAmountValid(refund, args.amountFen, outRefundNo)) {
          return;
        }
        await this.updateAutoRefundRecord({
          refundId: refund.id,
          toStatus: 'REFUNDED',
          fromStatuses: ['REFUNDING', 'FAILED'],
          providerRefundId,
          rawNotifyPayload: args.rawPayload,
          remark: '微信退款成功',
        });
        return;
      }

      if (tradeState === 'PROCESSING') {
        await this.updateAutoRefundRecord({
          refundId: refund.id,
          toStatus: 'REFUNDING',
          fromStatuses: ['REFUNDING'],
          providerRefundId,
          rawNotifyPayload: args.rawPayload,
          remark: '微信退款处理中',
        });
        return;
      }

      if (['CLOSED', 'ABNORMAL', 'FAILED'].includes(tradeState)) {
        await this.updateAutoRefundRecord({
          refundId: refund.id,
          toStatus: 'FAILED',
          fromStatuses: ['REFUNDING'],
          providerRefundId,
          rawNotifyPayload: args.rawPayload,
          remark: `微信退款失败: ${tradeState}`,
        });
      }
      return;
    }

    this.logger.warn(`微信退款通知未识别退款单类型: outRefundNo=${this.maskBizId(outRefundNo)}`);
  }

  private isWechatRefundNotifyAmountValid(
    refund: { amount: number; merchantRefundNo: string },
    claimedAmountFen: number | undefined,
    outRefundNo: string,
  ): boolean {
    let expectedFen: number;
    try {
      expectedFen = WechatPayService.yuanToFenAmount(Number(refund.amount), 'refund.amount');
    } catch {
      expectedFen = Number.NaN;
    }
    if (
      !Number.isInteger(expectedFen) ||
      !Number.isInteger(claimedAmountFen) ||
      expectedFen !== claimedAmountFen
    ) {
      this.logger.error(
        `微信退款通知金额校验失败：微信=${claimedAmountFen ?? 'N/A'} refund=${expectedFen} ` +
        `outRefundNo=${this.maskBizId(outRefundNo || refund.merchantRefundNo)} → 拒绝闭环，请人工核查`,
      );
      return false;
    }
    return true;
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
      let claim: {
        orderId: string;
        amount: number;
        merchantRefundNo: string;
        status: string;
        providerRefundId?: string | null;
        paymentChannel?: string | null;
      } | null = null;
      try {
        claim = await this.claimAutoRefundRetry(refund.id);
        if (!claim) continue;

        const isAfterSaleRefund = claim.merchantRefundNo.startsWith('AS-');
        if (
          claim.status === 'REFUNDING' &&
          claim.paymentChannel === 'WECHAT_PAY'
        ) {
          if (!this.wechatPayService?.isAvailable?.() || !this.wechatPayService?.queryRefund) {
            this.logger.warn(
              `微信退款补偿服务不可用，保持退款中且不重复发起: refundId=${this.maskBizId(refund.id)}, merchantRefundNo=${this.maskBizId(claim.merchantRefundNo)}`,
            );
            continue;
          }
          const queried = await this.wechatPayService.queryRefund(claim.merchantRefundNo);
          if (!queried) {
            this.logger.warn(
              `微信退款补偿查单无结果，保持退款中且不重复发起: refundId=${this.maskBizId(refund.id)}, merchantRefundNo=${this.maskBizId(claim.merchantRefundNo)}`,
            );
            continue;
          }
          await this.handleWechatRefundRetryQueryResult(
            refund.id,
            claim,
            queried,
            isAfterSaleRefund,
          );
          continue;
        }

        const result = await this.initiateRefund(claim.orderId, claim.amount, claim.merchantRefundNo);
        if (result.success) {
          if (result.pending) {
            this.logger.log(
              `退款已受理，等待渠道通知: refundId=${this.maskBizId(refund.id)}, merchantRefundNo=${this.maskBizId(claim.merchantRefundNo)}`,
            );
            await this.updateAutoRefundRecord({
              refundId: refund.id,
              toStatus: 'REFUNDING',
              fromStatuses: ['REFUNDING'],
              providerRefundId: result.providerRefundId || null,
              remark: '微信退款已受理，等待渠道通知',
            });
            continue;
          }
          if (isAfterSaleRefund && this.afterSaleRefundService) {
            try {
              await this.afterSaleRefundService.handleRefundSuccess(
                refund.id,
                result.providerRefundId || null,
              );
            } catch (closureErr: any) {
              const closureMsg = sanitizeStringForLog(closureErr?.message || 'UNKNOWN', { maxStringLength: 256 });
              this.logger.error(
                `AS 退款渠道已成功但售后闭环失败: refundId=${this.maskBizId(refund.id)}, error=${closureMsg}`,
              );
            }
            continue;
          }
          await this.updateAutoRefundRecord({
            refundId: refund.id,
            toStatus: 'REFUNDED',
            fromStatuses: ['REFUNDING'],
            providerRefundId: result.providerRefundId || null,
            remark: '自动退款补偿成功',
          });
        } else {
          if (isAfterSaleRefund && this.afterSaleRefundService) {
            await this.afterSaleRefundService.handleRefundFailure(
              refund.id,
              result.message,
            );
            continue;
          }
          await this.updateAutoRefundRecord({
            refundId: refund.id,
            toStatus: 'FAILED',
            fromStatuses: ['REFUNDING'],
            remark: `自动退款补偿失败: ${result.message}`,
          });
        }
      } catch (err: any) {
        const msg = sanitizeStringForLog(err?.message || 'UNKNOWN', { maxStringLength: 256 });
        if (claim?.merchantRefundNo.startsWith('AS-') && this.afterSaleRefundService) {
          await this.afterSaleRefundService.handleRefundFailure(
            refund.id,
            `自动退款补偿异常: ${msg}`,
          );
          continue;
        }
        await this.updateAutoRefundRecord({
          refundId: refund.id,
          toStatus: 'FAILED',
          fromStatuses: ['REFUNDING'],
          remark: `自动退款补偿异常: ${msg}`,
        });
      }
    }
  }

  private async claimAutoRefundRetry(refundId: string): Promise<{
    orderId: string;
    amount: number;
    merchantRefundNo: string;
    status: string;
    providerRefundId?: string | null;
    paymentChannel?: string | null;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('refund-retry'),
          hashtext(${refundId})
        )
      `;

      const fresh = await tx.refund.findUnique({
        where: { id: refundId },
        select: {
          id: true,
          status: true,
          orderId: true,
          paymentId: true,
          amount: true,
          merchantRefundNo: true,
          providerRefundId: true,
        },
      });
      if (!fresh || !['FAILED', 'REFUNDING'].includes(fresh.status)) return null;
      const originalStatus = fresh.status;

      const recent = await tx.refundStatusHistory.findFirst({
        where: {
          refundId,
          toStatus: 'REFUNDING',
          remark: { contains: '重试开始' },
          createdAt: { gte: new Date(Date.now() - 30_000) },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) return null;

      const fromStatus = fresh.status;
      if (fresh.status === 'FAILED') {
        const cas = await tx.refund.updateMany({
          where: { id: refundId, status: 'FAILED' },
          data: { status: 'REFUNDING' },
        });
        if (cas.count === 0) return null;
      }

      await tx.refundStatusHistory.create({
        data: {
          refundId,
          fromStatus,
          toStatus: 'REFUNDING',
          remark: '自动退款补偿重试开始',
          operatorId: this.autoRefundOperator,
        },
      });

      const paymentChannel = await this.resolveRefundPaymentChannel(tx, fresh);

      return {
        orderId: fresh.orderId,
        amount: fresh.amount,
        merchantRefundNo: fresh.merchantRefundNo,
        status: originalStatus,
        providerRefundId: fresh.providerRefundId,
        paymentChannel,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reconcileWechatRefundBeforeRetry(refund: {
    id: string;
    orderId: string;
    amount: number;
    merchantRefundNo: string;
    paymentId?: string | null;
  }): Promise<boolean> {
    const paymentChannel = await this.resolveRefundPaymentChannel(this.prisma, refund);
    if (paymentChannel !== 'WECHAT_PAY') return false;

    if (!this.wechatPayService?.isAvailable?.() || !this.wechatPayService?.queryRefund) {
      this.logger.warn(
        `微信退款服务不可用，跳过 REFUNDING 退款重发: refundId=${this.maskBizId(refund.id)}, merchantRefundNo=${this.maskBizId(refund.merchantRefundNo)}`,
      );
      return true;
    }

    const queried = await this.wechatPayService.queryRefund(refund.merchantRefundNo);
    if (!queried) {
      this.logger.warn(
        `微信退款重试前查单无结果，保持退款中且不重复发起: refundId=${this.maskBizId(refund.id)}, merchantRefundNo=${this.maskBizId(refund.merchantRefundNo)}`,
      );
      return true;
    }

    await this.handleWechatRefundRetryQueryResult(
      refund.id,
      {
        orderId: refund.orderId,
        amount: refund.amount,
        merchantRefundNo: refund.merchantRefundNo,
      },
      queried,
      refund.merchantRefundNo.startsWith('AS-'),
    );
    return true;
  }

  private async resolveRefundPaymentChannel(
    tx: any,
    refund: { orderId: string; paymentId?: string | null },
  ): Promise<string | null> {
    if (refund.paymentId && tx?.payment?.findUnique) {
      const payment = await tx.payment.findUnique({
        where: { id: refund.paymentId },
        select: { channel: true },
      });
      if (payment?.channel) return payment.channel;
    }
    if (tx?.order?.findUnique) {
      const order = await tx.order.findUnique({
        where: { id: refund.orderId },
        select: { checkoutSession: { select: { paymentChannel: true } } },
      });
      return order?.checkoutSession?.paymentChannel ?? null;
    }
    return null;
  }

  private async handleWechatRefundRetryQueryResult(
    refundId: string,
    claim: {
      orderId: string;
      amount: number;
      merchantRefundNo: string;
    },
    queried: {
      outRefundNo: string;
      providerRefundId?: string | null;
      status: string;
      refundAmountFen?: number;
    },
    isAfterSaleRefund: boolean,
  ): Promise<boolean> {
    if (queried.outRefundNo !== claim.merchantRefundNo) {
      this.logger.error(
        `微信退款查单返回退款单号不匹配: refundId=${this.maskBizId(refundId)}, expected=${this.maskBizId(claim.merchantRefundNo)}, got=${this.maskBizId(queried.outRefundNo)}`,
      );
      return true;
    }

    const providerRefundId = queried.providerRefundId || null;
    if (queried.status === 'SUCCESS') {
      if (
        !this.isWechatRefundNotifyAmountValid(
          { amount: claim.amount, merchantRefundNo: claim.merchantRefundNo },
          queried.refundAmountFen,
          claim.merchantRefundNo,
        )
      ) {
        return true;
      }
      if (isAfterSaleRefund) {
        if (!this.afterSaleRefundService) {
          this.logger.error(
            `微信售后退款查单成功但无法闭环：AfterSaleRefundService 未注入 refundId=${this.maskBizId(refundId)}`,
          );
          return true;
        }
        await this.afterSaleRefundService.handleRefundSuccess(refundId, providerRefundId);
      } else {
        await this.updateAutoRefundRecord({
          refundId,
          toStatus: 'REFUNDED',
          fromStatuses: ['REFUNDING'],
          providerRefundId,
          remark: '微信退款查单成功',
        });
      }
      return true;
    }

    if (queried.status === 'PROCESSING') {
      if (isAfterSaleRefund) {
        await this.saveWechatPendingRefundId(refundId, providerRefundId);
        return true;
      }
      await this.updateAutoRefundRecord({
        refundId,
        toStatus: 'REFUNDING',
        fromStatuses: ['REFUNDING'],
        providerRefundId,
        remark: '微信退款查单仍处理中',
      });
      return true;
    }

    if (['CLOSED', 'ABNORMAL', 'FAILED'].includes(queried.status)) {
      if (isAfterSaleRefund && this.afterSaleRefundService) {
        await this.afterSaleRefundService.handleRefundFailure(
          refundId,
          `微信退款失败: ${queried.status}`,
        );
      } else {
        await this.updateAutoRefundRecord({
          refundId,
          toStatus: 'FAILED',
          fromStatuses: ['REFUNDING'],
          providerRefundId,
          remark: `微信退款查单失败: ${queried.status}`,
        });
      }
      return true;
    }

    this.logger.warn(
      `微信退款查单返回未知状态: refundId=${this.maskBizId(refundId)}, status=${queried.status}`,
    );
    return true;
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

    if (merchantOrderNo.startsWith('AS_SHIP_PAY_')) {
      if (!this.afterSaleShippingPaymentService) {
        throw new BadRequestException('售后退货运费支付服务未启用');
      }

      if (status === 'SUCCESS') {
        await this.afterSaleShippingPaymentService.handlePaymentSuccess(
          merchantOrderNo,
          providerTxnId,
          paidAt ? new Date(paidAt) : new Date(),
        );
        return { code: 'SUCCESS', message: '售后退货运费支付成功' };
      }

      await this.afterSaleShippingPaymentService.handlePaymentFailure(
        merchantOrderNo,
        '支付失败',
      );
      return { code: 'SUCCESS', message: '售后退货运费支付失败已记录' };
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
          // 旧 ledger RESERVED→AVAILABLE、VIP 预留释放、红包释放等逻辑统一收口到 CheckoutService。
          await (this.checkoutService as CheckoutService & {
            releaseSessionOnFailure: (merchantOrderNo: string) => Promise<void>;
          }).releaseSessionOnFailure(merchantOrderNo);
          this.logger.warn(
            `CheckoutSession 支付失败：merchantOrderNo=${this.maskBizId(merchantOrderNo)}`,
          );

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
            if (refundResult.pending) {
              await this.updateAutoRefundRecord({
                refundId,
                toStatus: 'REFUNDING',
                fromStatuses: ['REFUNDING', 'FAILED'],
                providerRefundId: refundResult.providerRefundId || null,
                rawNotifyPayload: rawPayload ?? null,
                remark: '微信退款已受理，等待渠道通知',
              });
              await this.prisma.orderStatusHistory.create({
                data: {
                  orderId,
                  fromStatus: 'CANCELED',
                  toStatus: 'CANCELED',
                  reason: '订单取消后支付成功，微信退款已受理，等待渠道通知',
                  meta: {
                    autoRefund: true,
                    providerTxnId,
                    merchantOrderNo,
                    merchantRefundNo,
                    refundId,
                    providerRefundId: refundResult.providerRefundId || null,
                    pending: true,
                  },
                },
              });
            } else {
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
            }
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

  async finalizeAutoRefundRecord(params: {
    refundId: string;
    fromStatuses: string[];
    toStatus: 'REFUNDING' | 'REFUNDED' | 'FAILED';
    remark: string;
    providerRefundId?: string | null;
    rawNotifyPayload?: any;
    operatorId?: string | null;
  }): Promise<boolean> {
    const { refundId, fromStatuses, toStatus, remark, providerRefundId, rawNotifyPayload, operatorId } = params;
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
          operatorId: operatorId ?? this.autoRefundOperator,
        },
      });
      if (toStatus === 'REFUNDED') {
        await this.restoreAutoCancelDeduction(tx, refundId);
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async updateAutoRefundRecord(params: {
    refundId: string;
    fromStatuses: string[];
    toStatus: 'REFUNDING' | 'REFUNDED' | 'FAILED';
    remark: string;
    providerRefundId?: string | null;
    rawNotifyPayload?: any;
    operatorId?: string | null;
  }): Promise<boolean> {
    return this.finalizeAutoRefundRecord(params);
  }

  private async saveWechatPendingRefundId(
    refundId: string,
    providerRefundId: string | null,
  ): Promise<void> {
    if (!providerRefundId) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.refund.updateMany({
        where: { id: refundId, status: 'REFUNDING' },
        data: { providerRefundId },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async restoreAutoCancelDeduction(tx: any, refundId: string): Promise<void> {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        merchantRefundNo: true,
        order: {
          select: {
            id: true,
            checkoutSessionId: true,
            goodsAmount: true,
            discountAmount: true,
          },
        },
      },
    });
    if (!refund?.merchantRefundNo?.startsWith('AUTO-CANCEL-')) return;
    const order = refund.order;
    if (order?.id && this.couponService?.restoreCouponsForOrder) {
      await this.restoreAutoCancelCoupons(tx, order.id, order.checkoutSessionId);
    }
    if (!this.rewardDeductionService) return;
    if (!order?.checkoutSessionId) return;

    const session = await tx.checkoutSession.findUnique({
      where: { id: order.checkoutSessionId },
      select: {
        deductionGroupId: true,
        goodsAmount: true,
        discountAmount: true,
      },
    });
    if (!session?.deductionGroupId || Number(session.discountAmount || 0) <= 0) return;

    const refundedSiblings = await tx.refund.findMany({
      where: {
        status: 'REFUNDED',
        merchantRefundNo: { startsWith: 'AUTO-CANCEL-' },
        order: { checkoutSessionId: order.checkoutSessionId },
      },
      select: {
        order: { select: { goodsAmount: true } },
      },
    });
    const cumulativeGoodsRefundAmount = Number(
      refundedSiblings
        .reduce((sum: number, item: any) => sum + Number(item.order?.goodsAmount || 0), 0)
        .toFixed(2),
    );

    await this.rewardDeductionService.refundDeduction(tx, {
      refundId,
      orderId: order.id,
      originalGoodsAmount: Number(session.goodsAmount || order.goodsAmount || 0),
      originalGoodsRefundAmount: Number(order.goodsAmount || 0),
      originalDeductAmount: Number(session.discountAmount || order.discountAmount || 0),
      deductionGroupId: session.deductionGroupId,
      cumulativeGoodsRefundAmount,
      isFinalRefund: cumulativeGoodsRefundAmount >= Number(session.goodsAmount || 0),
    });
  }

  private async restoreAutoCancelCoupons(
    tx: any,
    orderId: string,
    checkoutSessionId?: string | null,
  ): Promise<void> {
    if (!this.couponService?.restoreCouponsForOrder) return;
    if (!checkoutSessionId) {
      await this.couponService.restoreCouponsForOrder(orderId, tx);
      return;
    }

    const sessionOrders = await tx.order.findMany({
      where: { checkoutSessionId },
      select: { id: true },
    });
    const sessionOrderIds = sessionOrders.map((item: { id: string }) => item.id);
    if (sessionOrderIds.length <= 1) {
      await this.couponService.restoreCouponsForOrder(orderId, tx);
      return;
    }

    const autoRefunds = await tx.refund.findMany({
      where: {
        orderId: { in: sessionOrderIds },
        merchantRefundNo: { startsWith: 'AUTO-CANCEL-' },
      },
      select: { orderId: true, status: true },
    });
    const refundedOrderIds = new Set(
      autoRefunds
        .filter((item: { orderId: string; status: string }) => item.status === 'REFUNDED')
        .map((item: { orderId: string }) => item.orderId),
    );
    if (!sessionOrderIds.every((id: string) => refundedOrderIds.has(id))) return;

    for (const id of sessionOrderIds) {
      await this.couponService.restoreCouponsForOrder(id, tx);
    }
  }

  /**
   * 公开 wrapper：在 checkout 主动建单（非 notify 路径）后通知商家。
   * 供 CheckoutService.cancelSession / CheckoutExpireService.expireSession 在
   * 检测到已支付主动建单后调用，补 notifySellersForOrders 缺口。
   */
  public async notifyMerchantsForOrders(orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) return;
    await this.notifySellersForOrders(orderIds);
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
