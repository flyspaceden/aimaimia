import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ShippingProvider,
  CreateWaybillParams,
  CreateWaybillResult,
} from '../shipping-provider.interface';

/**
 * 顺丰速运适配器（占位实现）
 *
 * 当前为占位实现，返回模拟面单号和面单图片 URL。
 * 生产环境需对接顺丰开放平台真实 API。
 *
 * TODO: 对接真实 API — 顺丰开放平台 https://open.sf-express.com
 *
 * 真实对接步骤：
 * 1. 在顺丰开放平台注册开发者账号，获取 appId + appSecret
 * 2. 调用「下单」接口 (EXP_RECE_CREATE_ORDER) 创建运单
 * 3. 调用「面单打印」接口 (COM_RECE_CLOUD_PRINT_WAYBILLS) 获取面单图片
 * 4. 调用「订单取消」接口 (EXP_RECE_UPDATE_ORDER) 取消未揽件订单
 * 5. 调用「路由注册」接口 (EXP_RECE_SEARCH_ROUTES) 订阅物流轨迹推送
 *
 * 所需环境变量：
 * - SF_API_KEY: 顺丰开放平台 appId
 * - SF_API_SECRET: 顺丰开放平台 appSecret
 * - SF_MONTHLY_CARD: 月结卡号（寄付必须）
 * - SF_API_URL: API 地址（默认沙箱: https://sfapi-sbox.sf-express.com）
 */
@Injectable()
export class SfProvider implements ShippingProvider {
  private readonly logger = new Logger(SfProvider.name);

  /** 顺丰 API 密钥（占位：未配置时为 undefined） */
  private readonly apiKey?: string;
  /** 顺丰 API 密钥（占位：未配置时为 undefined） */
  private readonly apiSecret?: string;
  /** 顺丰月结卡号 */
  private readonly monthlyCard?: string;
  /** 顺丰 API 地址 */
  private readonly apiUrl: string;

  readonly carrierCode = 'SF';
  readonly carrierName = '顺丰速运';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('SF_API_KEY');
    this.apiSecret = this.configService.get<string>('SF_API_SECRET');
    this.monthlyCard = this.configService.get<string>('SF_MONTHLY_CARD');
    this.apiUrl = this.configService.get<string>(
      'SF_API_URL',
      'https://sfapi-sbox.sf-express.com',
    );

    if (!this.apiKey || !this.apiSecret) {
      this.logger.warn(
        '顺丰 API 密钥未配置（SF_API_KEY / SF_API_SECRET），当前使用占位实现',
      );
    }
  }

  /**
   * 创建电子面单
   *
   * TODO: 真实实现需调用顺丰 EXP_RECE_CREATE_ORDER 接口
   * - 请求方式: POST ${SF_API_URL}/std/service
   * - 签名方式: HMAC-SHA256(body + timestamp + apiSecret)
   * - 需传入月结卡号、寄件人/收件人信息、物品明细
   * - 返回的 waybillNo 为真实顺丰运单号（SF 开头 12 位）
   */
  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    this.logger.log(
      `[占位] 顺丰创建面单: 收件人=${params.recipientName}, 地址=${params.recipientAddress}, ` +
      `物品数=${params.items.length}`,
    );

    // TODO: 替换为真实 API 调用
    // const response = await this.callSfApi('EXP_RECE_CREATE_ORDER', {
    //   language: 'zh-CN',
    //   orderId: generateOrderId(),
    //   cargoDetails: params.items.map(i => ({ name: i.name, count: i.quantity, weight: i.weight })),
    //   contactInfoList: [
    //     { contactType: 1, contact: params.senderName, tel: params.senderPhone, address: params.senderAddress },
    //     { contactType: 2, contact: params.recipientName, tel: params.recipientPhone, address: params.recipientAddress },
    //   ],
    //   monthlyCard: this.monthlyCard,
    // });

    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000).toString();
    return {
      waybillNo: `SF0000${randomSuffix}`,
      waybillImageUrl: `https://oss.placeholder.com/waybill/sf/SF0000${randomSuffix}.png`,
    };
  }

  /**
   * 取消面单
   *
   * TODO: 真实实现需调用顺丰 EXP_RECE_UPDATE_ORDER 接口
   * - dealType 设为 2（取消订单）
   * - 仅限未揽件状态的订单可取消
   */
  async cancelWaybill(waybillNo: string): Promise<void> {
    this.logger.log(`[占位] 顺丰取消面单: ${waybillNo}`);

    // TODO: 替换为真实 API 调用
    // await this.callSfApi('EXP_RECE_UPDATE_ORDER', {
    //   dealType: 2,
    //   waybillNoInfoList: [{ waybillNo }],
    // });
  }

  /**
   * 订阅物流轨迹推送
   *
   * TODO: 真实实现需调用顺丰路由推送注册接口 EXP_RECE_SEARCH_ROUTES
   * - 注册推送回调 URL，顺丰会在物流节点变更时主动推送
   * - 推送报文需验签（HMAC-SHA256）
   */
  async subscribeTracking(waybillNo: string, callbackUrl: string): Promise<void> {
    this.logger.log(`[占位] 顺丰订阅轨迹: ${waybillNo} -> ${callbackUrl}`);

    // TODO: 替换为真实 API 调用
    // await this.callSfApi('EXP_RECE_SEARCH_ROUTES', {
    //   trackingType: 1,
    //   trackingNumber: [waybillNo],
    //   methodType: 1,
    // });
  }
}
