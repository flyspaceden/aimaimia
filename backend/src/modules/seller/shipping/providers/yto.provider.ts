import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ShippingProvider,
  CreateWaybillParams,
  CreateWaybillResult,
} from '../shipping-provider.interface';

/**
 * 圆通快递适配器（占位实现）
 *
 * 当前为占位实现，返回模拟面单号和面单图片 URL。
 * 生产环境需对接圆通开放平台真实 API。
 *
 * TODO: 对接真实 API — 圆通开放平台 https://open.yto.net.cn
 *
 * 真实对接步骤：
 * 1. 在圆通开放平台注册开发者账号，获取 appKey + appSecret
 * 2. 调用「创建订单」接口获取运单号
 * 3. 调用「面单打印」接口获取面单 PDF/图片
 * 4. 调用「取消订单」接口取消未揽件订单
 * 5. 调用「轨迹订阅」接口注册物流轨迹推送回调
 *
 * 所需环境变量：
 * - YTO_API_KEY: 圆通开放平台 appKey
 * - YTO_API_SECRET: 圆通开放平台 appSecret
 * - YTO_CUSTOMER_ID: 圆通客户编号（月结账号）
 * - YTO_API_URL: API 地址（默认沙箱: https://openapi-test.yto.net.cn）
 */
@Injectable()
export class YtoProvider implements ShippingProvider {
  private readonly logger = new Logger(YtoProvider.name);

  /** 圆通 API 密钥（占位：未配置时为 undefined） */
  private readonly apiKey?: string;
  /** 圆通 API 密钥（占位：未配置时为 undefined） */
  private readonly apiSecret?: string;
  /** 圆通客户编号 */
  private readonly customerId?: string;
  /** 圆通 API 地址 */
  private readonly apiUrl: string;

  readonly carrierCode = 'YTO';
  readonly carrierName = '圆通快递';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('YTO_API_KEY');
    this.apiSecret = this.configService.get<string>('YTO_API_SECRET');
    this.customerId = this.configService.get<string>('YTO_CUSTOMER_ID');
    this.apiUrl = this.configService.get<string>(
      'YTO_API_URL',
      'https://openapi-test.yto.net.cn',
    );

    if (!this.apiKey || !this.apiSecret) {
      this.logger.warn(
        '圆通 API 密钥未配置（YTO_API_KEY / YTO_API_SECRET），当前使用占位实现',
      );
    }
  }

  /**
   * 创建电子面单
   *
   * TODO: 真实实现需调用圆通「创建订单」接口
   * - 请求方式: POST ${YTO_API_URL}/open/appkey/createOrder
   * - 签名方式: HMAC-MD5(body + appSecret)
   * - 需传入客户编号、寄件人/收件人信息、物品明细
   * - 返回的 waybillNo 为真实圆通运单号（YT 开头 13 位）
   */
  async createWaybill(params: CreateWaybillParams): Promise<CreateWaybillResult> {
    this.logger.log(
      `[占位] 圆通创建面单: 收件人=${params.recipientName}, 地址=${params.recipientAddress}, ` +
      `物品数=${params.items.length}`,
    );

    // TODO: 替换为真实 API 调用
    // const response = await this.callYtoApi('createOrder', {
    //   clientID: this.customerId,
    //   sender: { name: params.senderName, phone: params.senderPhone, address: params.senderAddress },
    //   receiver: { name: params.recipientName, phone: params.recipientPhone, address: params.recipientAddress },
    //   items: params.items.map(i => ({ name: i.name, number: i.quantity, weight: i.weight })),
    // });

    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000).toString();
    return {
      waybillNo: `YTO0000${randomSuffix}`,
      waybillImageUrl: `https://oss.placeholder.com/waybill/yto/YTO0000${randomSuffix}.png`,
    };
  }

  /**
   * 取消面单
   *
   * TODO: 真实实现需调用圆通「取消订单」接口
   * - 仅限未揽件状态的订单可取消
   * - 需传入运单号和取消原因
   */
  async cancelWaybill(waybillNo: string): Promise<void> {
    this.logger.log(`[占位] 圆通取消面单: ${waybillNo}`);

    // TODO: 替换为真实 API 调用
    // await this.callYtoApi('cancelOrder', {
    //   clientID: this.customerId,
    //   waybillNo,
    //   reason: '卖家取消发货',
    // });
  }

  /**
   * 订阅物流轨迹推送
   *
   * TODO: 真实实现需调用圆通「轨迹订阅」接口
   * - 注册推送回调 URL，圆通会在物流节点变更时主动推送
   * - 推送报文需验签
   */
  async subscribeTracking(waybillNo: string, callbackUrl: string): Promise<void> {
    this.logger.log(`[占位] 圆通订阅轨迹: ${waybillNo} -> ${callbackUrl}`);

    // TODO: 替换为真实 API 调用
    // await this.callYtoApi('subscribeRoute', {
    //   clientID: this.customerId,
    //   waybillNo,
    //   callbackUrl,
    // });
  }
}
