import { Injectable, Logger } from '@nestjs/common';
import {
  ShippingProvider,
  CreateWaybillParams,
  CreateWaybillResult,
} from '../shipping-provider.interface';

/**
 * 京东物流适配器（占位实现）
 * TODO: 对接真实API — 京东物流开放平台 https://open.jdl.com
 */
@Injectable()
export class JdProvider implements ShippingProvider {
  private readonly logger = new Logger(JdProvider.name);

  readonly carrierCode = 'JD';
  readonly carrierName = '京东物流';

  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    // TODO: 对接真实API — 调用京东物流电子面单接口
    this.logger.log(`[占位] 京东物流创建面单: ${params.recipientName} ${params.recipientAddress}`);
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000).toString();
    return {
      waybillNo: `JD0000${randomSuffix}`,
      waybillImageUrl: `https://oss.placeholder.com/waybill/jd/JD0000${randomSuffix}.png`,
    };
  }

  async cancelWaybill(waybillNo: string): Promise<void> {
    // TODO: 对接真实API — 调用京东物流取消面单接口
    this.logger.log(`[占位] 京东物流取消面单: ${waybillNo}`);
  }

  async subscribeTracking(waybillNo: string, callbackUrl: string): Promise<void> {
    // TODO: 对接真实API — 调用京东物流轨迹订阅接口
    this.logger.log(`[占位] 京东物流订阅轨迹: ${waybillNo} -> ${callbackUrl}`);
  }
}
