import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlipaySdk } from 'alipay-sdk';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AlipayService implements OnModuleInit {
  private readonly logger = new Logger(AlipayService.name);
  private sdk: AlipaySdk | null = null;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const appId = this.configService.get<string>('ALIPAY_APP_ID');
    if (!appId) {
      this.logger.warn('ALIPAY_APP_ID 未配置，支付宝支付不可用');
      return;
    }

    try {
      const privateKey = this.loadPrivateKey();
      const gateway = this.configService.get<string>('ALIPAY_GATEWAY');
      const endpoint = this.configService.get<string>('ALIPAY_ENDPOINT');
      const alipayPublicKey = this.configService.get<string>('ALIPAY_PUBLIC_KEY');

      // 公钥模式（沙箱环境）：配置了 ALIPAY_PUBLIC_KEY
      // 证书模式（生产环境）：配置了 ALIPAY_APP_CERT_PATH
      if (alipayPublicKey) {
        this.sdk = new AlipaySdk({
          appId,
          privateKey,
          signType: 'RSA2',
          alipayPublicKey,
          ...(gateway ? { gateway } : {}),
          ...(endpoint ? { endpoint } : {}),
        });
        this.logger.log(`支付宝 SDK 初始化成功（公钥模式），AppID: ${appId}`);
      } else {
        const basePath = path.resolve(process.cwd());
        const appCertContent = fs.readFileSync(
          path.resolve(basePath, this.configService.get<string>('ALIPAY_APP_CERT_PATH', 'certs/alipay/appCertPublicKey.crt')),
          'utf-8',
        );
        const publicCertContent = fs.readFileSync(
          path.resolve(basePath, this.configService.get<string>('ALIPAY_PUBLIC_CERT_PATH', 'certs/alipay/alipayCertPublicKey.crt')),
          'utf-8',
        );
        const rootCertContent = fs.readFileSync(
          path.resolve(basePath, this.configService.get<string>('ALIPAY_ROOT_CERT_PATH', 'certs/alipay/alipayRootCert.crt')),
          'utf-8',
        );

        this.sdk = new AlipaySdk({
          appId,
          privateKey,
          signType: 'RSA2',
          appCertContent,
          alipayPublicCertContent: publicCertContent,
          alipayRootCertContent: rootCertContent,
          ...(gateway ? { gateway } : {}),
          ...(endpoint ? { endpoint } : {}),
        });
        this.logger.log(`支付宝 SDK 初始化成功（证书模式），AppID: ${appId}`);
      }
    } catch (err: any) {
      this.logger.error(`支付宝 SDK 初始化失败: ${err.message}`);
      if (process.env.NODE_ENV === 'production') {
        throw err; // 生产环境证书加载失败必须阻止启动
      }
    }
  }

  private loadPrivateKey(): string {
    const inline = this.configService.get<string>('ALIPAY_PRIVATE_KEY');
    if (inline) return inline.trim();

    const keyPath = this.configService.get<string>('ALIPAY_PRIVATE_KEY_PATH');
    if (keyPath) {
      return fs.readFileSync(path.resolve(process.cwd(), keyPath), 'utf-8').trim();
    }

    throw new Error('ALIPAY_PRIVATE_KEY 或 ALIPAY_PRIVATE_KEY_PATH 必须配置其一');
  }

  /** 是否可用 */
  isAvailable(): boolean {
    return this.sdk !== null;
  }

  /**
   * 生成 APP 支付参数（orderStr）
   * 前端拿到 orderStr 后调用支付宝 SDK 调起支付
   */
  async createAppPayOrder(params: {
    merchantOrderNo: string;
    totalAmount: number;
    subject: string;
    body?: string;
  }): Promise<string> {
    if (!this.sdk) {
      throw new Error('支付宝 SDK 未初始化');
    }

    const notifyUrl = this.configService.get<string>(
      'ALIPAY_NOTIFY_URL',
      // NestJS 全局前缀 setGlobalPrefix('api/v1')，回调路径必须带 /api/v1
      'https://api.ai-maimai.com/api/v1/payments/alipay/notify',
    );

    // sdkExecute 是同步方法，返回完整的 orderStr，可直接传给客户端调起支付宝
    const result = this.sdk.sdkExecute('alipay.trade.app.pay', {
      bizContent: {
        out_trade_no: params.merchantOrderNo,
        total_amount: params.totalAmount.toFixed(2),
        subject: params.subject,
        body: params.body || '',
        product_code: 'QUICK_MSECURITY_PAY',
        // 30 分钟超时（与 CheckoutSession 过期时间一致）
        timeout_express: '30m',
      },
      notify_url: notifyUrl,
    });

    return result as string;
  }

  /**
   * 验证支付宝异步通知签名
   * @param postData 支付宝 POST 过来的 form 数据
   */
  async verifyNotify(postData: Record<string, string>): Promise<boolean> {
    if (!this.sdk) {
      this.logger.error('支付宝 SDK 未初始化，无法验签');
      return false;
    }

    try {
      return await this.sdk.checkNotifySignV2(postData);
    } catch (err: any) {
      this.logger.error(`支付宝验签异常: ${err.message}`);
      return false;
    }
  }

  /**
   * 发起退款
   */
  async refund(params: {
    merchantOrderNo: string;
    refundAmount: number;
    merchantRefundNo: string;
    refundReason?: string;
  }): Promise<{ success: boolean; fundChange: string; message: string }> {
    if (!this.sdk) {
      throw new Error('支付宝 SDK 未初始化');
    }

    const result = await this.sdk.exec('alipay.trade.refund', {
      bizContent: {
        out_trade_no: params.merchantOrderNo,
        refund_amount: params.refundAmount.toFixed(2),
        out_request_no: params.merchantRefundNo,
        refund_reason: params.refundReason || '用户退款',
      },
    }) as any;

    const success = result.code === '10000';
    if (!success) {
      this.logger.warn(`支付宝退款失败: ${result.code} - ${result.msg || result.subMsg}`);
    }

    return {
      success,
      fundChange: result.fundChange || 'N',
      message: result.msg || result.subMsg || '',
    };
  }

  /**
   * 查询订单支付状态
   */
  async queryOrder(merchantOrderNo: string): Promise<{
    tradeStatus: string;
    tradeNo: string;
    totalAmount: string;
  } | null> {
    if (!this.sdk) {
      throw new Error('支付宝 SDK 未初始化');
    }

    const result = await this.sdk.exec('alipay.trade.query', {
      bizContent: {
        out_trade_no: merchantOrderNo,
      },
    }) as any;

    if (result.code !== '10000') {
      return null;
    }

    return {
      tradeStatus: result.tradeStatus,
      tradeNo: result.tradeNo,
      totalAmount: result.totalAmount,
    };
  }
}
