import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/** 快递100状态码 → 系统 ShipmentStatus 映射 */
export type Kuaidi100MappedStatus = 'SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' | 'EXCEPTION';

/** 快递100查询结果 */
export interface Kuaidi100TrackingResult {
  status: Kuaidi100MappedStatus;
  rawState: string;
  events: Array<{
    time: string;
    message: string;
    location?: string;
  }>;
}

/** 快递100订阅结果 */
export interface Kuaidi100SubscribeResult {
  success: boolean;
  returnCode: string;
  message: string;
}

/** 快递100推送回调负载 */
export interface Kuaidi100CallbackPayload {
  status: string;
  billstatus: string;
  message: string;
  lastResult: {
    message: string;
    nu: string;
    ischeck: string;
    com: string;
    status: string;
    state: string;
    data: Array<{
      time: string;
      context: string;
      ftime: string;
      areaCode?: string;
      areaName?: string;
      status?: string;
    }>;
  };
}

@Injectable()
export class Kuaidi100Service {
  private readonly logger = new Logger(Kuaidi100Service.name);

  /** 系统快递编码 → 快递100快递编码映射 */
  public static readonly CARRIER_MAP: Record<string, string> = {
    SF: 'shunfeng',
    YTO: 'yuantong',
    ZTO: 'zhongtong',
    STO: 'shentong',
    YUNDA: 'yunda',
    JD: 'jd',
    EMS: 'ems',
  };

  /** 系统快递编码 → 中文名称 */
  public static readonly CARRIER_NAME_MAP: Record<string, string> = {
    SF: '顺丰速运',
    YTO: '圆通快递',
    ZTO: '中通快递',
    STO: '申通快递',
    YUNDA: '韵达快递',
    JD: '京东物流',
    EMS: 'EMS',
  };

  /** 快递100 state 码 → 系统 ShipmentStatus */
  private static readonly STATE_MAP: Record<string, Kuaidi100MappedStatus> = {
    '0': 'IN_TRANSIT',   // 在途
    '1': 'SHIPPED',      // 揽收
    '2': 'EXCEPTION',    // 疑难
    '3': 'DELIVERED',    // 签收
    '4': 'EXCEPTION',    // 退签
    '5': 'IN_TRANSIT',   // 派件
    '6': 'EXCEPTION',    // 退回
    '7': 'IN_TRANSIT',   // 转投
    '10': 'IN_TRANSIT',  // 待清关
    '11': 'IN_TRANSIT',  // 清关中
    '12': 'IN_TRANSIT',  // 已清关
    '13': 'EXCEPTION',   // 清关异常
    '14': 'EXCEPTION',   // 拒签
  };

  private readonly customer: string;
  private readonly key: string;
  private readonly callbackUrl: string;
  private readonly callbackToken: string;

  constructor(private configService: ConfigService) {
    this.customer = this.configService.get<string>('KUAIDI100_CUSTOMER', '');
    this.key = this.configService.get<string>('KUAIDI100_KEY', '');
    this.callbackUrl = this.configService.get<string>('KUAIDI100_CALLBACK_URL', '');
    this.callbackToken = this.configService.get<string>('KUAIDI100_CALLBACK_TOKEN', '');

    if (!this.customer || !this.key) {
      this.logger.warn('快递100凭证未配置（KUAIDI100_CUSTOMER / KUAIDI100_KEY），物流查询功能不可用');
    }
  }

  /** 检查快递100服务是否已配置 */
  isConfigured(): boolean {
    return !!(this.customer && this.key);
  }

  /**
   * 实时查询物流轨迹
   * @param carrierCode 系统快递编码（SF/YTO/ZTO 等）
   * @param trackingNo 快递单号
   * @param phone 手机号（顺丰必填，取后4位）
   */
  async queryTracking(
    carrierCode: string,
    trackingNo: string,
    phone?: string,
  ): Promise<Kuaidi100TrackingResult | null> {
    if (!this.isConfigured()) {
      this.logger.warn('快递100未配置，跳过物流查询');
      return null;
    }

    const com = Kuaidi100Service.CARRIER_MAP[carrierCode];
    if (!com) {
      this.logger.warn(`不支持的快递编码: ${carrierCode}`);
      return null;
    }

    // 构建 param JSON
    const paramObj: Record<string, string> = { com, num: trackingNo };
    // 顺丰需要手机号后4位
    if (phone && carrierCode === 'SF') {
      paramObj.phone = phone.slice(-4);
    }
    const param = JSON.stringify(paramObj);

    // 签名: MD5(param + key + customer)，大写十六进制
    const sign = crypto
      .createHash('md5')
      .update(param + this.key + this.customer)
      .digest('hex')
      .toUpperCase();

    try {
      const response = await fetch('https://poll.kuaidi100.com/poll/query.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          customer: this.customer,
          sign,
          param,
        }).toString(),
        signal: AbortSignal.timeout(10000), // 10秒超时
      });

      if (!response.ok) {
        this.logger.error(`快递100查询HTTP错误: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();

      // 快递100错误响应（status 非 200 表示查询失败）
      if (data.status && data.status !== '200') {
        this.logger.warn(
          `快递100查询失败: status=${data.status}, message=${data.message || '未知错误'}`,
        );
        return null;
      }

      // 解析状态
      const rawState = String(data.state ?? '');
      const status = Kuaidi100Service.STATE_MAP[rawState] || 'IN_TRANSIT';

      // 解析物流事件
      const events = (data.data || []).map(
        (item: { ftime?: string; time?: string; context?: string; areaName?: string }) => ({
          time: item.ftime || item.time || '',
          message: item.context || '',
          location: item.areaName || undefined,
        }),
      );

      return { status, rawState, events };
    } catch (error: any) {
      // 网络/超时等错误不应导致整个请求崩溃
      this.logger.error(`快递100查询异常: ${error.message || error}`);
      return null;
    }
  }

  /**
   * 订阅物流推送（快递100主动推送物流变更）
   * @param carrierCode 系统快递编码
   * @param trackingNo 快递单号
   * @param callbackUrl 回调地址（留空则使用环境变量配置）
   * @param phone 手机号（顺丰必填）
   */
  async subscribe(
    carrierCode: string,
    trackingNo: string,
    callbackUrl?: string,
    phone?: string,
  ): Promise<Kuaidi100SubscribeResult | null> {
    const finalCallbackUrl = this.buildSignedCallbackUrl(callbackUrl || this.callbackUrl);
    if (!finalCallbackUrl) {
      this.logger.debug('快递100回调地址未配置（KUAIDI100_CALLBACK_URL），跳过订阅');
      return null;
    }

    if (!this.isConfigured()) {
      this.logger.warn('快递100未配置，跳过物流订阅');
      return null;
    }

    const com = Kuaidi100Service.CARRIER_MAP[carrierCode];
    if (!com) {
      this.logger.warn(`不支持的快递编码: ${carrierCode}，跳过订阅`);
      return null;
    }

    // 构建订阅参数
    const paramObj: Record<string, any> = {
      company: com,
      number: trackingNo,
      key: this.key,
      parameters: {
        callbackurl: finalCallbackUrl,
      },
    };
    // 顺丰需要手机号后4位
    if (phone && carrierCode === 'SF') {
      paramObj.parameters.phone = phone.slice(-4);
    }

    try {
      const response = await fetch('https://poll.kuaidi100.com/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          schema: 'json',
          param: JSON.stringify(paramObj),
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        this.logger.error(`快递100订阅HTTP错误: ${response.status} ${response.statusText}`);
        return { success: false, returnCode: String(response.status), message: 'HTTP请求失败' };
      }

      const data = await response.json();

      const success = data.result === true && data.returnCode === '200';
      if (!success) {
        this.logger.warn(
          `快递100订阅失败: returnCode=${data.returnCode}, message=${data.message || '未知错误'}`,
        );
      } else {
        this.logger.log(`快递100订阅成功: ${carrierCode} ${trackingNo.slice(0, 4)}****`);
      }

      return {
        success,
        returnCode: data.returnCode || '',
        message: data.message || '',
      };
    } catch (error: any) {
      this.logger.error(`快递100订阅异常: ${error.message || error}`);
      return { success: false, returnCode: 'ERROR', message: error.message || '网络异常' };
    }
  }

  /**
   * 解析快递100推送回调数据
   * 将快递100格式转换为系统内部格式
   */
  parseCallbackPayload(
    payload: Kuaidi100CallbackPayload,
  ): { trackingNo: string; status: Kuaidi100MappedStatus; events: Array<{ time: string; message: string; location?: string }> } | null {
    try {
      const lastResult = payload?.lastResult;
      if (!lastResult || !lastResult.nu) {
        this.logger.warn('快递100回调缺少 lastResult 或单号');
        return null;
      }

      const rawState = String(lastResult.state ?? '');
      const status = Kuaidi100Service.STATE_MAP[rawState] || 'IN_TRANSIT';

      const events = (lastResult.data || []).map(
        (item) => ({
          time: item.ftime || item.time || '',
          message: item.context || '',
          location: item.areaName || undefined,
        }),
      );

      return {
        trackingNo: lastResult.nu,
        status,
        events,
      };
    } catch (error: any) {
      this.logger.error(`解析快递100回调数据异常: ${error.message || error}`);
      return null;
    }
  }

  private buildSignedCallbackUrl(baseUrl: string): string {
    if (!baseUrl || !this.callbackToken) {
      return baseUrl;
    }

    try {
      const url = new URL(baseUrl);
      if (!url.searchParams.has('token')) {
        url.searchParams.set('token', this.callbackToken);
      }
      return url.toString();
    } catch {
      this.logger.warn('KUAIDI100_CALLBACK_URL 不是合法 URL，跳过 token 拼接');
      return baseUrl;
    }
  }
}
