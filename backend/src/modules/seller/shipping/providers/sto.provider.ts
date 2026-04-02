import { Injectable, Logger } from '@nestjs/common';
import {
  ShippingProvider,
  CreateWaybillParams,
  CreateWaybillResult,
} from '../shipping-provider.interface';

/**
 * 申通快递适配器（占位实现）
 * TODO: 对接真实API — 申通开放平台 https://open.sto.cn
 */
@Injectable()
export class StoProvider implements ShippingProvider {
  private readonly logger = new Logger(StoProvider.name);

  readonly carrierCode = 'STO';
  readonly carrierName = '申通快递';

  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    // TODO: 对接真实API — 调用申通电子面单接口
    this.logger.log(`[占位] 申通创建面单: ${params.recipientName} ${params.recipientAddress}`);
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000).toString();
    return {
      waybillNo: `STO0000${randomSuffix}`,
      waybillImageUrl: `https://oss.placeholder.com/waybill/sto/STO0000${randomSuffix}.png`,
    };
  }

  async cancelWaybill(waybillNo: string): Promise<void> {
    // TODO: 对接真实API — 调用申通取消面单接口
    this.logger.log(`[占位] 申通取消面单: ${waybillNo}`);
  }

  async subscribeTracking(waybillNo: string, callbackUrl: string): Promise<void> {
    // TODO: 对接真实API — 调用申通轨迹订阅接口
    this.logger.log(`[占位] 申通订阅轨迹: ${waybillNo} -> ${callbackUrl}`);
  }
}
