import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { PaymentCallbackDto } from './dto/payment-callback.dto';

@Controller('payments')
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  /** 查询订单支付记录 */
  @Get('order/:orderId')
  getByOrderId(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.paymentService.getByOrderId(orderId, userId);
  }

  /**
   * S04修复：支付回调端点
   * - @Public() 绕过 JWT 认证
   * - WebhookIpGuard 限制来源 IP（生产环境必须配置 WEBHOOK_IP_WHITELIST）
   * - PaymentService.verifySignature 验证 HMAC 签名（生产环境 fail-closed）
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
}
