/**
 * 快递服务商接口定义
 * 所有快递服务商适配器必须实现此接口
 */

/** 创建面单参数 */
export interface CreateWaybillParams {
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  items: { name: string; quantity: number; weight?: number }[];
}

/** 创建面单返回结果 */
export interface CreateWaybillResult {
  waybillNo: string;
  waybillImageUrl: string;
}

/** 快递服务商接口 */
export interface ShippingProvider {
  /** 快递公司编码 */
  carrierCode: string;
  /** 快递公司名称 */
  carrierName: string;
  /** 创建电子面单 */
  createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult>;
  /** 取消面单 */
  cancelWaybill(waybillNo: string): Promise<void>;
  /** 订阅物流轨迹推送 */
  subscribeTracking(waybillNo: string, callbackUrl: string): Promise<void>;
}
