import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  randomBytes,
} from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type WechatMerchantTransferState =
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'WAIT_USER_CONFIRM'
  | 'TRANSFERING'
  | 'SUCCESS'
  | 'FAIL'
  | 'CANCELING'
  | 'CANCELLED';

export type WechatMerchantTransferCreateResult = {
  /**
   * REJECTED is safe to settle locally only after two independent signals:
   * a signed 4xx response for the create call and a signed 404 for the same
   * out_bill_no.  It must never be used for an unverified/5xx response.
   */
  outcome: 'FOUND' | 'UNKNOWN' | 'REJECTED';
  state?: WechatMerchantTransferState;
  outBillNo: string;
  transferBillNo?: string;
  packageInfo?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type WechatMerchantTransferQueryResult =
  | {
      outcome: 'FOUND';
      state: WechatMerchantTransferState;
      mchId: string;
      appId: string;
      outBillNo: string;
      transferBillNo: string;
      /** 官方查询响应为选填；缺失时仅可结合已验签终态回调核验，Cron 不得自行收口。 */
      openId?: string;
      amountFen: number;
      failReason?: string;
    }
  | { outcome: 'NOT_FOUND'; outBillNo: string }
  | { outcome: 'UNKNOWN'; outBillNo: string; errorCode?: string };

export type WechatMerchantTransferNotify = {
  eventId: string;
  outBillNo: string;
  transferBillNo: string;
  state: 'SUCCESS' | 'FAIL' | 'CANCELLED';
  mchId: string;
  openId: string;
  amountFen: number;
  failReason?: string;
};

type SignedHttpResult = {
  status: number;
  rawBody: string;
  data: any;
};

const CREATE_PATH = '/v3/fund-app/mch-transfer/transfer-bills';
const QUERY_PATH_PREFIX = '/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/';
const CANCEL_PATH_SUFFIX = '/cancel';
const TRANSFER_STATES = new Set<WechatMerchantTransferState>([
  'ACCEPTED',
  'PROCESSING',
  'WAIT_USER_CONFIRM',
  'TRANSFERING',
  'SUCCESS',
  'FAIL',
  'CANCELING',
  'CANCELLED',
]);
const TERMINAL_NOTIFY_STATES = new Set(['SUCCESS', 'FAIL', 'CANCELLED']);
const SIGNATURE_WINDOW_SECONDS = 5 * 60;
const HTTP_TIMEOUT_MS = 8_000;

/**
 * 微信支付当前「商家转账」单笔用户确认模式 provider。
 *
 * 官方文档：
 * - 发起转账：https://pay.wechatpay.cn/doc/v3/merchant/4012716434
 * - 商户单号查询：https://pay.wechatpay.cn/doc/v3/merchant/4012716437
 * - JSAPI 确认收款：https://pay.wechatpay.cn/doc/v3/merchant/4012716430
 * - 终态回调：https://pay.wechatpay.cn/doc/v3/merchant/4012712115
 * - 微信支付公钥验签：https://pay.wechatpay.cn/doc/v3/merchant/4013053249
 */
@Injectable()
export class WechatMerchantTransferService implements OnModuleInit {
  private readonly logger = new Logger(WechatMerchantTransferService.name);
  private enabled = false;
  private appId = '';
  private mchId = '';
  private apiV3Key = '';
  private merchantCertSerial = '';
  private merchantPrivateKey = '';
  private wechatPayPublicKeyId = '';
  private wechatPayPublicKey = '';
  private notifyUrl = '';
  private transferSceneId = '';
  private transferRemark = '';
  private userRecvPerception = '';
  private transferSceneReportInfos: Array<{ info_type: string; info_content: string }> = [];

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.enabled = this.config.get<string>('WECHAT_TRANSFER_ENABLED', 'false') === 'true';
    this.appId = this.config.get<string>('WECHAT_MINIAPP_APP_ID', '').trim();
    this.mchId = this.config.get<string>('WECHAT_PAY_MCH_ID', '').trim();
    this.apiV3Key = this.config.get<string>('WECHAT_PAY_API_V3_KEY', '').trim();
    this.merchantCertSerial = this.config
      .get<string>('WECHAT_PAY_MERCHANT_CERT_SERIAL', '')
      .trim();
    this.merchantPrivateKey = this.loadPem(
      'WECHAT_PAY_MERCHANT_PRIVATE_KEY',
      'WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH',
    );
    this.wechatPayPublicKeyId = this.config
      .get<string>('WECHAT_PAY_PUBLIC_KEY_ID', '')
      .trim();
    this.wechatPayPublicKey = this.loadPem(
      'WECHAT_PAY_PUBLIC_KEY',
      'WECHAT_PAY_PUBLIC_KEY_PATH',
    );
    this.notifyUrl = this.config.get<string>('WECHAT_TRANSFER_NOTIFY_URL', '').trim();
    this.transferSceneId = this.config.get<string>('WECHAT_TRANSFER_SCENE_ID', '').trim();
    this.transferRemark = this.config
      .get<string>('WECHAT_TRANSFER_REMARK', 'AI爱买买佣金报酬提现')
      .trim();
    this.userRecvPerception = this.config
      .get<string>('WECHAT_TRANSFER_USER_RECV_PERCEPTION', '劳务报酬')
      .trim();
    this.transferSceneReportInfos = this.parseSceneReportInfos(
      this.config.get<string>('WECHAT_TRANSFER_SCENE_REPORT_INFOS_JSON', ''),
    );

    if (this.enabled && !this.hasCompleteCreateConfig()) {
      this.logger.error('微信商家转账新建已开启但配置不完整，该渠道将 fail-closed');
    }
  }

  /** 仅控制是否允许发起新的转账，不影响存量 PROCESSING 单据的安全收口。 */
  isAvailable(): boolean {
    return this.enabled && this.hasCompleteCreateConfig();
  }

  /**
   * 查单、撤销和回调验签只依赖结算凭据。紧急关闭新建后，存量单据仍必须
   * 能进入 SUCCESS / FAIL / CANCELLED 终态，避免钱包资金永久冻结。
   */
  isSettlementAvailable(): boolean {
    return this.hasCompleteSettlementConfig();
  }

  getMiniProgramAppId(): string {
    this.assertSettlementAvailable();
    return this.appId;
  }

  getMerchantId(): string {
    this.assertSettlementAvailable();
    return this.mchId;
  }

  /** 在冻结钱包资金前调用，避免已知不可出款条件制造永久 PROCESSING。 */
  assertTransferAmountSupported(amountFen: number): void {
    this.assertCreateAvailable();
    this.assertAmountFen(amountFen);
    // 官方规则：>= 2,000 元必须提供已核验姓名。当前统一钱包没有可信 KYC 姓名，不信任客户端姓名。
    if (amountFen >= 200_000) {
      throw new ServiceUnavailableException('微信大额提现实名校验尚未就绪');
    }
  }

  async createTransfer(params: {
    outBillNo: string;
    openId: string;
    amountFen: number;
  }): Promise<WechatMerchantTransferCreateResult> {
    this.assertCreateAvailable();
    this.assertOutBillNo(params.outBillNo);
    this.assertOpenId(params.openId);
    this.assertTransferAmountSupported(params.amountFen);

    const body = {
      appid: this.appId,
      out_bill_no: params.outBillNo,
      transfer_scene_id: this.transferSceneId,
      openid: params.openId,
      transfer_amount: params.amountFen,
      transfer_remark: this.transferRemark,
      notify_url: this.notifyUrl,
      user_recv_perception: this.userRecvPerception,
      transfer_scene_report_infos: this.transferSceneReportInfos,
    };

    let createErrorCode: string | undefined;
    let createErrorMessage: string | undefined;
    let isVerifiedClientRejection = false;
    try {
      const response = await this.signedRequest('POST', CREATE_PATH, body);
      if (response.status === 200) {
        return this.parseCreateResponse(response.data, params.outBillNo);
      }
      createErrorCode = this.readErrorCode(response.data) || `HTTP_${response.status}`;
      createErrorMessage = this.readErrorMessage(response.data);
      // A verified 4xx means WeChat did not accept the create request.  We
      // still query the exact original bill below before allowing a local
      // refund, because a retry must never be allowed to create a second bill.
      isVerifiedClientRejection = response.status >= 400 && response.status < 500;
      this.logger.warn(
        `微信商家转账发起被拒绝: outBillNo=${this.mask(params.outBillNo)} code=${createErrorCode}`,
      );
    } catch (error: any) {
      createErrorCode = String(error?.code || 'CREATE_EXCEPTION');
      this.logger.warn(
        `微信商家转账发起结果不明确: outBillNo=${this.mask(params.outBillNo)} code=${createErrorCode}`,
      );
    }

    // 任何超时、非 200、新错误码或无法验签应答都只查原单号，严禁换单号/改走旧 batches API。
    const queried = await this.queryTransfer(params.outBillNo);
    if (queried.outcome === 'FOUND') {
      return {
        outcome: 'FOUND',
        state: queried.state,
        outBillNo: queried.outBillNo,
        transferBillNo: queried.transferBillNo,
      };
    }
    return {
      outBillNo: params.outBillNo,
      // A verified HTTP error from the create request is the most useful diagnostic
      // when the follow-up query has no original bill yet. Keep the same outBillNo
      // for every retry; this only preserves the reason, never creates another payout.
      outcome: queried.outcome === 'NOT_FOUND' && isVerifiedClientRejection
        ? 'REJECTED'
        : 'UNKNOWN',
      errorCode: queried.outcome === 'NOT_FOUND'
        ? (createErrorCode || 'NOT_FOUND_AFTER_UNKNOWN_CREATE')
        : queried.errorCode,
      errorMessage: queried.outcome === 'NOT_FOUND' && isVerifiedClientRejection
        ? createErrorMessage
        : undefined,
    };
  }

  async queryTransfer(outBillNo: string): Promise<WechatMerchantTransferQueryResult> {
    this.assertSettlementAvailable();
    this.assertOutBillNo(outBillNo);
    const requestPath = `${QUERY_PATH_PREFIX}${encodeURIComponent(outBillNo)}`;
    try {
      const response = await this.signedRequest('GET', requestPath);
      if (response.status === 404) {
        return { outcome: 'NOT_FOUND', outBillNo };
      }
      if (response.status !== 200) {
        return {
          outcome: 'UNKNOWN',
          outBillNo,
          errorCode: this.readErrorCode(response.data) || `HTTP_${response.status}`,
        };
      }
      return this.parseQueryResponse(response.data, outBillNo);
    } catch (error: any) {
      return {
        outcome: 'UNKNOWN',
        outBillNo,
        errorCode: String(error?.code || 'QUERY_EXCEPTION'),
      };
    }
  }

  /**
   * 撤销一个无法再向用户交付确认参数的当前单笔商家转账。
   * 撤销请求仅表示微信已受理，最终仍必须通过原 outBillNo 查单确认 CANCELLED。
   */
  async cancelTransfer(outBillNo: string): Promise<{
    accepted: boolean;
    state?: 'CANCELING' | 'CANCELLED';
    transferBillNo?: string;
    errorCode?: string;
  }> {
    this.assertSettlementAvailable();
    this.assertOutBillNo(outBillNo);
    const requestPath = `${QUERY_PATH_PREFIX}${encodeURIComponent(outBillNo)}${CANCEL_PATH_SUFFIX}`;
    try {
      // 官方要求无请求报文主体；签名串末行仍为空串，不能发送或签名 `{}`。
      const response = await this.signedRequest('POST', requestPath);
      if (response.status === 200) {
        if (
          response.data?.out_bill_no !== outBillNo
          || typeof response.data?.transfer_bill_no !== 'string'
          || !response.data.transfer_bill_no
          || (response.data?.state !== 'CANCELING' && response.data?.state !== 'CANCELLED')
        ) {
          return { accepted: false, errorCode: 'CANCEL_RESPONSE_MISMATCH' };
        }
        return {
          accepted: true,
          state: response.data.state,
          transferBillNo: response.data.transfer_bill_no,
        };
      }
      return {
        accepted: false,
        errorCode: this.readErrorCode(response.data) || `HTTP_${response.status}`,
      };
    } catch (error: any) {
      return { accepted: false, errorCode: String(error?.code || 'CANCEL_EXCEPTION') };
    }
  }

  parseNotify(args: {
    rawBody: string;
    headers: {
      signature?: string;
      timestamp?: string;
      nonce?: string;
      serial?: string;
    };
    body: any;
  }): WechatMerchantTransferNotify {
    this.assertSettlementAvailable();
    const { signature, timestamp, nonce, serial } = args.headers;
    if (!signature || !timestamp || !nonce || !serial) {
      throw new Error('微信转账回调缺少验签头');
    }
    this.assertFreshTimestamp(timestamp);
    this.verifyWechatSignature({ signature, timestamp, nonce, serial, rawBody: args.rawBody });

    let signedBody: any;
    try {
      signedBody = JSON.parse(args.rawBody);
    } catch {
      throw new Error('微信转账回调 rawBody 非法');
    }

    if (
      typeof signedBody?.id !== 'string'
      || !signedBody.id
      || signedBody.id.length > 128
      ||
      signedBody?.event_type !== 'MCHTRANSFER.BILL.FINISHED'
      || signedBody?.resource_type !== 'encrypt-resource'
      || signedBody?.resource?.original_type !== 'mch_payment'
      || signedBody?.resource?.algorithm !== 'AEAD_AES_256_GCM'
    ) {
      throw new Error('微信转账回调类型无效');
    }
    const decrypted = this.decryptResource(signedBody.resource);
    if (!TERMINAL_NOTIFY_STATES.has(decrypted?.state)) {
      throw new Error('微信转账回调状态非终态');
    }
    this.assertOutBillNo(decrypted?.out_bill_no);
    this.assertOpenId(decrypted?.openid);
    this.assertAmountFen(decrypted?.transfer_amount);
    if (
      typeof decrypted?.transfer_bill_no !== 'string'
      || !decrypted.transfer_bill_no
      || typeof decrypted?.mch_id !== 'string'
      || !decrypted.mch_id
    ) {
      throw new Error('微信转账回调缺少必要字段');
    }
    return {
      eventId: signedBody.id,
      outBillNo: decrypted.out_bill_no,
      transferBillNo: decrypted.transfer_bill_no,
      state: decrypted.state,
      mchId: decrypted.mch_id,
      openId: decrypted.openid,
      amountFen: decrypted.transfer_amount,
      failReason: typeof decrypted.fail_reason === 'string' ? decrypted.fail_reason : undefined,
    };
  }

  private async signedRequest(
    method: 'GET' | 'POST',
    requestPath: string,
    body?: Record<string, unknown>,
  ): Promise<SignedHttpResult> {
    const rawRequestBody = body ? JSON.stringify(body) : '';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const signature = this.signRequest(method, requestPath, timestamp, nonce, rawRequestBody);
    const authorization =
      'WECHATPAY2-SHA256-RSA2048 ' +
      `mchid="${this.mchId}",nonce_str="${nonce}",signature="${signature}",` +
      `timestamp="${timestamp}",serial_no="${this.merchantCertSerial}"`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const response = await fetch(`https://api.mch.weixin.qq.com${requestPath}`, {
        method,
        body: body ? rawRequestBody : undefined,
        signal: controller.signal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: authorization,
          'Wechatpay-Serial': this.wechatPayPublicKeyId,
          'User-Agent': 'ai-maimai-wechat-transfer/1.0',
        },
      });
      const rawBody = await response.text();
      const responseHeaders = {
        signature: response.headers.get('wechatpay-signature') ?? undefined,
        timestamp: response.headers.get('wechatpay-timestamp') ?? undefined,
        nonce: response.headers.get('wechatpay-nonce') ?? undefined,
        serial: response.headers.get('wechatpay-serial') ?? undefined,
      };
      if (
        !responseHeaders.signature
        || !responseHeaders.timestamp
        || !responseHeaders.nonce
        || !responseHeaders.serial
      ) {
        throw Object.assign(new Error('微信转账应答缺少签名'), { code: 'RESPONSE_SIGNATURE_MISSING' });
      }
      this.assertFreshTimestamp(responseHeaders.timestamp);
      this.verifyWechatSignature({
        signature: responseHeaders.signature,
        timestamp: responseHeaders.timestamp,
        nonce: responseHeaders.nonce,
        serial: responseHeaders.serial,
        rawBody,
      });
      let data: any = {};
      if (rawBody) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          throw Object.assign(new Error('微信转账应答非法'), { code: 'INVALID_JSON_RESPONSE' });
        }
      }
      return { status: response.status, rawBody, data };
    } finally {
      clearTimeout(timeout);
    }
  }

  private signRequest(
    method: string,
    requestPath: string,
    timestamp: string,
    nonce: string,
    rawBody: string,
  ): string {
    const signer = createSign('RSA-SHA256');
    signer.update(`${method}\n${requestPath}\n${timestamp}\n${nonce}\n${rawBody}\n`);
    signer.end();
    return signer.sign(this.merchantPrivateKey, 'base64');
  }

  private verifyWechatSignature(args: {
    signature: string;
    timestamp: string;
    nonce: string;
    serial: string;
    rawBody: string;
  }): void {
    if (args.serial !== this.wechatPayPublicKeyId) {
      throw Object.assign(new Error('微信支付公钥 ID 不匹配'), { code: 'WECHATPAY_SERIAL_MISMATCH' });
    }
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${args.timestamp}\n${args.nonce}\n${args.rawBody}\n`);
    verifier.end();
    if (!verifier.verify(this.wechatPayPublicKey, args.signature, 'base64')) {
      throw Object.assign(new Error('微信转账签名验证失败'), { code: 'INVALID_WECHATPAY_SIGNATURE' });
    }
  }

  private decryptResource(resource: any): any {
    if (
      typeof resource?.ciphertext !== 'string'
      || typeof resource?.nonce !== 'string'
      || (resource?.associated_data !== undefined && typeof resource.associated_data !== 'string')
    ) {
      throw new Error('微信转账回调密文字段不完整');
    }
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    if (encrypted.length <= 16) throw new Error('微信转账回调密文无效');
    const ciphertext = encrypted.subarray(0, encrypted.length - 16);
    const authTag = encrypted.subarray(encrypted.length - 16);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(resource.associated_data ?? '', 'utf8'));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
  }

  private parseCreateResponse(data: any, expectedOutBillNo: string): WechatMerchantTransferCreateResult {
    this.assertOutBillNo(data?.out_bill_no);
    if (
      data.out_bill_no !== expectedOutBillNo
      || typeof data?.transfer_bill_no !== 'string'
      || !data.transfer_bill_no
      || !TRANSFER_STATES.has(data?.state)
    ) {
      throw Object.assign(new Error('微信转账发起应答字段不匹配'), { code: 'CREATE_RESPONSE_MISMATCH' });
    }
    if (
      data.state === 'WAIT_USER_CONFIRM'
      && (typeof data.package_info !== 'string' || !data.package_info)
    ) {
      throw Object.assign(new Error('微信转账待确认应答缺少 package_info'), { code: 'PACKAGE_INFO_MISSING' });
    }
    return {
      outcome: 'FOUND',
      state: data.state,
      outBillNo: data.out_bill_no,
      transferBillNo: data.transfer_bill_no,
      packageInfo: data.state === 'WAIT_USER_CONFIRM' ? data.package_info : undefined,
    };
  }

  private parseQueryResponse(data: any, expectedOutBillNo: string): WechatMerchantTransferQueryResult {
    if (
      typeof data?.mch_id !== 'string'
      || typeof data?.appid !== 'string'
      || typeof data?.out_bill_no !== 'string'
      || typeof data?.transfer_bill_no !== 'string'
      || (data?.openid !== undefined && (typeof data.openid !== 'string' || !data.openid))
      || !TRANSFER_STATES.has(data?.state)
      || !Number.isSafeInteger(data?.transfer_amount)
      || data.transfer_amount <= 0
      || data.out_bill_no !== expectedOutBillNo
    ) {
      return { outcome: 'UNKNOWN', outBillNo: expectedOutBillNo, errorCode: 'QUERY_RESPONSE_MISMATCH' };
    }
    return {
      outcome: 'FOUND',
      state: data.state,
      mchId: data.mch_id,
      appId: data.appid,
      outBillNo: data.out_bill_no,
      transferBillNo: data.transfer_bill_no,
      openId: typeof data.openid === 'string' ? data.openid : undefined,
      amountFen: data.transfer_amount,
      failReason: typeof data.fail_reason === 'string' ? data.fail_reason : undefined,
    };
  }

  private assertFreshTimestamp(timestamp: string): void {
    if (!/^\d{10,13}$/.test(timestamp)) throw new Error('微信转账时间戳无效');
    const raw = Number(timestamp);
    const seconds = timestamp.length === 13 ? Math.floor(raw / 1000) : raw;
    if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > SIGNATURE_WINDOW_SECONDS) {
      throw new Error('微信转账签名已过期');
    }
  }

  private assertOutBillNo(outBillNo: unknown): asserts outBillNo is string {
    if (typeof outBillNo !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(outBillNo)) {
      throw new Error('微信商户转账单号必须为 1-32 位字母或数字');
    }
  }

  private assertOpenId(openId: unknown): asserts openId is string {
    if (typeof openId !== 'string' || !openId || openId.length > 64) {
      throw new Error('微信收款 OpenID 无效');
    }
  }

  private assertAmountFen(amountFen: unknown): asserts amountFen is number {
    if (!Number.isSafeInteger(amountFen) || Number(amountFen) <= 0) {
      throw new Error('微信转账金额必须为正整数分');
    }
  }

  private assertCreateAvailable(): void {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException('微信提现新建通道配置不可用');
    }
  }

  private assertSettlementAvailable(): void {
    if (!this.isSettlementAvailable()) {
      throw new ServiceUnavailableException('微信提现结算通道配置不可用');
    }
  }

  private hasCompleteSettlementConfig(): boolean {
    return Boolean(
      this.appId
      && this.mchId
      && this.apiV3Key.length === 32
      && this.merchantCertSerial
      && this.merchantPrivateKey
      && /^PUB_KEY_ID_\d+$/.test(this.wechatPayPublicKeyId)
      && this.wechatPayPublicKey
      && this.hasValidSigningKeys()
    );
  }

  private hasCompleteCreateConfig(): boolean {
    return Boolean(
      this.hasCompleteSettlementConfig()
      && /^https:\/\/[^?]+$/.test(this.notifyUrl)
      && this.transferSceneId === '1005'
      && this.transferRemark
      && this.transferRemark.length <= 32
      && this.hasValidUserRecvPerception()
      && this.hasRequiredSceneReportInfos()
    );
  }

  /**
   * 微信支付“佣金报酬”场景（1005）要求且只允许两条不同的固定报备类型。
   * 不能把别的场景的一条通用报备误带入 1005，否则宁可 fail-closed。
   */
  private hasRequiredSceneReportInfos(): boolean {
    if (this.transferSceneReportInfos.length !== 2) return false;
    const reportInfos = new Map(
      this.transferSceneReportInfos.map((item) => [item.info_type, item.info_content]),
    );
    return reportInfos.size === 2
      && reportInfos.get('岗位类型') === '平台推广人员'
      && reportInfos.get('报酬说明') === 'AI爱买买平台推广佣金';
  }

  /**
   * The 1005 commission-remuneration scenario accepts only the four official
   * user-facing descriptions. A wrong deployment value must leave the payout
   * channel unavailable instead of creating transfers that WeChat rejects.
   */
  private hasValidUserRecvPerception(): boolean {
    return this.userRecvPerception === '劳务报酬';
  }

  private hasValidSigningKeys(): boolean {
    try {
      const privateKey = createPrivateKey(this.merchantPrivateKey);
      const publicKey = createPublicKey(this.wechatPayPublicKey);
      return privateKey.asymmetricKeyType === 'rsa' && publicKey.asymmetricKeyType === 'rsa';
    } catch {
      return false;
    }
  }

  private loadPem(inlineKey: string, pathKey: string): string {
    const inline = this.config.get<string>(inlineKey, '').trim();
    if (inline) return inline.replace(/\\n/g, '\n');
    const configuredPath = this.config.get<string>(pathKey, '').trim();
    if (!configuredPath) return '';
    try {
      return fs.readFileSync(path.resolve(process.cwd(), configuredPath), 'utf8').trim();
    } catch {
      return '';
    }
  }

  private parseSceneReportInfos(raw: string): Array<{ info_type: string; info_content: string }> {
    try {
      const parsed = JSON.parse(raw || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          info_type: String(item.info_type || '').trim(),
          info_content: String(item.info_content || '').trim(),
        }))
        .filter((item) => item.info_type.length > 0 && item.info_type.length <= 15
          && item.info_content.length > 0 && item.info_content.length <= 32);
    } catch {
      return [];
    }
  }

  private readErrorCode(data: any): string | undefined {
    return typeof data?.code === 'string' ? data.code : undefined;
  }

  private readErrorMessage(data: any): string | undefined {
    const message = typeof data?.message === 'string' ? data.message.trim() : '';
    // Provider messages can be stored in the operations record, but keep a
    // bounded value so an unexpected upstream payload cannot bloat the row.
    return message ? message.slice(0, 500) : undefined;
  }

  private mask(value: string): string {
    return value.length <= 8 ? '[REDACTED]' : `${value.slice(0, 4)}***${value.slice(-4)}`;
  }
}
