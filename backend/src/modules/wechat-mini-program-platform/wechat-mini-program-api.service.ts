import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeErrorForLog } from '../../common/logging/log-sanitizer';

const WECHAT_API_ORIGIN = 'https://api.weixin.qq.com';
const STABLE_TOKEN_PATH = '/cgi-bin/stable_token';
const TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BINARY_RESPONSE_BYTES = 1024 * 1024;
const INVALID_TOKEN_CODES = new Set([40001, 40014, 42001]);

type WechatApiErrorBody = {
  errcode?: number;
  errmsg?: string;
};

export class WechatMiniProgramApiError extends Error {
  constructor(
    readonly errcode: number,
    message: string,
  ) {
    super(message);
    this.name = 'WechatMiniProgramApiError';
  }
}

/**
 * 微信小程序服务端 API 基础客户端。
 *
 * - 统一使用 stable_token 普通模式并在内存中提前五分钟刷新；
 * - AppSecret/access_token 永不进入日志；
 * - 只接受相对路径，阻止调用方把 token 带到任意第三方主机；
 * - token 失效错误清本地缓存后按 stable_token 普通模式重取并重试一次，
 *   避免多进程 force_refresh 互相废掉刚取得的 token。
 */
@Injectable()
export class WechatMiniProgramApiService implements OnModuleInit {
  private readonly logger = new Logger(WechatMiniProgramApiService.name);
  private appId = '';
  private appSecret = '';
  private mockEnabled = false;
  private productionMockRejected = false;
  private cachedToken: { value: string; expiresAtMs: number } | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.appId = this.config.get<string>('WECHAT_MINIAPP_APP_ID', '').trim();
    this.appSecret = this.config.get<string>('WECHAT_MINIAPP_APP_SECRET', '').trim();
    const mockSetting = this.config.get<string>('WECHAT_MINIAPP_MOCK');
    const mockRequested = mockSetting === 'true';
    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    this.productionMockRejected = nodeEnv === 'production' && mockSetting !== 'false';
    this.mockEnabled = mockRequested && !this.productionMockRejected;

    if (this.productionMockRejected) {
      this.logger.error('生产环境必须显式设置 WECHAT_MINIAPP_MOCK=false，相关能力将 fail-closed');
    }

    if (!this.mockEnabled && (!this.appId || !this.appSecret)) {
      this.logger.warn('微信小程序服务端 API 配置不完整，相关能力将 fail-closed');
    }
  }

  isAvailable(): boolean {
    return !this.productionMockRejected
      && (this.mockEnabled || Boolean(this.appId && this.appSecret));
  }

  getAppId(): string | null {
    if (this.productionMockRejected) return null;
    if (this.appId) return this.appId;
    return this.mockEnabled ? 'mock-wechat-miniapp-app-id' : null;
  }

  async getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    this.assertAvailable();
    if (this.mockEnabled) return 'mock-wechat-mini-program-access-token';

    const forceRefresh = options.forceRefresh === true;
    if (
      !forceRefresh
      && this.cachedToken
      && this.cachedToken.expiresAtMs - TOKEN_EARLY_REFRESH_MS > Date.now()
    ) {
      return this.cachedToken.value;
    }
    // 强制刷新也必须 single-flight；并发 force_refresh 会互相废掉刚取得的 token。
    if (this.tokenPromise) return this.tokenPromise;

    const task = this.fetchStableToken(forceRefresh).finally(() => {
      if (this.tokenPromise === task) this.tokenPromise = null;
    });
    this.tokenPromise = task;
    return task;
  }

  async postJson<T>(path: string, payload: unknown): Promise<T> {
    this.assertRelativePath(path);
    this.assertAvailable();
    if (this.mockEnabled) return { errcode: 0, errmsg: 'ok' } as T;

    const firstToken = await this.getAccessToken();
    try {
      return await this.postJsonWithToken<T>(path, payload, firstToken);
    } catch (error) {
      if (!(error instanceof WechatMiniProgramApiError) || !INVALID_TOKEN_CODES.has(error.errcode)) {
        throw error;
      }
      this.cachedToken = null;
      const refreshedToken = await this.getAccessToken();
      return this.postJsonWithToken<T>(path, payload, refreshedToken);
    }
  }

  async postBuffer(path: string, payload: unknown): Promise<Buffer> {
    this.assertRelativePath(path);
    this.assertAvailable();
    if (this.mockEnabled) {
      // 仅供开发/测试的最小 PNG 外壳：签名 + IEND。调用方仍会验证边界。
      return Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x82,
      ]);
    }

    const firstToken = await this.getAccessToken();
    try {
      return await this.postBufferWithToken(path, payload, firstToken);
    } catch (error) {
      if (!(error instanceof WechatMiniProgramApiError) || !INVALID_TOKEN_CODES.has(error.errcode)) {
        throw error;
      }
      this.cachedToken = null;
      const refreshedToken = await this.getAccessToken();
      return this.postBufferWithToken(path, payload, refreshedToken);
    }
  }

  private async fetchStableToken(forceRefresh: boolean): Promise<string> {
    const body = {
      grant_type: 'client_credential',
      appid: this.appId,
      secret: this.appSecret,
      force_refresh: forceRefresh,
    };
    let response: Response;
    try {
      response = await fetch(`${WECHAT_API_ORIGIN}${STABLE_TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      this.logger.error(`获取微信 stable_token 网络失败: ${sanitizeErrorForLog(error).message}`);
      throw new ServiceUnavailableException('微信小程序平台服务暂不可用');
    }

    const parsed = await this.parseJsonResponse(response, STABLE_TOKEN_PATH);
    const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
    const expiresIn = Number(parsed.expires_in);
    if (!response.ok || parsed.errcode || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      const code = Number.isFinite(Number(parsed.errcode)) ? Number(parsed.errcode) : response.status;
      this.logger.error(`获取微信 stable_token 失败: errcode=${code}`);
      throw new WechatMiniProgramApiError(code, '微信小程序平台凭证获取失败');
    }

    this.cachedToken = {
      value: accessToken,
      expiresAtMs: Date.now() + Math.floor(expiresIn * 1000),
    };
    return accessToken;
  }

  private async postJsonWithToken<T>(path: string, payload: unknown, accessToken: string): Promise<T> {
    const url = new URL(`${WECHAT_API_ORIGIN}${path}`);
    url.searchParams.set('access_token', accessToken);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      this.logger.error(`调用微信小程序 API 网络失败: path=${path}, ${sanitizeErrorForLog(error).message}`);
      throw new ServiceUnavailableException('微信小程序平台服务暂不可用');
    }

    const parsed = await this.parseJsonResponse(response, path) as WechatApiErrorBody & T;
    const errcode = Number(parsed.errcode ?? 0);
    if (!response.ok || !Number.isFinite(errcode) || errcode !== 0) {
      const normalizedCode = Number.isFinite(errcode) && errcode !== 0 ? errcode : response.status;
      this.logger.warn(`微信小程序 API 返回失败: path=${path}, errcode=${normalizedCode}`);
      throw new WechatMiniProgramApiError(normalizedCode, '微信小程序平台接口调用失败');
    }
    return parsed as T;
  }

  private async postBufferWithToken(
    path: string,
    payload: unknown,
    accessToken: string,
  ): Promise<Buffer> {
    const url = new URL(`${WECHAT_API_ORIGIN}${path}`);
    url.searchParams.set('access_token', accessToken);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      this.logger.error(`调用微信小程序二进制 API 网络失败: path=${path}, ${sanitizeErrorForLog(error).message}`);
      throw new ServiceUnavailableException('微信小程序平台服务暂不可用');
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BINARY_RESPONSE_BYTES) {
      throw new ServiceUnavailableException('微信小程序平台响应过大');
    }
    const bytes = await this.readBufferWithLimit(response, MAX_BINARY_RESPONSE_BYTES);

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const looksJson = contentType.includes('json') || bytes.subarray(0, 1).toString() === '{';
    if (looksJson) {
      let parsed: WechatApiErrorBody;
      try {
        parsed = JSON.parse(bytes.toString('utf8')) as WechatApiErrorBody;
      } catch {
        throw new ServiceUnavailableException('微信小程序平台响应异常');
      }
      const errcode = Number(parsed.errcode ?? response.status);
      this.logger.warn(`微信小程序二进制 API 返回失败: path=${path}, errcode=${errcode}`);
      throw new WechatMiniProgramApiError(errcode, '微信小程序平台接口调用失败');
    }
    const supportedImage = contentType.includes('image/png')
      || contentType.includes('image/jpeg')
      || contentType.includes('image/jpg');
    if (!response.ok || bytes.length === 0 || !supportedImage) {
      throw new ServiceUnavailableException('微信小程序平台响应异常');
    }
    return bytes;
  }

  private async readBufferWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new ServiceUnavailableException('微信小程序平台响应过大');
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }

  private async parseJsonResponse(response: Response, path: string): Promise<Record<string, any>> {
    try {
      const parsed = await response.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('响应不是 JSON object');
      }
      return parsed as Record<string, any>;
    } catch (error) {
      this.logger.warn(`微信小程序 API 响应解析失败: path=${path}, status=${response.status}`);
      throw new ServiceUnavailableException('微信小程序平台响应异常');
    }
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException('微信小程序平台服务未配置');
    }
  }

  private assertRelativePath(path: string): void {
    if (!/^\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) {
      throw new Error('微信小程序 API path 必须是安全的相对路径');
    }
  }
}
