import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createDecipheriv, createPrivateKey, createPublicKey } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  assertVerifiedWechatPaySignature,
  VerifiedWechatPayHttpTransport,
} from '../../common/payments/verified-wechat-pay-http';

type WechatPayNotifyResource = {
  original_type?: 'transaction' | 'refund' | string;
  ciphertext?: string;
  nonce?: string;
  associated_data?: string;
};

type WechatPayNotifyBody = {
  event_type?: string;
  resource?: WechatPayNotifyResource;
};

type WechatPayNotifyHeaders = {
  signature?: string;
  timestamp?: string;
  nonce?: string;
  serial?: string;
};

type WechatPayParsedNotify = {
  type: 'payment' | 'refund';
  appId?: string;
  tradeType?: string;
  mchId: string;
  outTradeNo: string;
  outRefundNo?: string;
  providerTxnId: string;
  tradeState: string;
  amountFen: number;
  amount: number;
  totalAmountFen?: number;
  totalAmount?: number;
  paidAt?: Date;
};

export type WechatOrderQueryResult =
  | {
      outcome: 'FOUND';
      tradeState: string;
      transactionId?: string;
      outTradeNo: string;
      appId: string;
      tradeType?: string;
      totalAmountFen?: number;
      totalAmount?: number;
      paidAt?: Date;
    }
  | { outcome: 'DEFINITIVE_NOT_FOUND' }
  | { outcome: 'UNKNOWN'; code?: string };

type WechatRefundResult = {
  success: boolean;
  pending: boolean;
  providerRefundId?: string;
  outTradeNo?: string;
  outRefundNo?: string;
  refundAmountFen?: number;
  totalAmountFen?: number;
  refundAmount?: number;
  totalAmount?: number;
  message: string;
};

const WECHAT_ORDER_TRADE_STATES = new Set([
  'SUCCESS',
  'REFUND',
  'NOTPAY',
  'CLOSED',
  'REVOKED',
  'USERPAYING',
  'PAYERROR',
]);

const WECHAT_REFUND_STATUSES = new Set([
  'SUCCESS',
  'CLOSED',
  'PROCESSING',
  'ABNORMAL',
]);

@Injectable()
export class WechatPayService implements OnModuleInit {
  private readonly logger = new Logger(WechatPayService.name);
  private client: any = null;
  private appId: string | null = null;
  private miniProgramAppId: string | null = null;
  private mchId: string | null = null;
  private apiV3Key: string | null = null;
  private certSerial: string | null = null;
  private merchantCert: string | null = null;
  private privateKey: string | null = null;
  private wechatPayPublicKeyId: string | null = null;
  private wechatPayPublicKey: string | null = null;
  private notifyUrl: string | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const appId = this.configService.get<string>('WECHAT_PAY_APP_ID')?.trim();
    const miniProgramAppId = this.configService.get<string>('WECHAT_MINIAPP_APP_ID')?.trim();
    const mchId = this.configService.get<string>('WECHAT_PAY_MCH_ID')?.trim();
    const apiV3Key = this.configService.get<string>('WECHAT_PAY_API_V3_KEY')?.trim();
    const certSerial = this.configService.get<string>('WECHAT_PAY_MERCHANT_CERT_SERIAL')?.trim();
    const merchantCert = this.loadPemFromEnv('WECHAT_PAY_MERCHANT_CERT', 'WECHAT_PAY_MERCHANT_CERT_PATH');
    const privateKey = this.loadPemFromEnv('WECHAT_PAY_MERCHANT_PRIVATE_KEY', 'WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH');
    const wechatPayPublicKeyId = this.configService
      .get<string>('WECHAT_PAY_PUBLIC_KEY_ID', '')
      .trim();
    const wechatPayPublicKey = this.loadPemFromEnv(
      'WECHAT_PAY_PUBLIC_KEY',
      'WECHAT_PAY_PUBLIC_KEY_PATH',
    );
    const notifyUrl = this.configService.get<string>('WECHAT_PAY_NOTIFY_URL', '').trim();

    const configuredCredentialCount = [
      appId,
      mchId,
      apiV3Key,
      certSerial,
      merchantCert,
      privateKey,
      wechatPayPublicKeyId,
      wechatPayPublicKey,
    ].filter(Boolean).length;
    if (configuredCredentialCount === 0) {
      this.logger.warn(
        '微信支付凭据未配齐（缺 APP_ID / MCH_ID / API_V3_KEY / CERT_SERIAL / MERCHANT_CERT / PRIVATE_KEY / WECHAT_PAY_PUBLIC_KEY_ID / WECHAT_PAY_PUBLIC_KEY 其一），微信支付不可用',
      );
      return;
    }

    const configError = this.validateConfiguration({
      appId,
      mchId,
      apiV3Key,
      certSerial,
      merchantCert,
      privateKey,
      wechatPayPublicKeyId,
      wechatPayPublicKey,
      notifyUrl,
    });
    if (configError) {
      const error = new Error(`微信支付配置无效：${configError}`);
      this.logger.error(`${error.message}；支付通道将 fail-closed`);
      if (process.env.NODE_ENV === 'production') throw error;
      return;
    }

    this.appId = appId!;
    this.miniProgramAppId = miniProgramAppId || null;
    this.mchId = mchId!;
    this.apiV3Key = apiV3Key!;
    this.certSerial = certSerial!;
    this.merchantCert = merchantCert!;
    this.privateKey = privateKey!;
    this.wechatPayPublicKeyId = wechatPayPublicKeyId;
    this.wechatPayPublicKey = wechatPayPublicKey!;
    this.notifyUrl = notifyUrl;

    try {
      // wechatpay-node-v3 是 CommonJS 包：module.exports 本身就是构造函数，没有 .default。
      // 本项目 tsconfig 是 module=commonjs 且未开 esModuleInterop，编译后的 await import() 不做
      // interop 包装，运行时 .default === undefined（→ "WxPay is not a constructor"）。
      // 故按官方 README 的 CJS 形态兼容取构造函数：真包取自身；若未来包改发 ESM 再取 .default。
      const mod: any = await import('wechatpay-node-v3');
      const WxPay = (mod?.default ?? mod) as any;
      this.client = new WxPay({
        appid: appId,
        mchid: mchId,
        publicKey: Buffer.from(merchantCert!),   // apiclient_cert.pem（商户证书）
        privateKey: Buffer.from(privateKey!),    // apiclient_key.pem（商户私钥，签名用）
        key: apiV3Key,                          // APIv3 密钥（用于解密 notify body）
        serial_no: certSerial,                  // 商户证书序列号
      });
      if (typeof this.client.createHttp !== 'function') {
        throw new Error('微信支付 SDK 不支持安全自定义传输层');
      }
      this.client.createHttp(new VerifiedWechatPayHttpTransport({
        publicKeyId: wechatPayPublicKeyId,
        publicKey: wechatPayPublicKey!,
      }));
      this.logger.log(`微信支付 SDK 初始化成功，AppID: ${appId}, MchID: ${mchId}`);
    } catch (err: any) {
      this.logger.error(`微信支付 SDK 初始化失败: ${err.message}`);
      this.client = null;
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
    }
  }

  private loadPemFromEnv(inlineKey: string, pathKey: string): string | null {
    const inline = this.configService.get<string>(inlineKey);
    if (inline && inline.trim()) {
      return inline.replace(/\\n/g, '\n').trim();
    }
    const filePath = this.configService.get<string>(pathKey);
    if (filePath) {
      try {
        return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf-8').trim();
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * SDK 构造器不会验证 PEM 或 APIv3 key；若先创建预支付单、回调解密才失败，会留下已付款未建单。
   * 所以所有支付凭据格式和回调地址必须在启用通道前本地校验。
   */
  private validateConfiguration(input: {
    appId?: string;
    mchId?: string;
    apiV3Key?: string;
    certSerial?: string;
    merchantCert: string | null;
    privateKey: string | null;
    wechatPayPublicKeyId: string;
    wechatPayPublicKey: string | null;
    notifyUrl: string;
  }): string | null {
    if (
      !input.appId
      || !input.mchId
      || !input.apiV3Key
      || !input.certSerial
      || !input.merchantCert
      || !input.privateKey
      || !input.wechatPayPublicKeyId
      || !input.wechatPayPublicKey
    ) {
      return '支付凭据不完整';
    }
    if (Buffer.byteLength(input.apiV3Key, 'utf8') !== 32) {
      return 'WECHAT_PAY_API_V3_KEY 必须为 32 字节';
    }
    if (!/^[A-Za-z0-9]+$/.test(input.certSerial)) {
      return 'WECHAT_PAY_MERCHANT_CERT_SERIAL 格式无效';
    }
    if (!/^PUB_KEY_ID_\d+$/.test(input.wechatPayPublicKeyId)) {
      return 'WECHAT_PAY_PUBLIC_KEY_ID 格式无效';
    }
    try {
      const merchantPrivateKey = createPrivateKey(input.privateKey);
      const merchantCertificateKey = createPublicKey(input.merchantCert);
      const wechatPublicKey = createPublicKey(input.wechatPayPublicKey);
      if (
        merchantPrivateKey.asymmetricKeyType !== 'rsa'
        || merchantCertificateKey.asymmetricKeyType !== 'rsa'
        || wechatPublicKey.asymmetricKeyType !== 'rsa'
      ) {
        return '微信支付密钥必须为 RSA 格式';
      }
    } catch {
      return '微信支付 PEM 密钥或商户证书无法解析';
    }
    try {
      const parsed = new URL(input.notifyUrl);
      if (
        parsed.protocol !== 'https:'
        || !parsed.hostname
        || parsed.username
        || parsed.password
        || parsed.hash
      ) {
        return 'WECHAT_PAY_NOTIFY_URL 必须为不含认证信息的 HTTPS 地址';
      }
    } catch {
      return 'WECHAT_PAY_NOTIFY_URL 必须为合法 HTTPS 地址';
    }
    return null;
  }

  static yuanToFenAmount(amount: number, fieldName: string): number {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new Error(`${fieldName} 必须是有效数字`);
    }
    if (amount <= 0) {
      throw new Error(`${fieldName} 必须大于 0`);
    }

    const scaled = amount * 100;
    const rounded = Math.round(scaled);
    if (Math.abs(scaled - rounded) > 1e-8) {
      throw new Error(`${fieldName} 最多支持 2 位小数`);
    }
    if (!Number.isSafeInteger(rounded)) {
      throw new Error(`${fieldName} 转换后的分值超出安全整数范围`);
    }

    return rounded;
  }

  private yuanToFen(amount: number, fieldName: string): number {
    return WechatPayService.yuanToFenAmount(amount, fieldName);
  }

  private validateOutTradeNo(outTradeNo: string): void {
    if (typeof outTradeNo !== 'string' || !outTradeNo.trim()) {
      throw new Error('outTradeNo 不能为空');
    }
    if (outTradeNo.length > 32) {
      throw new Error('outTradeNo 不能超过 32 个字符');
    }
  }

  private validateOutRefundNo(outRefundNo: string): void {
    if (typeof outRefundNo !== 'string' || !outRefundNo.trim()) {
      throw new Error('outRefundNo 不能为空');
    }
    if (outRefundNo.length > 64) {
      throw new Error('outRefundNo 不能超过 64 个字符');
    }
  }

  private parseSdkError(
    result: any,
    fallbackMessage = '微信支付下单失败',
  ): { code: string; message: string } {
    let parsedError: any = {};
    if (typeof result?.error === 'string') {
      try {
        parsedError = JSON.parse(result.error);
      } catch {
        parsedError = {};
      }
    } else if (result?.error && typeof result.error === 'object') {
      parsedError = result.error;
    }

    return {
      code: String(parsedError?.code || result?.code || 'UNKNOWN'),
      message: String(parsedError?.message || result?.message || fallbackMessage),
    };
  }

  private maskBizId(id: unknown): string {
    if (typeof id !== 'string' || !id.trim()) {
      return '<empty>';
    }
    const trimmed = id.trim();
    if (trimmed.length <= 4) {
      return `${trimmed.slice(0, 1)}***`;
    }
    return `${trimmed.slice(0, 3)}***${trimmed.slice(-4)}`;
  }

  private buildNotifyLogContext(body?: WechatPayNotifyBody, decrypted?: any): string {
    const context = [
      `event_type=${body?.event_type ?? '<empty>'}`,
      `original_type=${body?.resource?.original_type ?? '<empty>'}`,
    ];

    if (typeof decrypted?.out_trade_no === 'string') {
      context.push(`outTradeNo=${this.maskBizId(decrypted.out_trade_no)}`);
    }
    if (typeof decrypted?.out_refund_no === 'string') {
      context.push(`outRefundNo=${this.maskBizId(decrypted.out_refund_no)}`);
    }

    return context.join(' ');
  }

  private normalizeNotifyPayload(decrypted: unknown): any {
    if (typeof decrypted === 'string') {
      return JSON.parse(decrypted);
    }
    return decrypted;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private validateNotifyAmountFen(value: unknown): number {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error('微信通知金额字段无效');
    }
    return value;
  }

  private hasCompletePaymentNotifyFields(decrypted: any): boolean {
    return (
      this.isNonEmptyString(decrypted?.appid) &&
      this.isNonEmptyString(decrypted?.mchid) &&
      this.isNonEmptyString(decrypted?.out_trade_no) &&
      this.isNonEmptyString(decrypted?.transaction_id) &&
      this.isNonEmptyString(decrypted?.trade_state) &&
      this.isNonEmptyString(decrypted?.trade_type) &&
      typeof decrypted?.amount?.total === 'number' &&
      Number.isInteger(decrypted.amount.total) &&
      Number.isSafeInteger(decrypted.amount.total) &&
      decrypted.amount.total >= 0
    );
  }

  private validatePaymentNotifyPayload(decrypted: any): number {
    if (
      !this.isNonEmptyString(decrypted?.appid) ||
      !this.isNonEmptyString(decrypted?.mchid) ||
      !this.isNonEmptyString(decrypted?.out_trade_no) ||
      !this.isNonEmptyString(decrypted?.transaction_id) ||
      !this.isNonEmptyString(decrypted?.trade_state) ||
      !this.isNonEmptyString(decrypted?.trade_type)
    ) {
      throw new Error('微信支付通知缺少必要字段');
    }
    return this.validateNotifyAmountFen(decrypted?.amount?.total);
  }

  private validateRefundNotifyPayload(decrypted: any): {
    refundAmountFen: number;
    totalAmountFen: number;
  } {
    if (
      !this.isNonEmptyString(decrypted?.mchid) ||
      !this.isNonEmptyString(decrypted?.out_trade_no) ||
      !this.isNonEmptyString(decrypted?.out_refund_no) ||
      !this.isNonEmptyString(decrypted?.refund_id) ||
      !this.isNonEmptyString(decrypted?.refund_status)
    ) {
      throw new Error('微信退款通知缺少必要字段');
    }
    return {
      refundAmountFen: this.validateNotifyAmountFen(decrypted?.amount?.refund),
      totalAmountFen: this.validateNotifyAmountFen(decrypted?.amount?.total),
    };
  }

  private parseVerifiedRefundSuccessResponse(
    data: any,
    expected: {
      outTradeNo: string;
      outRefundNo: string;
      refundAmountFen: number;
      totalAmountFen: number;
    },
  ): Pick<
    WechatRefundResult,
    'outTradeNo' | 'outRefundNo' | 'refundAmountFen' | 'totalAmountFen' | 'refundAmount' | 'totalAmount'
  > | null {
    try {
      if (
        !this.isNonEmptyString(data?.out_trade_no) ||
        !this.isNonEmptyString(data?.out_refund_no)
      ) {
        throw new Error('微信退款 SUCCESS 返回缺少订单号或退款单号');
      }

      const refundAmountFen = this.validateNotifyAmountFen(data?.amount?.refund);
      const totalAmountFen = this.validateNotifyAmountFen(data?.amount?.total);

      if (
        data.out_trade_no !== expected.outTradeNo ||
        data.out_refund_no !== expected.outRefundNo ||
        refundAmountFen !== expected.refundAmountFen ||
        totalAmountFen !== expected.totalAmountFen
      ) {
        this.logger.warn(
          `微信退款 SUCCESS 返回字段不匹配: outTradeNo=${this.maskBizId(expected.outTradeNo)} outRefundNo=${this.maskBizId(expected.outRefundNo)}`,
        );
        return null;
      }

      return {
        outTradeNo: data.out_trade_no,
        outRefundNo: data.out_refund_no,
        refundAmountFen,
        totalAmountFen,
        refundAmount: refundAmountFen / 100,
        totalAmount: totalAmountFen / 100,
      };
    } catch {
      this.logger.warn(
        `微信退款 SUCCESS 返回缺少可验证字段: outTradeNo=${this.maskBizId(expected.outTradeNo)} outRefundNo=${this.maskBizId(expected.outRefundNo)}`,
      );
      return null;
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /** 小程序支付必须同时具备商户凭据和已绑定商户号的小程序 AppID。 */
  isMiniProgramAvailable(): boolean {
    return this.client !== null && this.miniProgramAppId !== null;
  }

  /**
   * 供服务端身份解析使用。不得把此方法替换为客户端提交 AppID/OpenID。
   */
  getMiniProgramAppId(): string | null {
    return this.miniProgramAppId;
  }

  async createAppOrder(params: {
    outTradeNo: string;
    amount: number;
    description: string;
    timeExpire?: Date;
  }): Promise<{
    appId: string;
    partnerId: string;
    timestamp: string;
    nonceStr: string;
    prepayId: string;
    packageVal: string;
    package: string;
    signType: string;
    paySign: string;
    sign: string;
    timeStamp: string;
  }> {
    if (!this.client) {
      throw new Error('微信支付 SDK 未初始化');
    }

    this.validateOutTradeNo(params.outTradeNo);
    const total = this.yuanToFen(params.amount, 'amount');

    const result = await this.client.transactions_app({
      appid: this.appId!,
      mchid: this.mchId!,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: this.notifyUrl!,
      amount: {
        total,
        currency: 'CNY',
      },
      ...(params.timeExpire ? { time_expire: this.formatWechatTimeExpire(params.timeExpire) } : {}),
    });

    if (result?.status !== 200) {
      const { code, message } = this.parseSdkError(result);
      this.logger.error(
        `微信支付下单失败: status=${result?.status ?? 'UNKNOWN'} code=${code} outTradeNo=${this.maskBizId(params.outTradeNo)}`,
      );
      throw new Error(`微信支付下单失败 [${code}] ${message}`);
    }

    const data = result.data;
    if (!data?.prepayid || !data?.sign) {
      this.logger.error(
        `微信支付下单返回缺少必要签名字段: outTradeNo=${this.maskBizId(params.outTradeNo)}`,
      );
      throw new Error('微信支付下单返回缺少必要签名字段');
    }

    return {
      appId: data.appid,
      partnerId: data.partnerid ?? this.mchId!,
      timestamp: data.timestamp,
      timeStamp: data.timestamp,
      nonceStr: data.noncestr,
      prepayId: data.prepayid,
      packageVal: data.package,
      package: data.package,
      signType: 'RSA',
      paySign: data.sign,
      sign: data.sign,
    };
  }

  /**
   * 微信小程序 JSAPI 下单。
   *
   * openId 只接受调用方从当前已认证用户的 AuthIdentity 解析出的可信值；
   * Controller/DTO 不暴露 openId 字段，避免用户替他人发起支付。
   */
  async createMiniProgramOrder(params: {
    outTradeNo: string;
    amount: number;
    description: string;
    openId: string;
    timeExpire?: Date;
  }): Promise<{
    appId: string;
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'RSA';
    paySign: string;
    prepayId: string;
  }> {
    if (!this.client) {
      throw new Error('微信支付 SDK 未初始化');
    }
    if (!this.miniProgramAppId) {
      throw new Error('微信小程序 AppID 未配置');
    }
    if (!this.isNonEmptyString(params.openId)) {
      throw new Error('当前账号未绑定微信小程序身份');
    }

    this.validateOutTradeNo(params.outTradeNo);
    const total = this.yuanToFen(params.amount, 'amount');
    const result = await this.client.transactions_jsapi({
      appid: this.miniProgramAppId,
      mchid: this.mchId!,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: this.notifyUrl!,
      amount: {
        total,
        currency: 'CNY',
      },
      payer: { openid: params.openId.trim() },
      ...(params.timeExpire ? { time_expire: this.formatWechatTimeExpire(params.timeExpire) } : {}),
    });

    if (result?.status !== 200) {
      const { code, message } = this.parseSdkError(result);
      this.logger.error(
        `微信小程序支付下单失败: status=${result?.status ?? 'UNKNOWN'} code=${code} outTradeNo=${this.maskBizId(params.outTradeNo)}`,
      );
      throw new Error(`微信小程序支付下单失败 [${code}] ${message}`);
    }

    // wechatpay-node-v3 会按官方格式签名 appId/timeStamp/nonceStr/package；
    // 对外只返回 requestPayment 所需字段，不返回 payer.openid。
    const data = result.data;
    const packageValue = this.isNonEmptyString(data?.package) ? data.package : '';
    const prepayId = packageValue.startsWith('prepay_id=')
      ? packageValue.slice('prepay_id='.length)
      : '';
    if (
      data?.appId !== this.miniProgramAppId
      || !this.isNonEmptyString(data?.timeStamp)
      || !this.isNonEmptyString(data?.nonceStr)
      || !prepayId
      || data?.signType !== 'RSA'
      || !this.isNonEmptyString(data?.paySign)
    ) {
      this.logger.error(
        `微信小程序支付下单返回缺少必要签名字段: outTradeNo=${this.maskBizId(params.outTradeNo)}`,
      );
      throw new Error('微信小程序支付下单返回缺少必要签名字段');
    }

    return {
      appId: data.appId,
      timeStamp: data.timeStamp,
      nonceStr: data.nonceStr,
      package: packageValue,
      signType: 'RSA',
      paySign: data.paySign,
      prepayId,
    };
  }

  async parseNotify(args: {
    body: WechatPayNotifyBody;
    rawBody: string;
    headers: WechatPayNotifyHeaders;
  }): Promise<WechatPayParsedNotify> {
    if (!this.client) {
      throw new Error('微信支付 SDK 未初始化');
    }

    const { body, rawBody, headers } = args;
    const resource = body.resource ?? {};

    this.assertNotifyTimestampFresh(headers.timestamp);

    let verified: boolean;
    try {
      if (
        headers.serial === this.wechatPayPublicKeyId
        && this.wechatPayPublicKeyId
        && this.wechatPayPublicKey
      ) {
        assertVerifiedWechatPaySignature({
          publicKeyId: this.wechatPayPublicKeyId,
          publicKey: this.wechatPayPublicKey,
          headers,
          rawBody,
        });
        verified = true;
      } else {
        // 兼容仍由平台证书签名的历史支付回调；SDK 会按证书序列号拉取并缓存平台证书。
        verified = await this.client.verifySign({
          timestamp: headers.timestamp,
          nonce: headers.nonce,
          body: rawBody,
          serial: headers.serial,
          signature: headers.signature,
          apiSecret: this.apiV3Key!,
        });
      }
    } catch (err) {
      this.logger.error(`微信通知签名校验异常: ${this.buildNotifyLogContext(body)}`);
      throw err;
    }

    if (!verified) {
      this.logger.warn(`微信通知签名校验失败: ${this.buildNotifyLogContext(body)}`);
      throw new Error('微信通知签名校验失败');
    }

    let decryptedRaw: unknown;
    try {
      decryptedRaw = this.decryptNotifyResource(resource);
    } catch (err) {
      this.logger.error(`微信通知解密失败: ${this.buildNotifyLogContext(body)}`);
      throw err;
    }

    let decrypted: any;
    try {
      decrypted = this.normalizeNotifyPayload(decryptedRaw);
    } catch (err) {
      this.logger.error(`微信通知解密结果解析失败: ${this.buildNotifyLogContext(body)}`);
      throw err;
    }

    try {
      const eventType = this.isNonEmptyString(body.event_type) ? body.event_type : undefined;
      const originalType = this.isNonEmptyString(resource.original_type) ? resource.original_type : undefined;
      const isRefund =
        (typeof eventType === 'string' && eventType.startsWith('REFUND.')) ||
        originalType === 'refund' ||
        typeof decrypted?.out_refund_no === 'string';
      const isPayment =
        eventType === 'TRANSACTION.SUCCESS' &&
        originalType === 'transaction';
      const hasPaymentEventSignal = eventType === 'TRANSACTION.SUCCESS' || !eventType;
      const hasPaymentOriginalSignal = originalType === 'transaction' || !originalType;
      const isCompatPayment =
        (!eventType || !originalType) &&
        hasPaymentEventSignal &&
        hasPaymentOriginalSignal &&
        !isRefund &&
        this.hasCompletePaymentNotifyFields(decrypted);

      if (isRefund) {
        const { refundAmountFen, totalAmountFen } = this.validateRefundNotifyPayload(decrypted);
        return {
          type: 'refund',
          mchId: decrypted.mchid,
          outTradeNo: decrypted.out_trade_no,
          outRefundNo: decrypted.out_refund_no,
          providerTxnId: decrypted.refund_id,
          tradeState: decrypted.refund_status,
          amountFen: refundAmountFen,
          amount: refundAmountFen / 100,
          totalAmountFen,
          totalAmount: totalAmountFen / 100,
          paidAt: decrypted.success_time ? new Date(decrypted.success_time) : undefined,
        };
      }

      if (!isPayment && !isCompatPayment) {
        throw new Error('微信通知事件类型不支持');
      }

      const amountFen = this.validatePaymentNotifyPayload(decrypted);
      return {
        type: 'payment',
        appId: decrypted.appid,
        tradeType: decrypted.trade_type,
        mchId: decrypted.mchid,
        outTradeNo: decrypted.out_trade_no,
        providerTxnId: decrypted.transaction_id,
        tradeState: decrypted.trade_state,
        amountFen,
        amount: amountFen / 100,
        paidAt: decrypted.success_time ? new Date(decrypted.success_time) : undefined,
      };
    } catch (err) {
      this.logger.error(`微信通知字段映射失败: ${this.buildNotifyLogContext(body, decrypted)}`);
      throw err;
    }
  }

  /**
   * 微信支付 APIv3 回调资源使用 AES-256-GCM；必须执行 decipher.final() 才会校验 auth tag。
   * 不使用 SDK 的 decipher_gcm：已安装版本只调用 update()，会跳过完整性认证。
   */
  private decryptNotifyResource(resource: WechatPayNotifyResource): string {
    if (
      !this.apiV3Key
      || !this.isNonEmptyString(resource.ciphertext)
      || !this.isNonEmptyString(resource.nonce)
      || (resource.associated_data !== undefined && typeof resource.associated_data !== 'string')
    ) {
      throw new Error('微信支付回调密文字段不完整');
    }
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    if (encrypted.length <= 16) {
      throw new Error('微信支付回调密文无效');
    }
    const ciphertext = encrypted.subarray(0, encrypted.length - 16);
    const authTag = encrypted.subarray(encrypted.length - 16);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAAD(Buffer.from(resource.associated_data ?? '', 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  async queryOrder(outTradeNo: string): Promise<WechatOrderQueryResult> {
    if (!this.client) {
      return { outcome: 'UNKNOWN', code: 'SDK_NOT_INITIALIZED' };
    }

    try {
      this.validateOutTradeNo(outTradeNo);
    } catch {
      return { outcome: 'UNKNOWN', code: 'INVALID_OUT_TRADE_NO' };
    }

    const outTradeNoForLog = this.maskBizId(outTradeNo);

    let result: any;
    try {
      result = await this.client.query({ out_trade_no: outTradeNo });
    } catch (err: any) {
      const parsedError = this.parseSdkError(err, '微信主动查单失败');
      const code = String(err?.code || parsedError.code || 'SDK_EXCEPTION');
      this.logger.error(
        `微信主动查单 SDK 调用失败: code=${code} outTradeNo=${outTradeNoForLog}`,
      );
      if (code === 'ORDER_NOT_EXIST' || code === 'ORDERNOTEXIST') {
        return { outcome: 'DEFINITIVE_NOT_FOUND' };
      }
      return { outcome: 'UNKNOWN', code };
    }

    if (result?.status !== 200) {
      const { code } = this.parseSdkError(result, '微信主动查单失败');
      this.logger.error(
        `微信主动查单失败: status=${result?.status ?? 'UNKNOWN'} code=${code} outTradeNo=${outTradeNoForLog}`,
      );
      if (code === 'ORDER_NOT_EXIST' || code === 'ORDERNOTEXIST') {
        return { outcome: 'DEFINITIVE_NOT_FOUND' };
      }
      return { outcome: 'UNKNOWN', code };
    }

    const data = result.data;
    try {
      if (
        !this.isNonEmptyString(data?.trade_state) ||
        !this.isNonEmptyString(data?.out_trade_no) ||
        !this.isNonEmptyString(data?.appid) ||
        !this.isNonEmptyString(data?.mchid)
      ) {
        throw new Error('微信主动查单返回缺少必要字段');
      }

      if (data.mchid !== this.mchId) {
        this.logger.warn(
          `微信主动查单返回商户号不匹配: outTradeNo=${outTradeNoForLog}`,
        );
        return { outcome: 'UNKNOWN', code: 'MCH_ID_MISMATCH' };
      }

      if (!WECHAT_ORDER_TRADE_STATES.has(data.trade_state)) {
        this.logger.warn(
          `微信主动查单返回未知交易状态: outTradeNo=${outTradeNoForLog}`,
        );
        return { outcome: 'UNKNOWN', code: 'UNKNOWN_TRADE_STATE' };
      }

      if (data.trade_state === 'SUCCESS') {
        if (!this.isNonEmptyString(data.transaction_id)) {
          this.logger.warn(
            `微信主动查单成功态缺少交易流水号: outTradeNo=${outTradeNoForLog}`,
          );
          return { outcome: 'UNKNOWN', code: 'SUCCESS_WITHOUT_TRANSACTION_ID' };
        }
        if (!this.isNonEmptyString(data.trade_type)) {
          this.logger.warn(
            `微信主动查单成功态缺少交易类型: outTradeNo=${outTradeNoForLog}`,
          );
          return { outcome: 'UNKNOWN', code: 'SUCCESS_WITHOUT_TRADE_TYPE' };
        }
        if (data?.amount?.total === undefined || data?.amount?.total === null) {
          this.logger.warn(
            `微信主动查单成功态缺少订单金额: outTradeNo=${outTradeNoForLog}`,
          );
          return { outcome: 'UNKNOWN', code: 'SUCCESS_WITHOUT_AMOUNT' };
        }
      }

      if (data.out_trade_no !== outTradeNo) {
        this.logger.warn(
          `微信主动查单返回订单号不匹配: outTradeNo=${outTradeNoForLog} providerOutTradeNo=${this.maskBizId(data.out_trade_no)}`,
        );
        return { outcome: 'UNKNOWN', code: 'OUT_TRADE_NO_MISMATCH' };
      }

      const totalAmountFen = data?.amount?.total === undefined || data?.amount?.total === null
        ? undefined
        : this.validateNotifyAmountFen(data.amount.total);
      const parsed: {
        outcome: 'FOUND';
        tradeState: string;
        transactionId?: string;
        outTradeNo: string;
        appId: string;
        tradeType?: string;
        totalAmountFen?: number;
        totalAmount?: number;
        paidAt?: Date;
      } = {
        outcome: 'FOUND',
        tradeState: data.trade_state,
        outTradeNo: data.out_trade_no,
        appId: data.appid,
      };

      if (totalAmountFen !== undefined) {
        parsed.totalAmountFen = totalAmountFen;
        parsed.totalAmount = totalAmountFen / 100;
      }

      if (this.isNonEmptyString(data.trade_type)) {
        parsed.tradeType = data.trade_type;
      }

      if (this.isNonEmptyString(data.transaction_id)) {
        parsed.transactionId = data.transaction_id;
      }

      if (this.isNonEmptyString(data.success_time)) {
        parsed.paidAt = new Date(data.success_time);
      }

      return parsed;
    } catch {
      this.logger.warn(
        `微信主动查单返回字段无效: outTradeNo=${outTradeNoForLog}`,
      );
      return { outcome: 'UNKNOWN', code: 'INVALID_RESPONSE' };
    }
  }

  /** 服务端支付身份白名单：始终匹配场景 AppID；成功态还必须匹配 trade_type。 */
  matchesPaymentScene(
    identity: {
      appId?: string | null;
      tradeType?: string | null;
      tradeState?: string | null;
    },
    scene: 'APP' | 'MINI_PROGRAM' | string | null | undefined,
  ): boolean {
    const expectedAppId = scene === 'MINI_PROGRAM' ? this.miniProgramAppId : this.appId;
    const expectedTradeType = scene === 'MINI_PROGRAM' ? 'JSAPI' : 'APP';
    if (!expectedAppId || identity.appId !== expectedAppId) return false;
    if (this.isNonEmptyString(identity.tradeType)) {
      return identity.tradeType === expectedTradeType;
    }

    // 微信真实查单在 NOTPAY 时可能省略 trade_type。此时应答已经过
    // APIv3 RSA 验签，且 AppID 与当前场景匹配，可用于关单/释放；但绝不能把
    // 缺少交易类型的 SUCCESS 当作付款建单证据。
    return Boolean(identity.tradeState && identity.tradeState !== 'SUCCESS');
  }

  async closeOrder(outTradeNo: string): Promise<{
    success: boolean;
    terminal: boolean;
    alreadyPaid: boolean;
    message: string;
  }> {
    if (!this.client) {
      return {
        success: false,
        terminal: false,
        alreadyPaid: false,
        message: '微信支付 SDK 未初始化，无法确认远端状态',
      };
    }

    try {
      this.validateOutTradeNo(outTradeNo);
    } catch {
      return {
        success: false,
        terminal: false,
        alreadyPaid: false,
        message: '微信支付商户订单号无效，无法确认远端状态',
      };
    }

    const outTradeNoForLog = this.maskBizId(outTradeNo);

    let result: any;
    try {
      result = await this.client.close(outTradeNo);
    } catch (err: any) {
      const code = String(err?.code || 'SDK_EXCEPTION');
      this.logger.error(
        `微信关单 SDK 调用失败: code=${code} outTradeNo=${outTradeNoForLog}`,
      );
      return {
        success: false,
        terminal: false,
        alreadyPaid: false,
        message: `微信关单失败 [${code}]`,
      };
    }

    if (result?.status === 204) {
      return {
        success: true,
        terminal: true,
        alreadyPaid: false,
        message: '关单成功',
      };
    }

    const { code } = this.parseSdkError(result, '微信关单失败');
    // 微信不同接口/版本会返回 ORDER_NOT_EXIST / ORDER_CLOSED，旧 SDK 与
    // 历史响应也可能使用 ORDERNOTEXIST / ORDERCLOSED。这里只归一化分隔符，
    // 不做模糊匹配，避免把未知错误误判为安全终态。
    const normalizedCode = code.replace(/_/g, '');

    if (normalizedCode === 'ORDERNOTEXIST' || normalizedCode === 'ORDERCLOSED') {
      return {
        success: true,
        terminal: true,
        alreadyPaid: false,
        message: '订单不存在或已关闭',
      };
    }

    if (code === 'ORDERPAID') {
      return {
        success: false,
        terminal: false,
        alreadyPaid: true,
        message: '订单已支付',
      };
    }

    this.logger.error(
      `微信关单失败: status=${result?.status ?? 'UNKNOWN'} code=${code} outTradeNo=${outTradeNoForLog}`,
    );
    return {
      success: false,
      terminal: false,
      alreadyPaid: false,
      message: `微信关单失败 [${code}]`,
    };
  }

  async queryRefund(outRefundNo: string): Promise<{
    outRefundNo: string;
    outTradeNo: string;
    providerRefundId: string;
    status: string;
    refundAmountFen: number;
    totalAmountFen: number;
    refundAmount: number;
    totalAmount: number;
    successAt?: Date;
  } | null> {
    if (!this.client) {
      return null;
    }

    try {
      this.validateOutRefundNo(outRefundNo);
    } catch {
      return null;
    }

    const outRefundNoForLog = this.maskBizId(outRefundNo);

    let result: any;
    try {
      result = await this.client.find_refunds(outRefundNo);
    } catch (err: any) {
      const code = String(err?.code || 'SDK_EXCEPTION');
      this.logger.error(
        `微信主动查退款 SDK 调用失败: code=${code} outRefundNo=${outRefundNoForLog}`,
      );
      return null;
    }

    if (result?.status !== 200) {
      const { code } = this.parseSdkError(result, '微信主动查退款失败');
      this.logger.error(
        `微信主动查退款失败: status=${result?.status ?? 'UNKNOWN'} code=${code} outRefundNo=${outRefundNoForLog}`,
      );
      return null;
    }

    const data = result.data;
    try {
      if (!this.isNonEmptyString(data?.out_refund_no)) {
        throw new Error('微信主动查退款返回缺少商户退款单号');
      }

      if (data.out_refund_no !== outRefundNo) {
        this.logger.warn(
          `微信主动查退款返回退款单号不匹配: outRefundNo=${outRefundNoForLog} providerOutRefundNo=${this.maskBizId(data.out_refund_no)}`,
        );
        return null;
      }

      if (
        !this.isNonEmptyString(data?.out_trade_no) ||
        !this.isNonEmptyString(data?.refund_id) ||
        !this.isNonEmptyString(data?.status)
      ) {
        throw new Error('微信主动查退款返回缺少必要字段');
      }
      this.validateOutTradeNo(data.out_trade_no);

      if (!WECHAT_REFUND_STATUSES.has(data.status)) {
        this.logger.warn(
          `微信主动查退款返回未知退款状态: outRefundNo=${outRefundNoForLog}`,
        );
        return null;
      }

      const refundAmountFen = this.validateNotifyAmountFen(data?.amount?.refund);
      const totalAmountFen = this.validateNotifyAmountFen(data?.amount?.total);
      const parsed: {
        outRefundNo: string;
        outTradeNo: string;
        providerRefundId: string;
        status: string;
        refundAmountFen: number;
        totalAmountFen: number;
        refundAmount: number;
        totalAmount: number;
        successAt?: Date;
      } = {
        outRefundNo: data.out_refund_no,
        outTradeNo: data.out_trade_no,
        providerRefundId: data.refund_id,
        status: data.status,
        refundAmountFen,
        totalAmountFen,
        refundAmount: refundAmountFen / 100,
        totalAmount: totalAmountFen / 100,
      };

      if (this.isNonEmptyString(data.success_time)) {
        parsed.successAt = new Date(data.success_time);
      }

      return parsed;
    } catch {
      this.logger.warn(
        `微信主动查退款返回字段无效: outRefundNo=${outRefundNoForLog}`,
      );
      return null;
    }
  }

  async refund(params: {
    outTradeNo: string;
    outRefundNo: string;
    refundAmount: number;
    totalAmount: number;
    reason: string;
  }): Promise<WechatRefundResult> {
    if (!this.client) {
      return {
        success: false,
        pending: false,
        message: '微信支付 SDK 未初始化',
      };
    }

    let refund: number;
    let total: number;
    try {
      this.validateOutTradeNo(params.outTradeNo);
      this.validateOutRefundNo(params.outRefundNo);
      refund = this.yuanToFen(params.refundAmount, 'refundAmount');
      total = this.yuanToFen(params.totalAmount, 'totalAmount');
      if (refund > total) {
        throw new Error('refundAmount 不能大于 totalAmount');
      }
    } catch (err: any) {
      return {
        success: false,
        pending: false,
        message: err?.message || '微信退款参数无效',
      };
    }

    const outTradeNoForLog = this.maskBizId(params.outTradeNo);
    const outRefundNoForLog = this.maskBizId(params.outRefundNo);

    let result: any;
    try {
      result = await this.client.refunds({
        out_trade_no: params.outTradeNo,
        out_refund_no: params.outRefundNo,
        reason: params.reason,
        notify_url: this.notifyUrl!,
        amount: {
          refund,
          total,
          currency: 'CNY',
        },
      });
    } catch (err: any) {
      const code = String(err?.code || 'SDK_EXCEPTION');
      const message = String(err?.message || '微信退款调用失败');
      const isUncertainError = this.isUncertainProviderError(err);
      this.logger.error(
        `微信退款 SDK 调用失败: code=${code} outTradeNo=${outTradeNoForLog} outRefundNo=${outRefundNoForLog}`,
      );
      if (isUncertainError) {
        return {
          success: true,
          pending: true,
          message: `微信退款请求异常待查 [${code}] ${message}`,
        };
      }
      return {
        success: false,
        pending: false,
        message: `微信退款失败 [${code}] ${message}`,
      };
    }

    if (result?.status !== 200) {
      const { code, message } = this.parseSdkError(result, '微信退款失败');
      this.logger.error(
        `微信退款失败: status=${result?.status ?? 'UNKNOWN'} code=${code} outTradeNo=${outTradeNoForLog} outRefundNo=${outRefundNoForLog}`,
      );
      return {
        success: false,
        pending: false,
        message: `微信退款失败 [${code}] ${message}`,
      };
    }

    const data = result.data;
    const providerRefundId = data?.refund_id;
    const statusValue = data?.status;
    const status = typeof statusValue === 'string' ? statusValue : '';

    if (!status) {
      this.logger.warn(
        `微信退款返回缺少状态，按待确认处理: outTradeNo=${outTradeNoForLog} outRefundNo=${outRefundNoForLog}`,
      );
      return {
        success: true,
        pending: true,
        providerRefundId,
        message: '微信退款状态待确认',
      };
    }

    if (status === 'SUCCESS') {
      const verified = this.parseVerifiedRefundSuccessResponse(data, {
        outTradeNo: params.outTradeNo,
        outRefundNo: params.outRefundNo,
        refundAmountFen: refund,
        totalAmountFen: total,
      });
      if (!verified) {
        return {
          success: true,
          pending: true,
          providerRefundId,
          message: '微信退款成功状态待确认',
        };
      }
      return {
        success: true,
        pending: false,
        providerRefundId,
        ...verified,
        message: '退款成功',
      };
    }

    if (status === 'PROCESSING') {
      if (!providerRefundId) {
        this.logger.warn(
          `微信退款 PROCESSING 返回缺少 refund_id，后续依赖 outRefundNo 查单: outRefundNo=${outRefundNoForLog}`,
        );
      }
      return {
        success: true,
        pending: true,
        providerRefundId,
        message: '退款受理中，等待结果通知',
      };
    }

    this.logger.warn(
      `微信退款状态失败: status=${status} outTradeNo=${outTradeNoForLog} outRefundNo=${outRefundNoForLog}`,
    );
    return {
      success: false,
      pending: false,
      providerRefundId,
      message: `微信退款失败，状态=${status}`,
    };
  }

  @Cron('0 0 3 * * *')
  async refreshPlatformCertificates(): Promise<void> {
    if (!this.client || !this.apiV3Key || !this.client.fetchCertificates) return;
    try {
      await this.client.fetchCertificates(this.apiV3Key);
      this.logger.log('微信支付平台证书缓存刷新成功');
    } catch (err: any) {
      this.logger.warn(`微信支付平台证书缓存刷新失败: ${err?.message || 'UNKNOWN'}`);
    }
  }

  private formatWechatTimeExpire(value: Date): string {
    return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  private assertNotifyTimestampFresh(timestamp?: string): void {
    const ts = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
      throw new Error('微信通知 timestamp 超过 5 分钟窗口');
    }
  }

  private isNetworkError(err: any): boolean {
    const code = String(err?.code || '');
    const message = String(err?.message || '');
    return /ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNABORTED|ENOTFOUND|EAI_AGAIN|socket hang up|timeout/i
      .test(`${code} ${message}`);
  }

  private isUncertainProviderError(err: any): boolean {
    const code = String(err?.code || '');
    return this.isNetworkError(err)
      || /^(?:WECHATPAY_|INVALID_WECHATPAY_)/.test(code);
  }

  /** 暴露给上层做金额校验、防伪造（notify 路径用） */
  getAppId(): string | null { return this.appId; }
  getMchId(): string | null { return this.mchId; }
}
