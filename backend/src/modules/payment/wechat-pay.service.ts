import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

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
  outTradeNo: string;
  outRefundNo?: string;
  providerTxnId: string;
  tradeState: string;
  amountFen: number;
  amount: number;
  paidAt?: Date;
};

@Injectable()
export class WechatPayService implements OnModuleInit {
  private readonly logger = new Logger(WechatPayService.name);
  private client: any = null;
  private appId: string | null = null;
  private mchId: string | null = null;
  private apiV3Key: string | null = null;
  private certSerial: string | null = null;
  private merchantCert: string | null = null;
  private privateKey: string | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const appId = this.configService.get<string>('WECHAT_PAY_APP_ID');
    const mchId = this.configService.get<string>('WECHAT_PAY_MCH_ID');
    const apiV3Key = this.configService.get<string>('WECHAT_PAY_API_V3_KEY');
    const certSerial = this.configService.get<string>('WECHAT_PAY_MERCHANT_CERT_SERIAL');
    const merchantCert = this.loadPemFromEnv('WECHAT_PAY_MERCHANT_CERT', 'WECHAT_PAY_MERCHANT_CERT_PATH');
    const privateKey = this.loadPemFromEnv('WECHAT_PAY_MERCHANT_PRIVATE_KEY', 'WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH');

    if (!appId || !mchId || !apiV3Key || !certSerial || !merchantCert || !privateKey) {
      this.logger.warn(
        '微信支付凭据未配齐（缺 APP_ID / MCH_ID / API_V3_KEY / CERT_SERIAL / MERCHANT_CERT / PRIVATE_KEY 其一），微信支付不可用',
      );
      return;
    }

    this.appId = appId;
    this.mchId = mchId;
    this.apiV3Key = apiV3Key;
    this.certSerial = certSerial;
    this.merchantCert = merchantCert;
    this.privateKey = privateKey;

    try {
      const WxPay = (await import('wechatpay-node-v3')).default;
      this.client = new (WxPay as any)({
        appid: appId,
        mchid: mchId,
        publicKey: Buffer.from(merchantCert),   // apiclient_cert.pem（商户证书）
        privateKey: Buffer.from(privateKey),    // apiclient_key.pem（商户私钥，签名用）
        key: apiV3Key,                          // APIv3 密钥（用于解密 notify body）
        serial_no: certSerial,                  // 商户证书序列号
      });
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

  private yuanToFen(amount: number, fieldName: string): number {
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
      this.isNonEmptyString(decrypted?.out_trade_no) &&
      this.isNonEmptyString(decrypted?.transaction_id) &&
      this.isNonEmptyString(decrypted?.trade_state) &&
      typeof decrypted?.amount?.total === 'number' &&
      Number.isInteger(decrypted.amount.total) &&
      Number.isSafeInteger(decrypted.amount.total) &&
      decrypted.amount.total >= 0
    );
  }

  private validatePaymentNotifyPayload(decrypted: any): number {
    if (
      !this.isNonEmptyString(decrypted?.out_trade_no) ||
      !this.isNonEmptyString(decrypted?.transaction_id) ||
      !this.isNonEmptyString(decrypted?.trade_state)
    ) {
      throw new Error('微信支付通知缺少必要字段');
    }
    return this.validateNotifyAmountFen(decrypted?.amount?.total);
  }

  private validateRefundNotifyPayload(decrypted: any): number {
    if (
      !this.isNonEmptyString(decrypted?.out_trade_no) ||
      !this.isNonEmptyString(decrypted?.out_refund_no) ||
      !this.isNonEmptyString(decrypted?.refund_id) ||
      !this.isNonEmptyString(decrypted?.refund_status)
    ) {
      throw new Error('微信退款通知缺少必要字段');
    }
    return this.validateNotifyAmountFen(decrypted?.amount?.refund);
  }

  isAvailable(): boolean {
    return this.client !== null;
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

    const notifyUrl = this.configService.get<string>(
      'WECHAT_PAY_NOTIFY_URL',
      'https://api.ai-maimai.com/api/v1/payments/wechat/notify',
    );

    const result = await this.client.transactions_app({
      appid: this.appId!,
      mchid: this.mchId!,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: notifyUrl,
      amount: {
        total,
        currency: 'CNY',
      },
      ...(params.timeExpire ? { time_expire: params.timeExpire.toISOString() } : {}),
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

    let verified: boolean;
    try {
      verified = await this.client.verifySign({
        timestamp: headers.timestamp,
        nonce: headers.nonce,
        body: rawBody,
        serial: headers.serial,
        signature: headers.signature,
        apiSecret: this.apiV3Key!,
      });
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
      decryptedRaw = await this.client.decipher_gcm(
        resource.ciphertext,
        resource.associated_data ?? '',
        resource.nonce,
        this.apiV3Key!,
      );
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
        const amountFen = this.validateRefundNotifyPayload(decrypted);
        return {
          type: 'refund',
          outTradeNo: decrypted.out_trade_no,
          outRefundNo: decrypted.out_refund_no,
          providerTxnId: decrypted.refund_id,
          tradeState: decrypted.refund_status,
          amountFen,
          amount: amountFen / 100,
          paidAt: decrypted.success_time ? new Date(decrypted.success_time) : undefined,
        };
      }

      if (!isPayment && !isCompatPayment) {
        throw new Error('微信通知事件类型不支持');
      }

      const amountFen = this.validatePaymentNotifyPayload(decrypted);
      return {
        type: 'payment',
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

  async queryOrder(outTradeNo: string): Promise<{
    tradeState: string;
    transactionId?: string;
    outTradeNo: string;
    totalAmountFen: number;
    totalAmount: number;
    paidAt?: Date;
  } | null> {
    if (!this.client) {
      return null;
    }

    try {
      this.validateOutTradeNo(outTradeNo);
    } catch {
      return null;
    }

    const outTradeNoForLog = this.maskBizId(outTradeNo);

    let result: any;
    try {
      result = await this.client.query({ out_trade_no: outTradeNo });
    } catch (err: any) {
      const code = String(err?.code || 'SDK_EXCEPTION');
      this.logger.error(
        `微信主动查单 SDK 调用失败: code=${code} outTradeNo=${outTradeNoForLog}`,
      );
      return null;
    }

    if (result?.status !== 200) {
      const { code } = this.parseSdkError(result, '微信主动查单失败');
      this.logger.error(
        `微信主动查单失败: status=${result?.status ?? 'UNKNOWN'} code=${code} outTradeNo=${outTradeNoForLog}`,
      );
      return null;
    }

    const data = result.data;
    try {
      if (
        !this.isNonEmptyString(data?.trade_state) ||
        !this.isNonEmptyString(data?.out_trade_no)
      ) {
        throw new Error('微信主动查单返回缺少必要字段');
      }

      if (data.out_trade_no !== outTradeNo) {
        this.logger.warn(
          `微信主动查单返回订单号不匹配: outTradeNo=${outTradeNoForLog} providerOutTradeNo=${this.maskBizId(data.out_trade_no)}`,
        );
        return null;
      }

      const totalAmountFen = this.validateNotifyAmountFen(data?.amount?.total);
      const parsed: {
        tradeState: string;
        transactionId?: string;
        outTradeNo: string;
        totalAmountFen: number;
        totalAmount: number;
        paidAt?: Date;
      } = {
        tradeState: data.trade_state,
        outTradeNo: data.out_trade_no,
        totalAmountFen,
        totalAmount: totalAmountFen / 100,
      };

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
      return null;
    }
  }

  async refund(params: {
    outTradeNo: string;
    outRefundNo: string;
    refundAmount: number;
    totalAmount: number;
    reason: string;
  }): Promise<{
    success: boolean;
    pending: boolean;
    providerRefundId?: string;
    message: string;
  }> {
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

    const notifyUrl = this.configService.get<string>(
      'WECHAT_PAY_NOTIFY_URL',
      'https://api.ai-maimai.com/api/v1/payments/wechat/notify',
    );

    const outTradeNoForLog = this.maskBizId(params.outTradeNo);
    const outRefundNoForLog = this.maskBizId(params.outRefundNo);

    let result: any;
    try {
      result = await this.client.refunds({
        out_trade_no: params.outTradeNo,
        out_refund_no: params.outRefundNo,
        reason: params.reason,
        notify_url: notifyUrl,
        amount: {
          refund,
          total,
          currency: 'CNY',
        },
      });
    } catch (err: any) {
      const code = String(err?.code || 'SDK_EXCEPTION');
      const message = String(err?.message || '微信退款调用失败');
      this.logger.error(
        `微信退款 SDK 调用失败: code=${code} outTradeNo=${outTradeNoForLog} outRefundNo=${outRefundNoForLog}`,
      );
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
      return {
        success: true,
        pending: false,
        providerRefundId,
        message: '退款成功',
      };
    }

    if (status === 'PROCESSING') {
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

  /** 暴露给上层做金额校验、防伪造（notify 路径用） */
  getAppId(): string | null { return this.appId; }
  getMchId(): string | null { return this.mchId; }
}
