import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

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
    signType: string;
    paySign: string;
  }> {
    if (!this.client) {
      throw new Error('微信支付 SDK 未初始化');
    }

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
        total: Math.round(params.amount * 100),
        currency: 'CNY',
      },
      ...(params.timeExpire ? { time_expire: params.timeExpire.toISOString() } : {}),
    });

    if (result?.status !== 200) {
      let parsedError: any = {};
      try {
        parsedError = result?.error ? JSON.parse(result.error) : {};
      } catch {
        parsedError = {};
      }
      const code = parsedError?.code || result?.code || 'UNKNOWN';
      const message = parsedError?.message || result?.message || result?.error || JSON.stringify(result);
      this.logger.error(`微信支付下单失败: code=${code} message=${message}`);
      throw new Error(`微信支付下单失败 [${code}] ${message}`);
    }

    const data = result.data;
    if (!data?.prepayid || !data?.sign) {
      throw new Error(`微信支付下单返回缺少 prepayid/sign: ${JSON.stringify(result)}`);
    }

    return {
      appId: data.appid,
      partnerId: data.partnerid ?? this.mchId!,
      timestamp: data.timestamp,
      nonceStr: data.noncestr,
      prepayId: data.prepayid,
      packageVal: data.package,
      signType: 'RSA',
      paySign: data.sign,
    };
  }

  /** 暴露给上层做金额校验、防伪造（notify 路径用） */
  getAppId(): string | null { return this.appId; }
  getMchId(): string | null { return this.mchId; }
}
