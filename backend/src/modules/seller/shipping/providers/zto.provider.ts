import { Injectable, Logger } from '@nestjs/common';
import {
  ShippingProvider,
  CreateWaybillParams,
  CreateWaybillResult,
} from '../shipping-provider.interface';

/**
 * 中通快递适配器（占位实现）
 * TODO: 对接真实API — 中通开放平台 https://open.zto.com
 */
@Injectable()
export class ZtoProvider implements ShippingProvider {
  private readonly logger = new Logger(ZtoProvider.name);

  readonly carrierCode = 'ZTO';
  readonly carrierName = '中通快递';

  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    // TODO: 对接真实API — 调用中通电子面单接口
    this.logger.log(`[占位] 中通创建面单: ${params.recipientName} ${params.recipientAddress}`);
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000).toString();
    return {
      waybillNo: `ZTO0000${randomSuffix}`,
      waybillImageUrl: `https://oss.placeholder.com/waybill/zto/ZTO0000${randomSuffix}.png`,
    };
  }

  async cancelWaybill(waybillNo: string): Promise<void> {
    // TODO: 对接真实API — 调用中通取消面单接口
    this.logger.log(`[占位] 中通取消面单: ${waybillNo}`);
  }

  async subscribeTracking(waybillNo: string, callbackUrl: string): Promise<void> {
    // TODO: 对接真实API — 调用中通轨迹订阅接口
    this.logger.log(`[占位] 中通订阅轨迹: ${waybillNo} -> ${callbackUrl}`);
  }
}
