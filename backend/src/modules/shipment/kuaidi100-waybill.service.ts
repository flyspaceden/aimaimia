import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Kuaidi100Service } from './kuaidi100.service';

export interface CreateWaybillParams {
  carrierCode: string;
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  cargo: string;
  weight?: number;
  count?: number;
}

export interface CreateWaybillResult {
  waybillNo: string;
  waybillImageUrl: string;
  taskId: string;
}

@Injectable()
export class Kuaidi100WaybillService {
  private readonly logger = new Logger(Kuaidi100WaybillService.name);

  private readonly key: string;
  private readonly secret: string;
  private readonly partnerId: string;
  private readonly partnerKey: string;
  private readonly callbackUrl: string;
  private readonly callbackToken: string;

  constructor(private configService: ConfigService) {
    this.key = this.configService.get<string>('KUAIDI100_KEY', '');
    this.secret = this.configService.get<string>('KUAIDI100_SECRET', '');
    this.partnerId = this.configService.get<string>('KUAIDI100_PARTNER_ID', '');
    this.partnerKey = this.configService.get<string>('KUAIDI100_PARTNER_KEY', '');
    this.callbackUrl = this.configService.get<string>('KUAIDI100_CALLBACK_URL', '');
    this.callbackToken = this.configService.get<string>('KUAIDI100_CALLBACK_TOKEN', '');

    if (!this.key || !this.secret || !this.partnerId) {
      this.logger.warn(
        '快递100电子面单配置不完整（KUAIDI100_KEY / KUAIDI100_SECRET / KUAIDI100_PARTNER_ID），面单功能不可用',
      );
    }
  }

  /** 检查电子面单服务是否已配置 */
  isConfigured(): boolean {
    return !!(this.key && this.secret && this.partnerId);
  }

  /**
   * 创建电子面单
   * 调用快递100电子面单 V2 接口
   */
  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    if (!this.isConfigured()) {
      throw new BadRequestException('快递100电子面单服务未配置，无法生成面单');
    }

    const kuaidicom = Kuaidi100Service.CARRIER_MAP[params.carrierCode.toUpperCase()];
    if (!kuaidicom) {
      throw new BadRequestException(
        `不支持的快递公司编码: ${params.carrierCode}，支持: ${Object.keys(Kuaidi100Service.CARRIER_MAP).join(', ')}`,
      );
    }

    const paramObj: Record<string, any> = {
      printType: 'IMAGE',
      kuaidicom,
      partnerId: this.partnerId,
      partnerKey: this.partnerKey || undefined,
      recMan: {
        name: params.recipientName,
        mobile: params.recipientPhone,
        printAddr: params.recipientAddress,
      },
      sendMan: {
        name: params.senderName,
        mobile: params.senderPhone,
        printAddr: params.senderAddress,
      },
      cargo: params.cargo,
      weight: params.weight ? String(params.weight) : undefined,
      count: String(params.count || 1),
      payType: 'MONTHLY',
      needSubscribe: true,
    };

    // 如果配置了回调地址，设置物流推送回调
    const pollCallBackUrl = this.buildCallbackUrl();
    if (pollCallBackUrl) {
      paramObj.pollCallBackUrl = pollCallBackUrl;
    }

    const param = JSON.stringify(paramObj);
    const t = String(Date.now());
    const sign = crypto
      .createHash('md5')
      .update(param + t + this.key + this.secret)
      .digest('hex')
      .toUpperCase();

    try {
      const response = await fetch('https://api.kuaidi100.com/label/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: this.key,
          sign,
          t,
          method: 'order',
          param,
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        this.logger.error(`快递100面单API HTTP错误: ${response.status} ${response.statusText}`);
        throw new BadRequestException('快递100面单服务请求失败');
      }

      const data = await response.json();

      if (!data.success && data.code !== 200) {
        this.logger.error(
          `快递100面单下单失败: code=${data.code}, message=${data.message || '未知错误'}`,
        );
        throw new BadRequestException(
          `面单生成失败: ${data.message || '快递100返回错误'}`,
        );
      }

      const waybillNo = data.data?.kuaidinum;
      const taskId = data.data?.taskId;
      const label = data.data?.label;

      if (!waybillNo) {
        this.logger.error('快递100面单返回缺少 kuaidinum');
        throw new BadRequestException('面单生成失败: 未获取到快递单号');
      }

      this.logger.log(
        `面单生成成功: carrier=${kuaidicom}, waybillNo=${waybillNo.slice(0, 4)}****`,
      );

      return {
        waybillNo,
        waybillImageUrl: label || '',
        taskId: taskId || '',
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`快递100面单API异常: ${error.message || error}`);
      throw new BadRequestException('快递100面单服务异常，请稍后重试');
    }
  }

  /**
   * 取消面单
   * 调用快递100面单取消接口
   */
  async cancelWaybill(taskId: string): Promise<{ success: boolean }> {
    if (!this.isConfigured() || !taskId) {
      this.logger.warn('面单取消跳过: 服务未配置或缺少 taskId');
      return { success: false };
    }

    const param = JSON.stringify({ taskId });
    const t = String(Date.now());
    const sign = crypto
      .createHash('md5')
      .update(param + t + this.key + this.secret)
      .digest('hex')
      .toUpperCase();

    try {
      const response = await fetch('https://api.kuaidi100.com/label/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: this.key,
          sign,
          t,
          method: 'cancel',
          param,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });

      const data = await response.json();
      const success = data.success === true || data.code === 200;

      if (!success) {
        this.logger.warn(`快递100面单取消失败: code=${data.code}, message=${data.message}`);
      } else {
        this.logger.log(`面单取消成功: taskId=${taskId}`);
      }

      return { success };
    } catch (error: any) {
      this.logger.error(`快递100面单取消异常: ${error.message || error}`);
      return { success: false };
    }
  }

  private buildCallbackUrl(): string {
    if (!this.callbackUrl) return '';
    try {
      const url = new URL(this.callbackUrl);
      if (this.callbackToken && !url.searchParams.has('token')) {
        url.searchParams.set('token', this.callbackToken);
      }
      return url.toString();
    } catch {
      return this.callbackUrl;
    }
  }
}
