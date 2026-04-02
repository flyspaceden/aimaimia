import { Injectable, Logger } from '@nestjs/common';
import {
  ShippingProvider,
  CreateWaybillParams,
  CreateWaybillResult,
} from '../shipping-provider.interface';

/**
 * EMS 中国邮政速递适配器（占位实现）
 * TODO: 对接真实API — 中国邮政速递开放平台
 */
@Injectable()
export class EmsProvider implements ShippingProvider {
  private readonly logger = new Logger(EmsProvider.name);

  readonly carrierCode = 'EMS';
  readonly carrierName = 'EMS';

  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    // TODO: 对接真实API — 调用 EMS 电子面单接口
    this.logger.log(`[占位] EMS 创建面单: ${params.recipientName} ${params.recipientAddress}`);
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000).toString();
    return {
      waybillNo: `EMS0000${randomSuffix}`,
      waybillImageUrl: `https://oss.placeholder.com/waybill/ems/EMS0000${randomSuffix}.png`,
    };
  }

  async cancelWaybill(waybillNo: string): Promise<void> {
    // TODO: 对接真实API — 调用 EMS 取消面单接口
    this.logger.log(`[占位] EMS 取消面单: ${waybillNo}`);
  }

  async subscribeTracking(waybillNo: string, callbackUrl: string): Promise<void> {
    // TODO: 对接真实API — 调用 EMS 轨迹订阅接口
    this.logger.log(`[占位] EMS 订阅轨迹: ${waybillNo} -> ${callbackUrl}`);
  }
}
