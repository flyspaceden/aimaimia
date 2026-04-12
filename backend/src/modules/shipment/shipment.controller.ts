import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { SfExpressService } from './sf-express.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookIpGuard } from '../../common/guards/webhook-ip.guard';

@Controller('shipments')
export class ShipmentController {
  private readonly logger = new Logger(ShipmentController.name);

  constructor(
    private shipmentService: ShipmentService,
    private sfExpress: SfExpressService,
  ) {}

  /** 查询订单物流 */
  @Get(':orderId')
  getByOrderId(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.shipmentService.getByOrderId(orderId, userId);
  }

  /** 主动查询顺丰物流轨迹并更新本地数据 */
  @Get(':orderId/track')
  queryTracking(
    @CurrentUser('sub') userId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.shipmentService.queryTracking(orderId, userId);
  }

  /**
   * 顺丰推送回调端点
   * 顺丰在物流状态变更时主动推送到此地址
   */
  @Public()
  @UseGuards(WebhookIpGuard)
  @Post('sf/callback')
  async handleSfCallback(
    @Body() body: any,
    @Req() req: any,
  ) {
    try {
      // 获取原始 body 用于签名验证
      const bodyStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body);
      const pushDigest = req.headers?.['x-sf-digest'] || body.msgDigest;

      const parsed = this.sfExpress.parsePushPayload(body);
      if (!parsed) {
        this.logger.warn('顺丰推送数据解析失败');
        return { apiResultCode: 'A1000', apiErrorMsg: '' };
      }

      await this.shipmentService.handleSfCallback(
        parsed.trackingNo,
        parsed.status,
        parsed.events,
        body,
        bodyStr,
        pushDigest,
      );
    } catch (error: any) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        this.logger.warn(`顺丰推送业务异常（不重试）: ${error.message}`);
      } else {
        this.logger.error(`顺丰推送处理异常（将重试）: ${error.message || error}`);
        return { apiResultCode: 'A1001', apiErrorMsg: '服务暂时不可用' };
      }
    }

    return { apiResultCode: 'A1000', apiErrorMsg: '' };
  }
}
