import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

// ─── 类型定义 ───────────────────────────────────────────────

/** 顺丰下单入参 */
export interface SfCreateOrderParams {
  orderId: string; // 客户订单号（Shipment.id 或唯一键）
  sender: {
    name: string;
    tel: string;
    province: string;
    city: string;
    district: string;
    detail: string;
  };
  receiver: {
    name: string;
    tel: string;
    province: string;
    city: string;
    district: string;
    detail: string;
  };
  cargo: string; // 商品描述
  totalWeight?: number; // kg
  packageCount?: number;
  monthlyCard?: string; // 月结账号，默认用 SF_MONTHLY_ACCOUNT
  payMethod?: number; // 1=寄方付（默认）
  expressTypeId?: number; // 1=顺丰标快（默认），2=顺丰特惠
  isReturnRoutelabel?: number; // 1=返回电子面单路由标签
}

/** 顺丰下单返回 */
export interface SfCreateOrderResult {
  waybillNo: string;
  sfOrderId: string;
  originCode?: string;
  destCode?: string;
  filterResult?: string;
}

/** 顺丰路由查询结果 */
export interface SfRouteResult {
  status: SfMappedStatus;
  rawOpCode: string;
  events: Array<{
    time: string;
    message: string;
    location?: string;
    opCode?: string;
  }>;
}

/** 系统内部物流状态 */
export type SfMappedStatus =
  | 'SHIPPED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'EXCEPTION';

/** 顺丰推送解析结果 */
export interface SfPushPayload {
  trackingNo: string;
  status: SfMappedStatus;
  events: Array<{
    time: string;
    message: string;
    location?: string;
    opCode?: string;
  }>;
}

// ─── 服务实现 ───────────────────────────────────────────────

@Injectable()
export class SfExpressService {
  private readonly logger = new Logger(SfExpressService.name);

  private readonly sfEnv: string;
  private readonly apiUrl: string;
  private readonly apiUrlUat: string;
  private readonly clientCode: string;
  private readonly checkWord: string;
  private readonly monthlyAccount: string;
  private readonly callbackUrl: string;
  private readonly templateCode: string;

  /**
   * 顺丰 opCode → 系统 ShipmentStatus 映射
   * 参考丰桥文档路由节点操作码
   */
  static readonly OP_CODE_MAP: Record<string, SfMappedStatus> = {
    '50': 'DELIVERED', // 签收
    '44': 'DELIVERED', // 代签
    '80': 'EXCEPTION', // 退签
    '99': 'EXCEPTION', // 退回
    '36': 'EXCEPTION', // 派件异常
    '54': 'EXCEPTION', // 退回签收
    '31': 'IN_TRANSIT', // 派件（派件中为运输中子状态）
    '30': 'IN_TRANSIT', // 正在派送
    '70': 'IN_TRANSIT', // 到达目的地城市
    '60': 'IN_TRANSIT', // 到达中转站
    '21': 'IN_TRANSIT', // 运输中
    '204': 'IN_TRANSIT', // 发出
    '10': 'SHIPPED', // 已揽收
  };

  constructor(private configService: ConfigService) {
    this.sfEnv = this.configService.get<string>('SF_ENV', 'UAT');
    this.apiUrl = this.configService.get<string>(
      'SF_API_URL',
      'https://bsp-oisp.sf-express.com/std/service',
    );
    this.apiUrlUat = this.configService.get<string>(
      'SF_API_URL_UAT',
      'https://sfapi-sbox.sf-express.com/std/service',
    );
    this.clientCode = this.configService.get<string>('SF_CLIENT_CODE', '');
    this.checkWord = this.configService.get<string>('SF_CHECK_WORD', '');
    this.monthlyAccount = this.configService.get<string>(
      'SF_MONTHLY_ACCOUNT',
      '',
    );
    this.callbackUrl = this.configService.get<string>('SF_CALLBACK_URL', '');
    this.templateCode = this.configService.get<string>(
      'SF_TEMPLATE_CODE',
      'fm_150_standard_HNGHAfep',
    );

    if (!this.isConfigured()) {
      this.logger.warn(
        '顺丰丰桥凭证未配置（SF_CLIENT_CODE / SF_CHECK_WORD / SF_MONTHLY_ACCOUNT），物流功能不可用',
      );
    }
  }

  /** 检查顺丰丰桥服务是否已配置 */
  isConfigured(): boolean {
    return !!(this.clientCode && this.checkWord && this.monthlyAccount);
  }

  /**
   * 丰桥签名算法
   * verifyCode = Base64(MD5(msgData + timestamp + checkWord))
   * 注意：MD5 输出是二进制 digest → Base64，不是 hex string → Base64
   */
  buildVerifyCode(msgData: string, timestamp: string): string {
    const raw = msgData + timestamp + this.checkWord;
    const md5Binary = crypto.createHash('md5').update(raw, 'utf8').digest(); // Buffer
    return md5Binary.toString('base64');
  }

  // ─── 内部 API 调用 ─────────────────────────────────────

  private getEndpoint(): string {
    return this.sfEnv === 'PROD' ? this.apiUrl : this.apiUrlUat;
  }

  /**
   * 通用丰桥 API 调用
   * @returns 解析后的 msgData 对象
   */
  private async callApi(serviceCode: string, msgData: any): Promise<any> {
    const msgDataStr = JSON.stringify(msgData);
    const timestamp = String(Date.now());
    const msgDigest = this.buildVerifyCode(msgDataStr, timestamp);

    const body = new URLSearchParams({
      partnerID: this.clientCode,
      requestID: `${this.clientCode}_${timestamp}`,
      serviceCode,
      timestamp,
      msgDigest,
      msgData: msgDataStr,
    });

    const response = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      this.logger.error(
        `顺丰API HTTP错误: ${response.status} ${response.statusText}, serviceCode=${serviceCode}`,
      );
      throw new BadRequestException(
        `顺丰API请求失败: HTTP ${response.status}`,
      );
    }

    const result = await response.json();

    if (result.apiResultCode !== 'A1000') {
      this.logger.error(
        `顺丰API业务错误: code=${result.apiResultCode}, msg=${result.apiErrorMsg}, serviceCode=${serviceCode}`,
      );
      throw new BadRequestException(
        `顺丰API错误: ${result.apiErrorMsg || result.apiResultCode}`,
      );
    }

    // msgData 是 JSON 字符串，需要二次解析
    try {
      return JSON.parse(result.msgData);
    } catch {
      return result.msgData;
    }
  }

  // ─── 下单取号 ─────────────────────────────────────────

  /**
   * 创建顺丰运单（下单取号）
   * 调用 EXP_RECE_CREATE_ORDER
   */
  async createOrder(
    params: SfCreateOrderParams,
  ): Promise<SfCreateOrderResult> {
    // E2E 测试绕过：NODE_ENV==='test' 时返回伪造面单，生产环境不可达
    if (process.env.NODE_ENV === 'test') {
      const ts = Date.now();
      return {
        waybillNo: `SFE2E${ts}`,
        sfOrderId: `SFORDE2E${ts}`,
        originCode: 'E2E',
        destCode: 'E2E',
        filterResult: '2',
      };
    }

    if (!this.isConfigured()) {
      throw new BadRequestException('顺丰丰桥服务未配置');
    }

    const msgData = {
      language: 'zh-CN',
      orderId: params.orderId,
      monthlyCard: params.monthlyCard || this.monthlyAccount,
      payMethod: params.payMethod ?? 1,
      expressTypeId: params.expressTypeId ?? 1,
      isReturnRoutelabel: params.isReturnRoutelabel ?? 1,
      parcelQty: params.packageCount ?? 1,
      totalWeight: params.totalWeight ?? 1,
      cargoDesc: params.cargo || '农产品',
      contactInfoList: [
        {
          contactType: 1, // 寄件人
          contact: params.sender.name,
          tel: params.sender.tel,
          province: params.sender.province,
          city: params.sender.city,
          county: params.sender.district,
          address: params.sender.detail,
        },
        {
          contactType: 2, // 收件人
          contact: params.receiver.name,
          tel: params.receiver.tel,
          province: params.receiver.province,
          city: params.receiver.city,
          county: params.receiver.district,
          address: params.receiver.detail,
        },
      ],
      // 如果配置了回调URL，让顺丰主动推送物流变更
      ...(this.callbackUrl ? { routeLabelForUpdate: this.callbackUrl } : {}),
    };

    const data = await this.callApi('EXP_RECE_CREATE_ORDER', msgData);

    // 从返回数据中提取运单号
    const waybillNoInfoList = data?.msgData?.waybillNoInfoList
      ?? data?.waybillNoInfoList
      ?? [];
    const firstWaybill = waybillNoInfoList[0] || {};
    const waybillNo = firstWaybill.waybillNo || '';

    if (!waybillNo) {
      this.logger.error(
        `顺丰下单返回缺少运单号: orderId=${params.orderId}, data=${JSON.stringify(data).slice(0, 200)}`,
      );
      throw new BadRequestException('顺丰下单失败: 未获取到运单号');
    }

    this.logger.log(
      `顺丰下单成功: orderId=${params.orderId}, waybillNo=${waybillNo.slice(0, 4)}****`,
    );

    return {
      waybillNo,
      sfOrderId: data?.orderId || params.orderId,
      originCode: data?.originCode || firstWaybill.originCode,
      destCode: data?.destCode || firstWaybill.destCode,
      filterResult: data?.filterResult,
    };
  }

  // ─── 取消订单 ─────────────────────────────────────────

  /**
   * 取消顺丰订单
   * 调用 EXP_RECE_UPDATE_ORDER，dealType=2（取消）
   * 幂等处理：已取消的订单视为成功
   */
  async cancelOrder(
    orderId: string,
    waybillNo: string,
  ): Promise<{ success: boolean }> {
    if (!this.isConfigured()) {
      this.logger.warn('顺丰丰桥未配置，跳过取消');
      return { success: false };
    }

    const msgData = {
      orderId,
      dealType: 2, // 取消
      waybillNoInfoList: [{ waybillNo }],
    };

    try {
      await this.callApi('EXP_RECE_UPDATE_ORDER', msgData);
      this.logger.log(
        `顺丰订单取消成功: orderId=${orderId}, waybillNo=${waybillNo.slice(0, 4)}****`,
      );
      return { success: true };
    } catch (error: any) {
      // 已取消的订单再次取消，顺丰会返回业务错误，视为幂等成功
      if (
        error?.message?.includes('已取消') ||
        error?.message?.includes('8016') ||
        error?.message?.includes('重复')
      ) {
        this.logger.log(
          `顺丰订单已取消（幂等）: orderId=${orderId}`,
        );
        return { success: true };
      }
      this.logger.error(
        `顺丰取消失败: orderId=${orderId}, error=${error.message}`,
      );
      return { success: false };
    }
  }

  // ─── 路由查询 ─────────────────────────────────────────

  /**
   * 查询物流轨迹
   * 调用 EXP_RECE_SEARCH_ROUTES
   * 顺丰不需要手机号后4位（与快递100不同）
   */
  async queryRoutes(trackingNo: string): Promise<SfRouteResult | null> {
    if (!this.isConfigured()) {
      this.logger.warn('顺丰丰桥未配置，跳过路由查询');
      return null;
    }

    const msgData = {
      language: 'zh-CN',
      trackingType: 1, // 按顺丰运单号查询
      trackingNumber: [trackingNo],
      methodType: 1, // 标准查询
    };

    try {
      const data = await this.callApi('EXP_RECE_SEARCH_ROUTES', msgData);

      const routeResps = data?.routeResps ?? data?.msgData?.routeResps ?? [];
      const firstResp = routeResps[0];
      if (!firstResp || !firstResp.routes || firstResp.routes.length === 0) {
        this.logger.debug(`顺丰路由查询无结果: trackingNo=${trackingNo.slice(0, 4)}****`);
        return null;
      }

      // 取最新事件的 opCode 作为整体状态
      const latestRoute = firstResp.routes[0]; // routes 按时间倒序
      const rawOpCode = String(latestRoute.opCode ?? '');
      const status =
        SfExpressService.OP_CODE_MAP[rawOpCode] || 'IN_TRANSIT';

      const events = firstResp.routes.map(
        (r: any) => ({
          time: r.acceptTime || '',
          message: r.remark || r.acceptAddress || '',
          location: r.acceptAddress || undefined,
          opCode: String(r.opCode ?? ''),
        }),
      );

      return { status, rawOpCode, events };
    } catch (error: any) {
      this.logger.error(
        `顺丰路由查询异常: trackingNo=${trackingNo.slice(0, 4)}****, error=${error.message}`,
      );
      return null;
    }
  }

  // ─── 推送回调解析 ─────────────────────────────────────

  /**
   * 解析顺丰推送回调数据
   * 顺丰推送格式：body 中包含 msgData JSON 字符串
   * msgData 内含 waybillNo + routeList
   */
  parsePushPayload(body: any): SfPushPayload | null {
    try {
      let msgData = body?.msgData;
      if (typeof msgData === 'string') {
        try {
          msgData = JSON.parse(msgData);
        } catch {
          this.logger.warn('顺丰推送 msgData 解析失败');
          return null;
        }
      }

      if (!msgData) {
        this.logger.warn('顺丰推送缺少 msgData');
        return null;
      }

      const waybillNo = msgData.waybillNo || msgData.mailNo || '';
      if (!waybillNo) {
        this.logger.warn('顺丰推送缺少 waybillNo');
        return null;
      }

      const routeList: any[] = msgData.routeList || msgData.routes || [];
      const latestRoute = routeList[0];
      const rawOpCode = String(latestRoute?.opCode ?? '');
      const status =
        SfExpressService.OP_CODE_MAP[rawOpCode] || 'IN_TRANSIT';

      const events = routeList.map((r: any) => ({
        time: r.acceptTime || '',
        message: r.remark || r.acceptAddress || '',
        location: r.acceptAddress || undefined,
        opCode: String(r.opCode ?? ''),
      }));

      return { trackingNo: waybillNo, status, events };
    } catch (error: any) {
      this.logger.error(
        `解析顺丰推送数据异常: ${error.message || error}`,
      );
      return null;
    }
  }

  // ─── 云打印面单 ───────────────────────────────────────

  /**
   * 云打印面单
   * 调用 COM_RECE_CLOUD_PRINT_WAYBILLS
   * 返回面单 PDF 的 Base64 编码
   */
  async printWaybill(waybillNo: string): Promise<{ pdfBase64: string }> {
    if (!this.isConfigured()) {
      throw new BadRequestException('顺丰丰桥服务未配置');
    }

    const msgData = {
      templateCode: this.templateCode,
      version: '2.0',
      fileType: 'pdf',
      sync: true,
      documents: [
        {
          masterWaybillNo: waybillNo,
        },
      ],
    };

    const data = await this.callApi('COM_RECE_CLOUD_PRINT_WAYBILLS', msgData);

    // 顺丰返回结构可能不同版本略有差异，做多种路径兼容
    const fileBase64 = data?.obj?.files?.[0]?.token
      || data?.obj?.files?.[0]?.url
      || data?.files?.[0]?.token
      || data?.files?.[0]?.fileBase64;

    if (!fileBase64) {
      this.logger.error(`顺丰面单打印返回缺少文件数据: waybillNo=${waybillNo}`);
      throw new BadRequestException('面单打印失败: 未获取到面单文件');
    }

    return { pdfBase64: fileBase64 };
  }

  /**
   * 验证顺丰推送签名
   * 推送签名 = Base64(MD5(bodyString + checkWord))
   * 注意：推送签名没有 timestamp，与请求签名不同
   */
  verifyPushSignature(bodyString: string, pushDigest?: string): boolean {
    if (!pushDigest) {
      this.logger.warn('顺丰推送缺少签名');
      return false;
    }

    const expected = crypto
      .createHash('md5')
      .update(bodyString + this.checkWord, 'utf8')
      .digest('base64');

    return expected === pushDigest;
  }
}
