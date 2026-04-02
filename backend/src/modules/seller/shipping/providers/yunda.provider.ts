import { Injectable, Logger } from '@nestjs/common';
import {
  ShippingProvider,
  CreateWaybillParams,
  CreateWaybillResult,
} from '../shipping-provider.interface';

/**
 * 韵达快递适配器（占位实现）
 * TODO: 对接真实API — 韵达开放平台 https://open.yundaex.com
 */
@Injectable()
export class YundaProvider implements ShippingProvider {
  private readonly logger = new Logger(YundaProvider.name);

  readonly carrierCode = 'YUNDA';
  readonly carrierName = '韵达快递';

  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    // TODO: 对接真实API — 调用韵达电子面单接口
    this.logger.log(`[占位] 韵达创建面单: ${params.recipientName} ${params.recipientAddress}`);
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000).toString();
    return {
      waybillNo: `YUNDA0000${randomSuffix}`,
      waybillImageUrl: `https://oss.placeholder.com/waybill/yunda/YUNDA0000${randomSuffix}.png`,
    };
  }

  async cancelWaybill(waybillNo: string): Promise<void> {
    // TODO: 对接真实API — 调用韵达取消面单接口
    this.logger.log(`[占位] 韵达取消面单: ${waybillNo}`);
  }

  async subscribeTracking(waybillNo: string, callbackUrl: string): Promise<void> {
    // TODO: 对接真实API — 调用韵达轨迹订阅接口
    this.logger.log(`[占位] 韵达订阅轨迹: ${waybillNo} -> ${callbackUrl}`);
  }
}
