import { createVerify } from 'crypto';

const WECHAT_PAY_API_ORIGIN = 'https://api.mch.weixin.qq.com';
const SIGNATURE_WINDOW_SECONDS = 5 * 60;
const DEFAULT_HTTP_TIMEOUT_MS = 8_000;

type WechatPaySdkResult = {
  status: number;
  data: any;
  error?: string;
};

type WechatPaySignatureHeaders = {
  signature?: string | null;
  timestamp?: string | null;
  nonce?: string | null;
  serial?: string | null;
};

function taggedError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function assertVerifiedWechatPaySignature(options: {
  publicKeyId: string;
  publicKey: string;
  headers: WechatPaySignatureHeaders;
  rawBody: string;
}): void {
  const { signature, timestamp, nonce, serial } = options.headers;
  if (!signature || !timestamp || !nonce || !serial) {
    throw taggedError('微信支付应答缺少验签头', 'WECHATPAY_SIGNATURE_MISSING');
  }
  if (serial !== options.publicKeyId) {
    throw taggedError('微信支付公钥 ID 不匹配', 'WECHATPAY_SERIAL_MISMATCH');
  }
  if (signature.startsWith('WECHATPAY/SIGNTEST/')) {
    throw taggedError('微信支付签名探测未通过', 'WECHATPAY_SIGNTEST');
  }

  const seconds = Number(timestamp);
  if (
    !/^\d{10}$/.test(timestamp)
    || !Number.isSafeInteger(seconds)
    || Math.abs(Math.floor(Date.now() / 1000) - seconds) > SIGNATURE_WINDOW_SECONDS
  ) {
    throw taggedError('微信支付应答时间戳无效或已过期', 'WECHATPAY_TIMESTAMP_INVALID');
  }

  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${options.rawBody}\n`);
    verifier.end();
    if (!verifier.verify(options.publicKey, signature, 'base64')) {
      throw taggedError('微信支付应答签名验证失败', 'INVALID_WECHATPAY_SIGNATURE');
    }
  } catch (error: any) {
    if (error?.code === 'INVALID_WECHATPAY_SIGNATURE') throw error;
    throw taggedError('微信支付公钥或应答签名无效', 'INVALID_WECHATPAY_SIGNATURE');
  }
}

/**
 * 为 wechatpay-node-v3 注入的安全传输层。
 *
 * 该 SDK 自带 transport 会丢弃 Wechatpay-* 应答头，导致上层无法验证
 * APIv3 应答来源。此实现保留原始 body，在解析前按微信官方三行签名串验签；
 * 缺头、过期、SIGNTEST、错误公钥 ID 或签名错误均直接 fail-closed。
 * 当前能力边界只覆盖本项目实际调用的 JSON API；文件上传和账单下载必须
 * 单独实现原始字节/下载 URL 的安全传输与验签，不能复用这里的 JSON 解析路径。
 */
export class VerifiedWechatPayHttpTransport {
  constructor(private readonly options: {
    publicKeyId: string;
    publicKey: string;
    timeoutMs?: number;
  }) {}

  async post(
    url: string,
    params: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<WechatPaySdkResult> {
    return this.request('POST', url, headers, JSON.stringify(params));
  }

  async get(
    url: string,
    headers: Record<string, string>,
  ): Promise<WechatPaySdkResult> {
    return this.request('GET', url, headers);
  }

  async upload(): Promise<never> {
    throw this.error('微信支付文件上传未接入已验签传输层', 'UNSUPPORTED_UPLOAD');
  }

  private async request(
    method: 'GET' | 'POST',
    rawUrl: string,
    headers: Record<string, string>,
    rawRequestBody?: string,
  ): Promise<WechatPaySdkResult> {
    const url = new URL(rawUrl);
    if (url.origin !== WECHAT_PAY_API_ORIGIN || url.username || url.password) {
      throw this.error('微信支付请求地址不受信任', 'UNTRUSTED_WECHATPAY_ORIGIN');
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        method,
        body: rawRequestBody,
        headers: {
          ...headers,
          // 在微信支付公钥切换期显式声明，要求应答使用该公钥对应私钥签名。
          // Authorization 中的 serial_no 仍是商户 API 证书序列号，两者用途不同。
          'Wechatpay-Serial': this.options.publicKeyId,
        },
        redirect: 'error',
        signal: controller.signal,
      });
      const rawBody = await response.text();
      assertVerifiedWechatPaySignature({
        publicKeyId: this.options.publicKeyId,
        publicKey: this.options.publicKey,
        headers: {
          signature: response.headers.get('wechatpay-signature'),
          timestamp: response.headers.get('wechatpay-timestamp'),
          nonce: response.headers.get('wechatpay-nonce'),
          serial: response.headers.get('wechatpay-serial'),
        },
        rawBody,
      });

      let data: any = {};
      if (rawBody) {
        try {
          data = JSON.parse(rawBody);
        } catch {
          throw this.error('微信支付应答不是有效 JSON', 'INVALID_WECHATPAY_JSON');
        }
      }

      return {
        status: response.status,
        data,
        ...(response.ok ? {} : { error: rawBody }),
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw this.error('微信支付请求超时', 'WECHATPAY_HTTP_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private error(message: string, code: string): Error & { code: string } {
    return taggedError(message, code);
  }
}
