import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
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
  // Bug 4: 移除 WebhookIpGuard —— 顺丰推送源 IP 不固定（多机房+CDN），
  // IP 白名单会误杀正常推送。安全依赖 msgDigest 签名验证（标准MD5算法，无 checkWord 无法伪造）
  @Public()
  @Post('sf/callback')
  async handleSfCallback(
    @Body() body: any,
    @Req() req: any,
  ) {
    try {
      // SF 推送 body 是 form-urlencoded（msgData / timestamp / msgDigest / serviceCode 等）
      const msgDataStr: string =
        typeof body?.msgData === 'string' ? body.msgData : JSON.stringify(body?.msgData ?? '');
      const timestamp: string =
        body?.timestamp || req.headers?.['service-timestamp'] || '';
      const pushDigest: string =
        body?.msgDigest || req.headers?.['x-sf-digest'] || '';

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
        msgDataStr,
        timestamp,
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
