import { BadRequestException, Body, Controller, Get, Headers, Logger, NotFoundException, Optional, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Request, Response } from 'express';
import { PaymentService } from './payment.service';
import { AlipayService } from './alipay.service';
import { WechatPayService } from './wechat-pay.service';
import { CheckoutService } from '../order/checkout.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { PaymentCallbackDto } from './dto/payment-callback.dto';

type WithdrawPayoutRuntimeService = {
  finalizeWithdrawalPaid(
    withdrawId: string,
    providerResult: { providerOrderId?: string; providerFundOrderId?: string },
  ): Promise<void>;
  finalizeWithdrawalFailed(
    withdrawId: string,
    failure: { errorCode?: string; errorMessage?: string; providerStatus?: string },
  ): Promise<void>;
};

@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private paymentService: PaymentService,
    private alipayService: AlipayService,
    // P5 第三轮 finding F3：notify 路径金额校验需要查 session
    private checkoutService: CheckoutService,
    @Optional() private moduleRef?: ModuleRef,
    @Optional() private prisma?: PrismaService,
    @Optional() private wechatPayService?: WechatPayService,
  ) {}

  /** 查询订单支付记录 */
  @Get('order/:orderId')
  getByOrderId(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.paymentService.getByOrderId(orderId, userId);
  }

  /**
   * S04修复：支付回调端点（通用 / 开发环境模拟用）
   */
  @Public()
  @UseGuards(WebhookIpGuard)
  @Post('callback')
  handleCallback(
    @Body() body: PaymentCallbackDto,
    @Headers('x-webhook-signature') webhookSignature?: string,
    @Headers('x-payment-signature') paymentSignature?: string,
    @Headers('x-signature') signature?: string,
  ) {
    const headerSignature = webhookSignature || paymentSignature || signature;
    return this.paymentService.handlePaymentCallback({
      ...body,
      signature: headerSignature || body.signature,
    });
  }

  /**
   * 支付宝异步通知回调
   * - 支付宝以 application/x-www-form-urlencoded 方式 POST
   * - 必须返回纯文本 "success" 表示处理成功，否则支付宝会重试
   */
  @Public()
  @UseGuards(WebhookIpGuard)
  @Post('alipay/notify')
  async handleAlipayNotify(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    this.logger.log(`收到支付宝异步通知: out_trade_no=${body.out_trade_no}`);

    // 1. 验签
    const verified = await this.alipayService.verifyNotify(body);
    if (!verified) {
      // 诊断日志：把完整 notify body 打出来，便于定位是哪个字段导致签名不一致
      // ⚠️ 仅沙箱诊断用，含交易明细，上线前必须移除
      this.logger.error(
        `支付宝异步通知验签失败 | out_trade_no=${body.out_trade_no} | ` +
        `字段数=${Object.keys(body).length} | 空字段=[${Object.entries(body).filter(([_, v]) => !v).map(([k]) => k).join(',')}] | ` +
        `完整 body (JSON): ${JSON.stringify(body)}`,
      );
      res.status(200).send('failure');
      return;
    }

    // 2. 转换为内部回调格式，交给统一的支付回调处理
    const tradeStatus = body.trade_status;

    // WAIT_BUYER_PAY: 用户还没付款，不需要处理，直接返回 success
    if (tradeStatus === 'WAIT_BUYER_PAY') {
      this.logger.log(`支付宝通知: 等待买家付款 out_trade_no=${body.out_trade_no}`);
      res.status(200).send('success');
      return;
    }

    const status: 'SUCCESS' | 'FAILED' =
      tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
        ? 'SUCCESS'
        : 'FAILED';

    // 3. 金额校验（仅 SUCCESS 类才校验，FAILED 单不需要）
    // P5 第三轮 finding F3：notify 路径之前漏了金额校验，与 active-query 不一致 → 安全漏洞
    // 现在两个路径共用 PaymentService.assertAlipayAmountMatchesSession
    if (status === 'SUCCESS') {
      if (body.out_trade_no?.startsWith('AS_SHIP_PAY_')) {
        try {
          await this.paymentService.assertAfterSaleShippingPaymentAmountMatches(
            body.out_trade_no,
            body.total_amount,
          );
        } catch (amountErr: any) {
          this.logger.error(
            `支付宝 notify 售后退货运费金额校验失败，已拒绝处理：${amountErr.message} ` +
            `out_trade_no=${body.out_trade_no} total_amount=${body.total_amount}`,
          );
          res.status(200).send(amountErr instanceof BadRequestException ? 'success' : 'failure');
          return;
        }
      } else {
        let session: Awaited<ReturnType<CheckoutService['findByMerchantOrderNo']>>;
        try {
          session = await this.checkoutService.findByMerchantOrderNo(body.out_trade_no);
        } catch (lookupErr: any) {
          this.logger.error(
            `支付宝 notify 查询 CheckoutSession 异常，返回 failure 让支付宝重试：${lookupErr.message} ` +
            `out_trade_no=${body.out_trade_no}`,
          );
          res.status(200).send('failure');
          return;
        }

        // session 不存在时跳过校验（可能是旧 Order 流程，由 handlePaymentCallback 自己处理）
        if (session) {
          try {
            this.paymentService.assertAlipayAmountMatchesSession(
              { expectedTotal: session.expectedTotal, merchantOrderNo: session.merchantOrderNo },
              body.total_amount,
              'notify',
            );
          } catch (amountErr: any) {
            // 金额校验失败：不建单 + 仍返 success 给支付宝避免无限重试 + 留 error 日志等运营介入
            this.logger.error(
              `支付宝 notify 金额校验失败，已拒绝建单：${amountErr.message} ` +
              `out_trade_no=${body.out_trade_no} total_amount=${body.total_amount}`,
            );
            res.status(200).send('success');
            return;
          }
        }
      }
    }

    try {
      await this.paymentService.handlePaymentCallback({
        merchantOrderNo: body.out_trade_no,
        providerTxnId: body.trade_no,
        status,
        paidAt: body.gmt_payment ? new Date(body.gmt_payment).toISOString() : undefined,
        rawPayload: body,
        skipSignatureVerification: true, // 已在上方用支付宝证书验签
      });
      res.status(200).send('success');
    } catch (err: any) {
      this.logger.error(`处理支付宝通知异常: ${err.message}`);
      // 返回 failure 让支付宝重试
      res.status(200).send('failure');
    }
  }

  /**
   * 微信支付异步通知回调
   * - req.rawBody 用于微信 v3 RSA 验签，不能用 JSON 重新序列化后的 body
   * - 成功处理统一 200 空 body ack；身份或验签失败返回 401 FAIL
   */
  @Public()
  @UseGuards(WebhookIpGuard)
  @Post('wechat/notify')
  async handleWechatNotify(
    @Body() body: Record<string, any>,
    @Req() req: Request & { rawBody?: Buffer | string },
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ) {
    if (!this.wechatPayService) {
      res.status(401).send({ code: 'FAIL', message: '微信支付服务未启用' });
      return;
    }

    const rawBody = this.normalizeRawBody(req.rawBody);
    if (!rawBody) {
      res.status(401).send({ code: 'FAIL', message: '微信支付通知缺少 rawBody' });
      return;
    }

    let notify: any;
    try {
      notify = await this.wechatPayService.parseNotify({
        body,
        rawBody,
        headers: this.normalizeWechatNotifyHeaders(headers),
      });
    } catch (err: any) {
      const message = err?.message || '微信支付通知验签失败';
      this.logger.error(`微信支付通知解析失败: ${message}`);
      res.status(401).send({ code: 'FAIL', message });
      return;
    }

    if (!this.assertWechatNotifyIdentity(notify)) {
      this.logger.error(
        `微信支付通知身份不匹配: type=${notify?.type || 'UNKNOWN'} outTradeNo=${notify?.outTradeNo || 'N/A'}`,
      );
      res.status(401).send({ code: 'FAIL', message: '微信支付通知身份不匹配' });
      return;
    }

    if (notify.type === 'refund') {
      await this.paymentService.handleWechatRefundNotify({
        outTradeNo: notify.outTradeNo,
        outRefundNo: notify.outRefundNo,
        providerRefundId: notify.providerTxnId,
        tradeState: notify.tradeState,
        amountFen: notify.amountFen,
        totalAmountFen: notify.totalAmountFen,
        rawPayload: body,
      });
      res.status(200).send();
      return;
    }

    if (notify.type !== 'payment') {
      res.status(401).send({ code: 'FAIL', message: '微信支付通知类型不支持' });
      return;
    }

    const status: 'SUCCESS' | 'FAILED' = notify.tradeState === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
    if (status === 'SUCCESS') {
      try {
        if (notify.outTradeNo?.startsWith('AS_SHIP_PAY_')) {
          await this.paymentService.assertWechatAfterSaleShippingPaymentAmountMatches(
            notify.outTradeNo,
            notify.amountFen,
          );
        } else {
          const session = await this.checkoutService.findByMerchantOrderNo(notify.outTradeNo);
          if (session) {
            this.paymentService.assertWechatAmountMatchesSession(
              { expectedTotal: session.expectedTotal, merchantOrderNo: session.merchantOrderNo },
              notify.amountFen,
              'notify',
            );
          } else {
            await this.paymentService.assertWechatPaymentAmountMatches(
              notify.outTradeNo,
              notify.amountFen,
            );
          }
        }
      } catch (amountErr: any) {
        if (amountErr instanceof BadRequestException || amountErr instanceof NotFoundException) {
          this.logger.error(
            `微信 notify 金额校验失败，已拒绝处理：${amountErr.message} ` +
            `out_trade_no=${notify.outTradeNo} amountFen=${notify.amountFen}`,
          );
          res.status(200).send();
          return;
        }
        throw amountErr;
      }
    }

    await this.paymentService.handlePaymentCallback({
      merchantOrderNo: notify.outTradeNo,
      providerTxnId: notify.providerTxnId,
      status,
      paidAt: this.normalizeNotifyPaidAt(notify.paidAt),
      rawPayload: body,
      skipSignatureVerification: true,
    });
    res.status(200).send();
  }

  /**
   * 支付宝转账异步通知回调。
   *
   * PaymentModule 不 import BonusModule；提现闭环服务通过 ModuleRef 在运行期解析，
   * 避免 Payment → Order → Bonus → Payment 的构造期循环依赖。
   */
  @Public()
  @UseGuards(WebhookIpGuard)
  @Post('alipay/transfer-notify')
  async handleAlipayTransferNotify(
    @Body() body: Record<string, string>,
    @Res() res: Response,
  ) {
    this.logger.log(
      `收到支付宝转账通知: msg_method=${body.msg_method || 'N/A'}, notify_id=${body.notify_id || 'N/A'}`,
    );

    const verified = await this.alipayService.verifyNotify(body);
    if (!verified) {
      this.logger.error(
        `支付宝转账通知验签失败: msg_method=${body.msg_method || 'N/A'}, 字段数=${Object.keys(body).length}`,
      );
      res.status(200).send('failure');
      return;
    }

    if (body.msg_method !== 'alipay.fund.trans.order.changed') {
      res.status(200).send('success');
      return;
    }

    let biz: Record<string, any>;
    try {
      biz = JSON.parse(body.biz_content);
    } catch {
      this.logger.error('支付宝转账通知 biz_content 解析失败');
      res.status(200).send('failure');
      return;
    }

    const outBizNo = biz.out_biz_no || biz.outBizNo;
    if (!outBizNo) {
      this.logger.error('支付宝转账通知缺少 out_biz_no');
      res.status(200).send('failure');
      return;
    }

    if (!this.prisma) {
      this.logger.error('PrismaService 未注入，无法处理支付宝转账通知');
      res.status(200).send('failure');
      return;
    }

    let withdraw: any;
    try {
      withdraw = await (this.prisma as any).withdrawRequest.findFirst({
        where: { outBizNo },
      });
    } catch (err: any) {
      this.logger.error(`查询 WithdrawRequest 异常: ${err.message}`);
      res.status(200).send('failure');
      return;
    }

    if (!withdraw) {
      this.logger.warn(`未找到 WithdrawRequest: out_biz_no=${outBizNo}`);
      res.status(200).send('success');
      return;
    }

    if (withdraw.status !== 'PROCESSING') {
      res.status(200).send('success');
      return;
    }

    try {
      const withdrawPayoutService = this.getWithdrawPayoutService();
      const providerStatus = biz.status;
      if (providerStatus === 'SUCCESS') {
        await withdrawPayoutService.finalizeWithdrawalPaid(withdraw.id, {
          providerOrderId: biz.order_id || biz.orderId,
          providerFundOrderId: biz.pay_fund_order_id || biz.payFundOrderId,
        });
      } else if (
        providerStatus === 'FAIL' ||
        providerStatus === 'FAILED' ||
        providerStatus === 'CLOSED'
      ) {
        await withdrawPayoutService.finalizeWithdrawalFailed(withdraw.id, {
          errorCode: biz.error_code || biz.errorCode,
          errorMessage:
            biz.fail_reason ||
            biz.failReason ||
            biz.error_msg ||
            biz.errorMessage ||
            `支付宝转账 ${providerStatus}`,
          providerStatus,
        });
      }
      res.status(200).send('success');
    } catch (err: any) {
      this.logger.error(`处理支付宝转账通知异常: ${err.message}`);
      res.status(200).send('failure');
    }
  }

  private getWithdrawPayoutService(): WithdrawPayoutRuntimeService {
    if (!this.moduleRef) {
      throw new Error('ModuleRef 未注入，无法解析 WithdrawPayoutService');
    }

    const tokens = this.getWithdrawPayoutServiceTokens();
    let lastError: unknown;
    for (const token of tokens) {
      try {
        const service = this.moduleRef.get<WithdrawPayoutRuntimeService>(token, { strict: false });
        if (service) return service;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error('WithdrawPayoutService 未注册');
  }

  private getWithdrawPayoutServiceTokens(): any[] {
    const tokens: any[] = [];
    try {
      const withdrawPayoutModule = require('../bonus/withdraw-payout.service') as {
        WithdrawPayoutService?: any;
      };
      if (withdrawPayoutModule.WithdrawPayoutService) {
        tokens.push(withdrawPayoutModule.WithdrawPayoutService);
      }
    } catch {
      // Parallel reward work may create this provider after the payment slice lands.
    }
    tokens.push('WithdrawPayoutService');
    return tokens;
  }

  private normalizeRawBody(rawBody?: Buffer | string): string | null {
    if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
    if (typeof rawBody === 'string' && rawBody.length > 0) return rawBody;
    return null;
  }

  private normalizeWechatNotifyHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): {
    signature?: string;
    timestamp?: string;
    nonce?: string;
    serial?: string;
  } {
    const pick = (name: string): string | undefined => {
      const value = headers[name] ?? headers[name.toLowerCase()];
      if (Array.isArray(value)) return value[0];
      return value;
    };

    return {
      signature: pick('wechatpay-signature'),
      timestamp: pick('wechatpay-timestamp'),
      nonce: pick('wechatpay-nonce'),
      serial: pick('wechatpay-serial'),
    };
  }

  private assertWechatNotifyIdentity(notify: any): boolean {
    const expectedMchId = this.wechatPayService?.getMchId();
    if (!expectedMchId || notify?.mchId !== expectedMchId) return false;
    if (notify?.type === 'refund') return true;

    const expectedAppId = this.wechatPayService?.getAppId();
    return Boolean(expectedAppId && notify?.appId === expectedAppId);
  }

  private normalizeNotifyPaidAt(paidAt?: Date | string | null): string | undefined {
    if (!paidAt) return undefined;
    if (paidAt instanceof Date) return paidAt.toISOString();
    return paidAt;
  }
}
