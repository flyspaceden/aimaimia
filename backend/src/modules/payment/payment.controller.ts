import { Body, Controller, Get, Headers, Logger, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PaymentService } from './payment.service';
import { AlipayService } from './alipay.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { PaymentCallbackDto } from './dto/payment-callback.dto';

@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private paymentService: PaymentService,
    private alipayService: AlipayService,
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
}
