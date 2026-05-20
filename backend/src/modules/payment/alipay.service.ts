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
    const returnUrl = this.configService.get<string>('ALIPAY_RETURN_URL', 'aimaimai://alipay');

    // sdkExecute 是同步方法，返回完整的 orderStr，可直接传给客户端调起支付宝
    const result = this.sdk.sdkExecute('alipay.trade.app.pay', {
      alipaySdk: (this.sdk as any).version ?? 'alipay-sdk-nodejs-4.0.0',
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
      return_url: returnUrl,
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

    // 关键：失败时拼出完整诊断信息（code + sub_code + sub_msg）
    // 之前只透出 result.msg = "Business Failed"——通用错误无法定位真实原因。
    // 支付宝错误码:
    //   code=40004 是通用业务失败外壳，sub_code 才是真实原因
    //   ACQ.TRADE_NOT_EXIST     订单不存在（最常见：mock 数据没真走支付宝）
    //   ACQ.TRADE_HAS_FINISHED  交易已完结
    //   ACQ.SELLER_BALANCE_NOT_ENOUGH  商户账户余额不足
    const failureMessage = (() => {
      if (success) return '';
      const parts: string[] = [];
      if (result.msg) parts.push(result.msg);
      if (result.subCode) parts.push(`[${result.subCode}]`);
      if (result.subMsg) parts.push(result.subMsg);
      return parts.join(' ') || '未知错误';
    })();

    if (!success) {
      this.logger.warn(
        `支付宝退款失败: code=${result.code}, sub_code=${result.subCode || 'N/A'}, ` +
          `msg=${result.msg || 'N/A'}, sub_msg=${result.subMsg || 'N/A'}, ` +
          `merchantRefundNo=${params.merchantRefundNo}`,
      );
    }

    return {
      success,
      fundChange: result.fundChange || 'N',
      message: failureMessage,
    };
  }

  /**
   * 商家到个人单笔转账（用户提现到支付宝）。
   */
  async transferToAccount(params: {
    outBizNo: string;
    amount: number;
    payeeAccount: string;
    payeeRealName: string;
    remark?: string;
  }): Promise<{
    success: boolean;
    processing: boolean;
    outBizNo: string;
    orderId?: string;
    payFundOrderId?: string;
    providerStatus?: string;
    errorCode?: string;
    errorMessage?: string;
    raw: any;
  }> {
    if (!this.sdk) {
      throw new Error('支付宝 SDK 未初始化');
    }

    const result = await this.sdk.exec('alipay.fund.trans.uni.transfer', {
      bizContent: {
        out_biz_no: params.outBizNo,
        trans_amount: params.amount.toFixed(2),
        product_code: 'TRANS_ACCOUNT_NO_PWD',
        biz_scene: 'DIRECT_TRANSFER',
        order_title: '爱买买消费积分提现',
        payee_info: {
          identity: params.payeeAccount,
          identity_type: 'ALIPAY_LOGON_ID',
          name: params.payeeRealName,
        },
        remark: params.remark || '爱买买消费积分提现',
      },
    }) as any;

    const code = result.code;
    const subCode = result.subCode;
    const success = code === '10000';
    const processing =
      !success &&
      (
        code === '10003' ||
        code === '20000' ||
        subCode === 'SYSTEM_ERROR' ||
        subCode === 'REQUEST_PROCESSING'
      );
    const errorMessage = success
      ? undefined
      : [result.msg, subCode ? `[${subCode}]` : '', result.subMsg]
        .filter(Boolean)
        .join(' ')
        .trim() || '未知错误';

    return {
      success,
      processing,
      outBizNo: params.outBizNo,
      orderId: result.orderId,
      payFundOrderId: result.payFundOrderId,
      providerStatus: result.status,
      errorCode: subCode,
      errorMessage,
      raw: result,
    };
  }

  async queryTransfer(params: {
    outBizNo?: string;
    orderId?: string;
  }): Promise<{
    status: 'SUCCESS' | 'PROCESSING' | 'FAIL' | 'NOT_FOUND';
    orderId?: string;
    payFundOrderId?: string;
    payDate?: Date;
    errorCode?: string;
    errorMessage?: string;
    raw: any;
  }> {
    if (!this.sdk) {
      throw new Error('支付宝 SDK 未初始化');
    }

    const bizContent: Record<string, string> = {
      product_code: 'TRANS_ACCOUNT_NO_PWD',
      biz_scene: 'DIRECT_TRANSFER',
    };
    if (params.outBizNo) bizContent.out_biz_no = params.outBizNo;
    if (params.orderId) bizContent.order_id = params.orderId;

    const result = await this.sdk.exec('alipay.fund.trans.common.query', {
      bizContent,
    }) as any;

    if (result.code !== '10000') {
      const subCode = result.subCode;
      const errorMessage = result.subMsg || result.msg || '未知错误';
      const processing =
        result.code === '10003' ||
        result.code === '20000' ||
        subCode === 'SYSTEM_ERROR' ||
        subCode === 'REQUEST_PROCESSING';
      if (
        subCode === 'ORDER_NOT_EXIST' ||
        subCode === 'PAYMENT_NOT_EXIST' ||
        subCode === 'ACQ.TRADE_NOT_EXIST'
      ) {
        return {
          status: 'NOT_FOUND',
          errorCode: subCode,
          errorMessage,
          raw: result,
        };
      }
      if (processing) {
        return {
          status: 'PROCESSING',
          errorCode: subCode,
          errorMessage,
          raw: result,
        };
      }
      return {
        status: 'FAIL',
        errorCode: subCode,
        errorMessage,
        raw: result,
      };
    }

    const providerStatus = result.status;
    const status: 'SUCCESS' | 'PROCESSING' | 'FAIL' =
      providerStatus === 'SUCCESS'
        ? 'SUCCESS'
        : (providerStatus === 'FAIL' || providerStatus === 'CLOSED')
          ? 'FAIL'
          : 'PROCESSING';

    return {
      status,
      orderId: result.orderId,
      payFundOrderId: result.payFundOrderId,
      payDate: result.payDate ? new Date(result.payDate) : undefined,
      raw: result,
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

  /**
   * 调用支付宝 alipay.trade.close 关闭未支付的交易。
   *
   * 资金安全：取消/过期 session 前必须先关闭支付宝交易，
   *           否则用户在我们改 EXPIRED 之后才付款会导致状态不一致。
   *
   * @returns
   *   - { success: true } close 成功（支付宝侧交易已关闭）
   *   - { success: true, terminal: true } 支付宝侧交易未支付且已是终态（不存在/已关闭），本地可安全 EXPIRE
   *   - { success: false, alreadyPaid: true } 支付宝返回已支付/已完成状态码（调用方必须查单建单）
   *   - { success: false } close 失败（接口异常 / 未初始化），让 cron 重试
   *   - throws 网络异常时抛出
   */
  async closeOrder(merchantOrderNo: string): Promise<{
    success: boolean;
    /** 支付宝侧未支付且无需处理（不存在 / 已关闭）— 本地可以安全 EXPIRE */
    terminal?: boolean;
    /** 支付宝侧已支付 / 已完成（含退款）— 调用方必须查单建单 */
    alreadyPaid?: boolean;
  }> {
    if (!this.sdk) {
      this.logger.warn(`alipay.trade.close 跳过：SDK 未初始化，merchantOrderNo=${merchantOrderNo}`);
      return { success: false };
    }
    try {
      const result = await this.sdk.exec('alipay.trade.close', {
        bizContent: { out_trade_no: merchantOrderNo },
      }) as any;
      if (result.code === '10000') {
        return { success: true };
      }
      // 已支付 / 已完成（含退款）— 调用方必须查单识别
      // - ACQ.TRADE_STATUS_ERROR / TRADE_STATUS_ERROR：交易状态不允许 close（已支付）
      // - ACQ.TRADE_HAS_FINISHED：交易已完成（已支付，可能伴随退款）— 不是"未支付/不存在"
      const subCode: string | undefined = result.subCode;
      if (
        subCode === 'ACQ.TRADE_STATUS_ERROR' ||
        subCode === 'TRADE_STATUS_ERROR' ||
        subCode === 'ACQ.TRADE_HAS_FINISHED'
      ) {
        this.logger.warn(
          `alipay.trade.close 返回已支付/已完成：merchantOrderNo=${merchantOrderNo}, subCode=${subCode}`,
        );
        return { success: false, alreadyPaid: true };
      }
      // 真正的"无需处理"终态：交易不存在 / 已关闭（未支付）— 本地可安全 EXPIRE
      // - ACQ.TRADE_NOT_EXIST：用户 SDK 调起后未真起支付（最常见）
      // - ACQ.TRADE_HAS_CLOSE：交易已关闭（未支付）
      if (
        subCode === 'ACQ.TRADE_NOT_EXIST' ||
        subCode === 'ACQ.TRADE_HAS_CLOSE'
      ) {
        this.logger.log(
          `alipay.trade.close 终态返回（无需处理）：merchantOrderNo=${merchantOrderNo}, subCode=${subCode}`,
        );
        return { success: true, terminal: true };
      }
      // 其他错误：暂时失败，让调用方决定是否重试
      this.logger.warn(
        `alipay.trade.close 失败：merchantOrderNo=${merchantOrderNo}, code=${result.code}, subCode=${subCode}, msg=${result.msg || result.subMsg}`,
      );
      return { success: false };
    } catch (err: any) {
      this.logger.error(
        `alipay.trade.close 异常：merchantOrderNo=${merchantOrderNo}, error=${err.message}`,
      );
      throw err;
    }
  }
}
