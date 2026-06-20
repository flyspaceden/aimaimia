import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  Logger,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ShipmentService } from './shipment.service';
import { SfExpressService } from './sf-express.service';
import { DeliverySfCallbackService } from './delivery-sf-callback.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

// SF V1 文档要求回调返回 XML：<Response><Head>OK</Head></Response>
// V2 沙箱实测虽支持 JSON 但 V1 文档为权威；返 XML 兼容两版
const SF_PUSH_RESPONSE_OK = '<Response><Head>OK</Head></Response>';
const SF_PUSH_RESPONSE_ERR = '<Response><Head>ERR</Head></Response>';

@Controller('shipments')
export class ShipmentController {
  private readonly logger = new Logger(ShipmentController.name);

  constructor(
    private shipmentService: ShipmentService,
    private sfExpress: SfExpressService,
    private deliverySfCallbackService?: DeliverySfCallbackService,
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
   * 顺丰路由推送回调端点
   *
   * Bug 4: 不用 WebhookIpGuard（SF 源 IP 不固定）
   * Bug 87: 用 URL 路径 secret token 防伪造（SF 推送无签名机制）
   * Bug 70-补丁: parsePushPayload 返回数组（一次推送可包含多个 mailno，最多 10 条）
   * Bug 36: 返 SF V1 文档要求的 XML `<Response><Head>OK</Head></Response>`（兼容性最稳）
   */
  @Public()
  @Post('sf/callback/:token')
  async handleSfCallback(
    @Param('token') token: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');

    if (!this.sfExpress.verifyPushToken(token)) {
      this.logger.warn('顺丰推送 token 校验失败，拒绝');
      // 401 + ERR 让 SF 不再重推（认证失败是配置问题，重推无意义）
      return res.status(401).send(SF_PUSH_RESPONSE_ERR);
    }

    const payloads = this.sfExpress.parsePushPayload(body);
    if (payloads.length === 0) {
      this.logger.warn('顺丰推送解析为空（可能格式不符或无路由）');
      return res.status(200).send(SF_PUSH_RESPONSE_OK);
    }

    // 逐个处理，单个失败不影响其他
    for (const payload of payloads) {
      try {
        await this.shipmentService.handleSfCallback(
          payload.trackingNo,
          payload.status,
          payload.events,
          body,
        );
      } catch (error: any) {
        if (error instanceof NotFoundException) {
          try {
            await this.deliverySfCallbackService?.handleSfCallback(
              payload.trackingNo,
              payload.status,
              payload.events,
              body,
            );
            continue;
          } catch (deliveryError: any) {
            if (deliveryError instanceof NotFoundException) {
              this.logger.warn(
                `顺丰推送 trackingNo=${payload.trackingNo} 不在主库/配送库（可能是历史单或测试数据），跳过`,
              );
              continue;
            }
            if (deliveryError instanceof BadRequestException) {
              this.logger.warn(
                `顺丰推送配送业务异常（不重试）: trackingNo=${payload.trackingNo}, ${deliveryError.message}`,
              );
              continue;
            }
            this.logger.error(
              `顺丰推送配送处理异常（将重试）: trackingNo=${payload.trackingNo}, ${deliveryError.message || deliveryError}`,
            );
            return res.status(500).send(SF_PUSH_RESPONSE_ERR);
          }
        }
        if (error instanceof BadRequestException) {
          this.logger.warn(
            `顺丰推送业务异常（不重试）: trackingNo=${payload.trackingNo}, ${error.message}`,
          );
          continue;
        }
        // 系统异常返 ERR + 5xx 让 SF 重推
        this.logger.error(
          `顺丰推送处理异常（将重试）: trackingNo=${payload.trackingNo}, ${error.message || error}`,
        );
        return res.status(500).send(SF_PUSH_RESPONSE_ERR);
      }
    }

    return res.status(200).send(SF_PUSH_RESPONSE_OK);
  }
}
