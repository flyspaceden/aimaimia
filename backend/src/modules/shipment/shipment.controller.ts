import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  UseGuards,
  Logger,
  Query,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { Kuaidi100Service, Kuaidi100CallbackPayload } from './kuaidi100.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';
import { ShipmentCallbackDto } from './dto/shipment-callback.dto';

@Controller('shipments')
export class ShipmentController {
  private readonly logger = new Logger(ShipmentController.name);

  constructor(
    private shipmentService: ShipmentService,
    private kuaidi100Service: Kuaidi100Service,
  ) {}

  /** 查询订单物流 */
  @Get(':orderId')
  getByOrderId(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.shipmentService.getByOrderId(orderId, userId);
  }

  /** 主动查询快递100物流轨迹并更新本地数据 */
  @Get(':orderId/track')
  queryTrackingFromKuaidi100(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.shipmentService.queryTrackingFromKuaidi100(orderId, userId);
  }

  /**
   * P1-2: 物流状态回调（通用 stub）
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

  /**
   * 快递100推送回调端点
   * 快递100订阅后会主动推送物流状态变更到此地址
   * 必须返回 { result: true, returnCode: "200", message: "成功" } 否则快递100会持续重试
   */
  @Public()
  @UseGuards(WebhookIpGuard)
  @Post('kuaidi100/callback')
  async handleKuaidi100Callback(
    @Body() body: Kuaidi100CallbackPayload,
    @Query('token') token?: string,
  ) {
    try {
      const parsed = this.kuaidi100Service.parseCallbackPayload(body);
      if (!parsed) {
        this.logger.warn('快递100回调数据解析失败，返回成功以停止重试');
        return { result: true, returnCode: '200', message: '成功' };
      }

      // 将快递100推送数据转换为系统内部回调格式处理
      await this.shipmentService.handleKuaidi100Callback(
        parsed.trackingNo,
        parsed.status,
        parsed.events,
        body,
        token,
      );
    } catch (error: any) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      // 区分可重试和不可重试的异常
      // NotFoundException（单号不存在）等业务异常不需要重试
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        this.logger.warn(`快递100回调业务异常（不重试）: ${error.message}`);
        // 返回200停止重试，避免无意义的重复推送
      } else {
        // 数据库超时、序列化冲突等瞬态异常，返回非200让快递100重试
        this.logger.error(`快递100回调处理异常（将重试）: ${error.message || error}`);
        return { result: false, returnCode: '500', message: '服务暂时不可用，请稍后重试' };
      }
    }

    // 快递100要求固定返回格式
    return { result: true, returnCode: '200', message: '成功' };
  }
}
