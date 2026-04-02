import { Controller, Get, Post, Param, Body, Headers, UseGuards } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { ShipmentCallbackDto } from './dto/shipment-callback.dto';

@Controller('shipments')
export class ShipmentController {
  constructor(private shipmentService: ShipmentService) {}

  /** 查询订单物流 */
  @Get(':orderId')
  getByOrderId(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.shipmentService.getByOrderId(orderId, userId);
  }

  /**
   * P1-2: 物流状态回调（stub）
   * 生产环境由物流服务商推送调用，需验证来源 IP + 签名
   */
  @Public()
  @UseGuards(WebhookIpGuard)
  @Post('callback')
  handleCallback(
    @Body() body: ShipmentCallbackDto,
    @Headers('x-webhook-signature') webhookSignature?: string,
    @Headers('x-logistics-signature') logisticsSignature?: string,
    @Headers('x-signature') signature?: string,
  ) {
    const headerSignature = webhookSignature || logisticsSignature || signature;
    return this.shipmentService.handleCallback(
      body.trackingNo,
      body.status,
      body.events,
      body.rawPayload ?? body,
      headerSignature || body.signature,
    );
  }
}
