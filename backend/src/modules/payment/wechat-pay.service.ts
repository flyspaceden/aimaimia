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

  /** 暴露给上层做金额校验、防伪造（notify 路径用） */
  getAppId(): string | null { return this.appId; }
  getMchId(): string | null { return this.mchId; }
}
