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

/** 顺丰云打印面单返回 */
export interface SfPrintWaybillResult {
  pdfUrl: string;
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

/** 顺丰推送解析结果（按 mailno 分组的单个 payload） */
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
  private readonly allowE2eMock: boolean;
  private readonly pushSecret: string;

  /**
   * 顺丰 opCode → 系统 ShipmentStatus 映射
   *
   * 真实来源（Bug 93 修订，2026-05-06）:
   * - 丰桥统一接入平台对接规范 PDF 示例：opcode="50" remark="已派件" / opcode="80" remark="已签收"
   * - 丰桥平台 API 接口规范 V3.8 PDF 示例：opcode="50" remark="已收件"
   * - 第三方对接经验（psvmc.cn 2024-10）：50=揽收, 80=签收, 8000=订单结束
   *
   * 注意：SF 不在公开 PDF 完整发布 opCode → 含义表，PDF 明示"可从顺丰商务人员处获取"。
   * 50/80 已实证；其他映射为推断值，待 SF 商务确认完整对照表后逐条核实。
   */
  static readonly OP_CODE_MAP: Record<string, SfMappedStatus> = {
    // ─── 已实证（SF 官方 PDF 示例 + 第三方多源印证）─────────
    '50': 'SHIPPED',     // 已收件 / 揽收（Bug 93 修复：原误为 DELIVERED）
    '80': 'DELIVERED',   // 已签收（Bug 93 修复：原误为 EXCEPTION）

    // ─── 推断映射（待 SF 商务确认完整对照表）─────────────
    '44': 'DELIVERED',   // 代签
    '99': 'EXCEPTION',   // 退回
    '36': 'EXCEPTION',   // 派件异常
    '54': 'EXCEPTION',   // 退回签收 / 拒收
    '31': 'IN_TRANSIT',  // 派件
    '30': 'IN_TRANSIT',  // 派送中
    '70': 'IN_TRANSIT',  // 到达目的地城市
    '60': 'IN_TRANSIT',  // 到达中转站

    // ─── 留观（官方 PDF 未出现，疑似当年抄错；保留以避免回归，待 SF 商务核实后删除）
    '10': 'SHIPPED',
    '21': 'IN_TRANSIT',
    '204': 'IN_TRANSIT',

    // ─── 生命周期标记（不是业务终态）────────────────────
    // 8000 = 订单结束（psvmc.cn 实证），通常在 80 签收之后才推送；
    // 单独出现时只能保守视为 IN_TRANSIT；同组内若存在业务终态，状态由业务终态派生。
    '8000': 'IN_TRANSIT',
  };

  private static readonly LIFECYCLE_ONLY_OP_CODES = new Set(['8000']);

  private static readonly BUSINESS_TERMINAL_OP_CODES = new Set([
    '80',
    '44',
    '99',
    '36',
    '54',
  ]);

  /**
   * 安全映射 opCode：未知 opCode 默认 IN_TRANSIT 并 warn
   * Bug 93 加固：避免静默把未知 opCode 当成 IN_TRANSIT，便于真实运营时发现新 opCode
   */
  private mapOpCodeSafe(rawOpCode: string): SfMappedStatus {
    const mapped = SfExpressService.OP_CODE_MAP[rawOpCode];
    if (mapped) return mapped;
    this.logger.warn(
      `未知 SF opCode '${rawOpCode}'，回退 IN_TRANSIT。请联系顺丰商务确认其含义并补入 OP_CODE_MAP`,
    );
    return 'IN_TRANSIT';
  }

  /**
   * 从同一运单的一组路由中派生业务状态。
   * routes 必须已按 acceptTime 倒序排序；8000 是 SF 生命周期标记，不覆盖同组 80/99 等业务终态。
   */
  private deriveRouteStatus(routes: any[]): { status: SfMappedStatus; rawOpCode: string } {
    const latestRoute = routes[0];
    const latestRawOpCode = String(latestRoute?.opCode ?? '');
    if (!SfExpressService.LIFECYCLE_ONLY_OP_CODES.has(latestRawOpCode)) {
      return {
        rawOpCode: latestRawOpCode,
        status: this.mapOpCodeSafe(latestRawOpCode),
      };
    }

    const businessRoutes = routes.filter(
      (r) => !SfExpressService.LIFECYCLE_ONLY_OP_CODES.has(String(r?.opCode ?? '')),
    );
    const terminalRoute = businessRoutes.find((r) =>
      SfExpressService.BUSINESS_TERMINAL_OP_CODES.has(String(r?.opCode ?? '')),
    );
    const statusSource = terminalRoute ?? businessRoutes[0] ?? latestRoute;
    const rawOpCode = String(statusSource?.opCode ?? '');

    return {
      rawOpCode,
      status: this.mapOpCodeSafe(rawOpCode),
    };
  }

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

    // Bug 68: 月结账号按 SF_ENV 区分（沙箱用通用测试卡 7551234567，生产用真实月结）
    const monthlyUat = this.configService.get<string>(
      'SF_MONTHLY_ACCOUNT_UAT',
      '',
    );
    const monthlyProd = this.configService.get<string>(
      'SF_MONTHLY_ACCOUNT_PROD',
      '',
    );
    const monthlyLegacy = this.configService.get<string>('SF_MONTHLY_ACCOUNT', '');
    this.monthlyAccount =
      this.sfEnv === 'PROD'
        ? monthlyProd || monthlyLegacy
        : monthlyUat || monthlyLegacy;

    this.callbackUrl = this.configService.get<string>('SF_CALLBACK_URL', '');
    this.templateCode = this.configService.get<string>(
      'SF_TEMPLATE_CODE',
      '',
    );

    // Bug 7: E2E mock 必须由独立开关启用，仅在非生产环境生效
    this.allowE2eMock =
      this.sfEnv !== 'PROD' &&
      process.env.NODE_ENV !== 'production' &&
      this.configService.get<string>('SF_ALLOW_E2E_MOCK', 'false') === 'true';

    // Bug 87: 路由推送 webhook 用 URL secret token 防伪造
    // SF 没有签名机制，靠 token 路径段双源信任（SF 后台 + .env 独立泄露才能伪造）
    this.pushSecret = this.configService.get<string>('SF_PUSH_SECRET', '');

    // 生产环境必须配置 SF_PUSH_SECRET，否则推送链路全失效
    // 改为 throw 阻止启动 — 推送静默失败 N 小时后才发现的代价远高于一次部署告警
    if (
      process.env.NODE_ENV === 'production' &&
      this.sfEnv === 'PROD' &&
      !this.pushSecret?.trim()
    ) {
      const msg =
        'SF_PUSH_SECRET 未配置，生产环境路由推送将全部 401 — 拒绝启动，请在 .env 设置 32 位随机十六进制 secret 后重试';
      this.logger.error(msg);
      throw new Error(msg);
    } else if (!this.pushSecret?.trim()) {
      this.logger.warn(
        'SF_PUSH_SECRET 未配置（非生产环境），路由推送 token 校验将一律拒绝',
      );
    }

    // Bug 71: 启动期校验 templateCode 必须以 clientCode 结尾（顺丰自动加 _<clientCode> 后缀）
    if (this.clientCode && this.templateCode) {
      if (!this.templateCode.endsWith(`_${this.clientCode}`)) {
        this.logger.error(
          `SF_TEMPLATE_CODE 配置错误：必须以 _${this.clientCode} 结尾（当前：${this.templateCode}）。请到丰桥控制台「电子面单 → 模板配置」查看真实模板编码。`,
        );
        throw new Error(
          `SF_TEMPLATE_CODE 必须以 _${this.clientCode} 结尾，当前值：${this.templateCode}`,
        );
      }
    }

    if (!this.isConfigured()) {
      this.logger.warn(
        '顺丰丰桥凭证未配置（SF_CLIENT_CODE / SF_CHECK_WORD / SF_MONTHLY_ACCOUNT_UAT|PROD），物流功能不可用',
      );
    }
  }

  /** 检查顺丰丰桥服务是否已配置 */
  isConfigured(): boolean {
    return !!(this.clientCode && this.checkWord && this.monthlyAccount);
  }

  /**
   * Java URLEncoder 等价编码
   * Java URLEncoder.encode 与 JS encodeURIComponent 在 6 个字符上有差异：
   * - 空格：Java 编码为 +，JS 编码为 %20
   * - !'()~：Java 编码，JS 不编码
   * 顺丰丰桥服务端用 Java URLEncoder，签名必须保持一致
   */
  private javaUrlEncode(s: string): string {
    return encodeURIComponent(s)
      .replace(/%20/g, '+')
      .replace(/!/g, '%21')
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/~/g, '%7E');
  }

  /**
   * 丰桥标准 MD5 签名算法
   * msgDigest = Base64(MD5(URLEncoder.encode(msgData + timestamp + checkWord, "UTF-8")))
   * 关键：先 URL 编码再 MD5，缺这一步会导致中文/特殊字符签名错误
   */
  buildVerifyCode(msgData: string, timestamp: string): string {
    const raw = msgData + timestamp + this.checkWord;
    const encoded = this.javaUrlEncode(raw);
    const md5Binary = crypto.createHash('md5').update(encoded, 'utf8').digest();
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

    // Bug 70: V2 响应字段是 apiResultData（JSON 字符串），不是 msgData
    // success/errorCode 才是业务结果判断字段，apiResultCode 仅 A1000 表示协议层 OK
    if (result.apiResultCode && result.apiResultCode !== 'A1000') {
      this.logger.error(
        `顺丰API协议错误: code=${result.apiResultCode}, msg=${result.apiErrorMsg}, serviceCode=${serviceCode}`,
      );
      throw new BadRequestException(
        `顺丰API错误: ${result.apiErrorMsg || result.apiResultCode}`,
      );
    }

    let parsed: any = null;
    const rawData = result.apiResultData ?? result.msgData;
    if (typeof rawData === 'string') {
      try {
        parsed = JSON.parse(rawData);
      } catch {
        parsed = rawData;
      }
    } else {
      parsed = rawData;
    }

    // success/errorCode 在解析后的 apiResultData 内（V2 响应格式）
    // 防御纵深：success===false 或 errorCode 显式非 S0000 都算业务错误
    // （某些边缘响应可能 success 字段缺失但 errorCode 已填非 S0000）
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.success === false ||
        (parsed.errorCode && parsed.errorCode !== 'S0000'))
    ) {
      this.logger.error(
        `顺丰API业务错误: errorCode=${parsed.errorCode}, errorMsg=${parsed.errorMsg}, serviceCode=${serviceCode}`,
      );
      throw new BadRequestException(
        `顺丰API错误: ${parsed.errorMsg || parsed.errorCode || '未知错误'}`,
      );
    }

    // 返回完整的 apiResultData 解析对象（包含 msgData / obj 等业务字段，由调用方按 serviceCode 选择）
    return parsed;
  }

  // ─── 下单取号 ─────────────────────────────────────────

  /**
   * 创建顺丰运单（下单取号）
   * 调用 EXP_RECE_CREATE_ORDER
   */
  async createOrder(
    params: SfCreateOrderParams,
  ): Promise<SfCreateOrderResult> {
    // Bug 7: E2E mock 仅在 SF_ALLOW_E2E_MOCK=true 且非生产环境时启用
    if (this.allowE2eMock && process.env.NODE_ENV === 'test') {
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

    // Bug 3: routeLabelForUpdate 不是 EXP_RECE_CREATE_ORDER 的合法字段，
    // 推送通过丰桥后台「订阅服务 → 路由订阅」配置回调地址，不在下单参数里传
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
    };

    const data = await this.callApi('EXP_RECE_CREATE_ORDER', msgData);

    // V2 响应：apiResultData → msgData → waybillNoInfoList
    const inner = data?.msgData ?? data;
    const waybillNoInfoList = inner?.waybillNoInfoList ?? [];
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
      sfOrderId: inner?.orderId || params.orderId,
      originCode: inner?.originCode || firstWaybill.originCode,
      destCode: inner?.destCode || firstWaybill.destCode,
      filterResult: inner?.filterResult,
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

      const inner = data?.msgData ?? data;
      const routeResps = inner?.routeResps ?? [];
      const firstResp = routeResps[0];
      if (!firstResp || !firstResp.routes || firstResp.routes.length === 0) {
        this.logger.debug(`顺丰路由查询无结果: trackingNo=${trackingNo.slice(0, 4)}****`);
        return null;
      }

      // 显式按 acceptTime 倒序（不依赖 SF API 返回顺序，与 parseWaybillRoutes 对齐）
      // Bug 93 加固：原代码注释「按时间倒序」但实际没排序，SF API 偶发乱序时 routes[0] 会拿到非最新事件
      const sortedRoutes = [...firstResp.routes].sort((a: any, b: any) =>
        String(b.acceptTime ?? '').localeCompare(String(a.acceptTime ?? '')),
      );

      const { rawOpCode, status } = this.deriveRouteStatus(sortedRoutes);

      const events = sortedRoutes.map(
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
   * 解析顺丰路由推送负载
   *
   * 真实结构（沙箱实证 2026-05-05）:
   *   { Body: { WaybillRoute: [{ mailno, acceptTime, acceptAddress, remark, opCode, id, orderid, ...}] } }
   *
   * 没有签名包裹（msgData/timestamp/msgDigest 不存在），认证靠 URL token（Bug 87）。
   * 单次推送可包含多个不同 mailno 的路由（最多 10 条），按 mailno 分组成多个 SfPushPayload。
   */
  parsePushPayload(body: any): SfPushPayload[] {
    try {
      // 路径 1: WaybillRoute（路由推送 — 物理事件 揽收/在途/派送/签收）
      const routes: any[] = body?.Body?.WaybillRoute ?? [];
      if (Array.isArray(routes) && routes.length > 0) {
        return this.parseWaybillRoutes(routes);
      }

      // 路径 2: OrderState（订单状态推送 — SF 内部状态 下单已接收/调度成功 等）
      // 沙箱实证 2026-05-07: { Body: { OrderState: [{ orderNo, waybillNo, orderStateCode, orderStateDesc, ... }] } }
      // 也有顶层 orderState 的变体（不带 Body 包裹）
      const orderStates: any[] = body?.Body?.OrderState ?? body?.orderState ?? [];
      if (Array.isArray(orderStates) && orderStates.length > 0) {
        return this.parseOrderStates(orderStates);
      }

      // 都没匹配：debug 级别日志，不再 warn 刷屏
      this.logger.debug(
        `顺丰推送 body 不含 WaybillRoute / OrderState：${JSON.stringify(body ?? {}).slice(0, 500)}`,
      );
      return [];
    } catch (error: any) {
      this.logger.error(
        `解析顺丰推送数据异常: ${error.message || error}`,
      );
      return [];
    }
  }

  private parseWaybillRoutes(routes: any[]): SfPushPayload[] {
    // 按 mailno 分组（同一运单的多条路由合并到一个 payload）
    const grouped = new Map<string, any[]>();
    for (const r of routes) {
      const mailno = String(r?.mailno ?? r?.mailNo ?? '').trim();
      if (!mailno) continue;
      if (!grouped.has(mailno)) grouped.set(mailno, []);
      grouped.get(mailno)!.push(r);
    }

    const payloads: SfPushPayload[] = [];
    for (const [mailno, rs] of grouped) {
      // 按 acceptTime 倒序，最新事件在前
      rs.sort((a, b) =>
        String(b.acceptTime ?? '').localeCompare(String(a.acceptTime ?? '')),
      );
      const latest = rs[0];
      const latestRawOpCode = String(latest?.opCode ?? '');
      const { status } = this.deriveRouteStatus(rs);

      // Bug 93 外审 8 防御性 warn：8000（订单结束）作为最新事件且历史中未见业务终态事件
      // → SF 行为异常（跳过终态事件直接推 8000），订单可能卡 IN_TRANSIT 永不到 DELIVERED
      if (latestRawOpCode === '8000') {
        const hasTerminalEvent = rs.some(
          (r) =>
            SfExpressService.BUSINESS_TERMINAL_OP_CODES.has(String(r.opCode ?? '')),
        );
        if (!hasTerminalEvent) {
          this.logger.warn(
            `SF 异常：mailno=${mailno} 收到 8000(订单结束) 但历史无业务终态事件，订单可能卡 IN_TRANSIT。请人工核查 SF 推送日志`,
          );
        }
      }

      const events = rs.map((r: any) => ({
        time: String(r.acceptTime ?? ''),
        message: String(r.remark ?? r.acceptAddress ?? ''),
        location: r.acceptAddress ? String(r.acceptAddress) : undefined,
        opCode: String(r.opCode ?? ''),
      }));

      payloads.push({ trackingNo: mailno, status, events });
    }
    return payloads;
  }

  /**
   * 解析 OrderState 推送（订单状态推送）
   * 以 waybillNo 分组；状态来自 orderStateCode（04-XXXXX 系列）
   * orderStateCode 主要是 SF 内部调度状态，不直接映射到 OP_CODE，统一标 IN_TRANSIT
   * App 物流时间线主要看 WaybillRoute 推送，OrderState 只是补充事件
   */
  private parseOrderStates(states: any[]): SfPushPayload[] {
    const grouped = new Map<string, any[]>();
    for (const s of states) {
      const waybillNo = String(s?.waybillNo ?? '').trim();
      if (!waybillNo) continue;
      if (!grouped.has(waybillNo)) grouped.set(waybillNo, []);
      grouped.get(waybillNo)!.push(s);
    }

    const payloads: SfPushPayload[] = [];
    for (const [waybillNo, ss] of grouped) {
      ss.sort((a, b) =>
        String(b.lastTime ?? b.bookTime ?? b.createTm ?? '').localeCompare(
          String(a.lastTime ?? a.bookTime ?? a.createTm ?? ''),
        ),
      );

      const events = ss.map((s: any) => ({
        time: String(s.lastTime ?? s.bookTime ?? s.createTm ?? ''),
        message: String(s.orderStateDesc ?? s.orderStateCode ?? ''),
        location: undefined,
        opCode: String(s.orderStateCode ?? ''),
      }));

      // OrderState 不能精确判断"已签收/已派送"等终态，统一 IN_TRANSIT
      // 实际状态推进由 WaybillRoute 推送负责
      payloads.push({ trackingNo: waybillNo, status: 'IN_TRANSIT', events });
    }
    return payloads;
  }

  // ─── 云打印面单 ───────────────────────────────────────

  /**
   * 云打印面单
   * 调用 COM_RECE_CLOUD_PRINT_WAYBILLS
   * Bug 1: 返回的是 PDF 文件 URL（顺丰临时签名地址），不是 base64
   * 真实路径：apiResultData.obj.files[0].url
   */
  async printWaybill(waybillNo: string): Promise<SfPrintWaybillResult> {
    if (!this.isConfigured()) {
      throw new BadRequestException('顺丰丰桥服务未配置');
    }

    if (!this.templateCode) {
      throw new BadRequestException('SF_TEMPLATE_CODE 未配置，无法打印面单');
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

    // 沙箱实测路径：apiResultData.obj.files[0].url
    const pdfUrl =
      data?.obj?.files?.[0]?.url ?? data?.files?.[0]?.url ?? '';

    if (!pdfUrl || typeof pdfUrl !== 'string') {
      this.logger.error(
        `顺丰面单打印返回缺少 url: waybillNo=${waybillNo}, data=${JSON.stringify(data).slice(0, 300)}`,
      );
      throw new BadRequestException('面单打印失败: 未获取到面单 URL');
    }

    return { pdfUrl };
  }

  /**
   * Bug 87: 验证顺丰推送 URL token（webhook 标准实践，timingSafeEqual 防时序攻击）
   * 双源信任：token 同时存在于 SF 后台 + 服务器 .env，独立泄露才能伪造
   */
  verifyPushToken(token: string): boolean {
    if (!this.pushSecret?.trim()) {
      this.logger.error('SF_PUSH_SECRET 未配置，无法验证推送 token');
      return false;
    }
    if (typeof token !== 'string' || token.length === 0) {
      return false;
    }
    try {
      const expectedBuf = Buffer.from(this.pushSecret, 'utf8');
      const actualBuf = Buffer.from(token, 'utf8');
      if (expectedBuf.length !== actualBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch (e: any) {
      this.logger.warn(`timingSafeEqual 异常（防御性 fallback）: ${e?.message || e}`);
      return false;
    }
  }
}
