import Taro from '@tarojs/taro';
import {
  captureAuthSession,
  type AuthSessionGuard,
  useAuthStore,
} from '@/store/auth';
import { logoutAndClearClientStateIfCurrent } from '@/session/clientState';
import type { AppError, Result } from '@/types/result';
import { API_BASE_URL } from './config';

type QueryParams = Record<string, string | number | boolean | undefined>;
/** 微信 `wx.request` 官方支持的方法子集；不要加入 PATCH。 */
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type HttpResponse = { statusCode: number; data: unknown };

/**
 * 请求级可选项故意不暴露任意 header，避免页面覆盖认证和内容类型。
 * 当前只允许服务端已定义的幂等语义。
 */
export type RequestOptions = {
  idempotencyKey?: string;
};

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const timeoutError: AppError = {
  code: 'NETWORK_TIMEOUT',
  message: 'request timeout',
  displayMessage: '请求超时，请稍后重试',
  retryable: true,
};

const sessionChangedError: Result<never> = {
  ok: false,
  error: {
    code: 'AUTH_SESSION_CHANGED',
    message: 'auth session changed while request was in flight',
    displayMessage: '登录状态已变更，请重试',
    retryable: true,
  },
};

const invalidIdempotencyKeyError: Result<never> = {
  ok: false,
  error: {
    code: 'INVALID_IDEMPOTENCY_KEY',
    message: 'idempotency key must use 1-128 safe ASCII characters',
    displayMessage: '请求标识无效，请重试',
    retryable: true,
  },
};

type RefreshFlight = {
  key: string;
  promise: Promise<RefreshOutcome>;
};

type RefreshedTokens = {
  accessToken: string;
  refreshToken: string;
  loginMethod?: 'wechat-miniapp' | 'phone';
};

type RefreshOutcome = {
  applied: boolean;
  tokens?: RefreshedTokens;
};

let refreshFlight: RefreshFlight | null = null;

function buildUrl(path: string, params?: QueryParams): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!params) return `${API_BASE_URL}${normalizedPath}`;
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${API_BASE_URL}${normalizedPath}${query ? `?${query}` : ''}`;
}

function authHeader(accessToken?: string): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function requestHeaders(
  accessToken?: string,
  options?: RequestOptions,
): Record<string, string> {
  const idempotencyKey = options?.idempotencyKey?.trim();
  return {
    'Content-Type': 'application/json',
    ...authHeader(accessToken),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

function isAppError(value: unknown): value is AppError {
  if (!value || typeof value !== 'object') return false;
  const error = value as Record<string, unknown>;
  return typeof error.code === 'string' && typeof error.message === 'string';
}

export function isResultEnvelope<T>(value: unknown): value is Result<T> {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  if (envelope.ok === true) return Object.prototype.hasOwnProperty.call(envelope, 'data');
  return envelope.ok === false && isAppError(envelope.error);
}

function parseHttpResponse<T>(response: HttpResponse): Result<T> {
  if (isResultEnvelope<T>(response.data)) return response.data;

  const isServerError = response.statusCode >= 500;
  return {
    ok: false,
    error: {
      code: isServerError ? 'UPSTREAM_ERROR' : 'INVALID_RESPONSE',
      message: `unexpected response envelope (HTTP ${response.statusCode})`,
      displayMessage: isServerError ? '服务暂时不可用，请稍后重试' : '服务响应异常',
      retryable: isServerError,
    },
  };
}

function extractNetworkMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const candidate = error as { errMsg?: unknown; message?: unknown };
    if (typeof candidate.errMsg === 'string') return candidate.errMsg;
    if (typeof candidate.message === 'string') return candidate.message;
  }
  return '';
}

function networkFailure<T>(error: unknown): Result<T> {
  const message = extractNetworkMessage(error);
  const normalized = message.toLowerCase();
  return {
    ok: false,
    error: normalized.includes('timeout')
      ? timeoutError
      : {
        code: 'NETWORK',
        message: message || 'network error',
        displayMessage: '网络开小差了',
        retryable: true,
      },
  };
}

async function refreshAccessToken(guard: AuthSessionGuard): Promise<RefreshOutcome> {
  if (!guard.refreshToken) return { applied: false };
  try {
    const response = await Taro.request<unknown>({
      url: buildUrl('/auth/refresh'),
      method: 'POST',
      data: { refreshToken: guard.refreshToken },
      timeout: 12_000,
      header: { 'Content-Type': 'application/json' },
    });
    const result = parseHttpResponse<{
      accessToken: string;
      refreshToken?: string;
      loginMethod?: 'wechat-miniapp' | 'phone';
    }>(response);
    if (!result.ok || !result.data.accessToken) return { applied: false };

    const loginMethod = result.data.loginMethod === 'wechat-miniapp' || result.data.loginMethod === 'phone'
      ? result.data.loginMethod
      : undefined;

    const tokens: RefreshedTokens = {
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken || guard.refreshToken,
      loginMethod: loginMethod || useAuthStore.getState().loginMethod,
    };
    return {
      applied: useAuthStore.getState().applyRefreshedSession(guard, tokens),
      tokens,
    };
  } catch {
    return { applied: false };
  }
}

function refreshKey(guard: AuthSessionGuard): string {
  return `${guard.revision}:${guard.logoutGeneration}:${guard.refreshToken || '<empty>'}`;
}

function refreshOnce(guard: AuthSessionGuard): Promise<RefreshOutcome> {
  const key = refreshKey(guard);
  if (refreshFlight?.key === key) return refreshFlight.promise;

  const flight: RefreshFlight = {
    key,
    promise: Promise.resolve({ applied: false }),
  };
  flight.promise = refreshAccessToken(guard).finally(() => {
    if (refreshFlight === flight) refreshFlight = null;
  });
  refreshFlight = flight;
  return flight.promise;
}

/**
 * Invalidate and clear the current local session synchronously, then revoke
 * the matching server session. If a refresh already rotated that server
 * session, drain its response only to obtain the new access token; the
 * logout generation prevents those tokens from ever being restored locally.
 */
async function logoutCurrentSession(): Promise<Result<{ ok: boolean }>> {
  const sessionGuard = captureAuthSession();
  const pendingRefresh = refreshFlight?.key === refreshKey(sessionGuard)
    ? refreshFlight.promise
    : undefined;
  const logoutGuard = useAuthStore.getState().beginLogout(sessionGuard);
  if (!logoutGuard) return sessionChangedError;

  // No await may occur before this clear: other work must observe logout as
  // soon as its generation has advanced.
  logoutAndClearClientStateIfCurrent(logoutGuard);

  const refreshOutcome = await pendingRefresh;
  const revokeAccessToken = refreshOutcome?.tokens?.accessToken || sessionGuard.accessToken;
  const response = await rawRequest<unknown>(
    'POST',
    '/auth/logout',
    revokeAccessToken,
  );
  return parseHttpResponse<{ ok: boolean }>(response);
}

async function rawRequest<T>(
  method: Method,
  path: string,
  accessToken?: string,
  data?: unknown,
  params?: QueryParams,
  options?: RequestOptions,
) {
  return Taro.request<T>({
    url: buildUrl(path, params),
    method,
    data,
    timeout: 12_000,
    header: requestHeaders(accessToken, options),
  });
}

type UploadFileInput = {
  filePath: string;
  name: string;
  formData?: Record<string, string | number>;
  params?: QueryParams;
};

async function rawUploadFile(
  path: string,
  input: UploadFileInput,
  accessToken?: string,
): Promise<HttpResponse> {
  const response = await Taro.uploadFile({
    url: buildUrl(path, input.params),
    filePath: input.filePath,
    name: input.name,
    formData: input.formData,
    timeout: 30_000,
    header: authHeader(accessToken),
  });
  let data: unknown = response.data;
  try {
    data = JSON.parse(response.data);
  } catch {
    // HTML/空响应由 parseHttpResponse 统一映射，不把解析异常抛给页面。
  }
  return { statusCode: response.statusCode, data };
}

async function request<T>(
  method: Method,
  path: string,
  data?: unknown,
  params?: QueryParams,
  options?: RequestOptions,
): Promise<Result<T>> {
  const rawIdempotencyKey = options?.idempotencyKey;
  const idempotencyKey = rawIdempotencyKey?.trim();
  if (rawIdempotencyKey !== undefined
    && (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))) {
    return invalidIdempotencyKeyError;
  }
  const normalizedOptions = idempotencyKey ? { idempotencyKey } : undefined;
  const requestGuard = captureAuthSession();

  try {
    let response = await rawRequest<unknown>(
      method,
      path,
      requestGuard.accessToken,
      data,
      params,
      normalizedOptions,
    );
    if (response.statusCode !== 401 || path.startsWith('/auth/')) {
      if (requestGuard.accessToken
        && !useAuthStore.getState().isCurrentSessionGeneration(requestGuard)) {
        return sessionChangedError;
      }
      return parseHttpResponse<T>(response);
    }

    if (!useAuthStore.getState().isCurrentSession(requestGuard)) {
      return sessionChangedError;
    }

    const refreshOutcome = await refreshOnce(requestGuard);
    if (!refreshOutcome.applied) {
      logoutAndClearClientStateIfCurrent(requestGuard);
      return parseHttpResponse<T>(response);
    }

    const refreshedGuard = captureAuthSession();
    response = await rawRequest<unknown>(
      method,
      path,
      refreshedGuard.accessToken,
      data,
      params,
      normalizedOptions,
    );
    if (response.statusCode === 401) {
      logoutAndClearClientStateIfCurrent(refreshedGuard);
    }
    if (refreshedGuard.accessToken
      && !useAuthStore.getState().isCurrentSessionGeneration(refreshedGuard)) {
      return sessionChangedError;
    }
    return parseHttpResponse<T>(response);
  } catch (error) {
    return networkFailure<T>(error);
  }
}

async function uploadFile<T>(path: string, input: UploadFileInput): Promise<Result<T>> {
  const requestGuard = captureAuthSession();
  try {
    let response = await rawUploadFile(path, input, requestGuard.accessToken);
    if (response.statusCode !== 401) {
      if (requestGuard.accessToken
        && !useAuthStore.getState().isCurrentSessionGeneration(requestGuard)) {
        return sessionChangedError;
      }
      return parseHttpResponse<T>(response);
    }

    if (!useAuthStore.getState().isCurrentSession(requestGuard) || !requestGuard.refreshToken) {
      return requestGuard.refreshToken ? sessionChangedError : parseHttpResponse<T>(response);
    }
    const refreshOutcome = await refreshOnce(requestGuard);
    if (!refreshOutcome.applied) {
      logoutAndClearClientStateIfCurrent(requestGuard);
      return parseHttpResponse<T>(response);
    }

    const refreshedGuard = captureAuthSession();
    response = await rawUploadFile(path, input, refreshedGuard.accessToken);
    if (response.statusCode === 401) {
      logoutAndClearClientStateIfCurrent(refreshedGuard);
    }
    if (refreshedGuard.accessToken
      && !useAuthStore.getState().isCurrentSessionGeneration(refreshedGuard)) {
      return sessionChangedError;
    }
    return parseHttpResponse<T>(response);
  } catch (error) {
    return networkFailure<T>(error);
  }
}

export const ApiClient = {
  get: <T>(path: string, params?: QueryParams) => request<T>('GET', path, undefined, params),
  post: <T>(path: string, data?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, data, undefined, options),
  put: <T>(path: string, data?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, data, undefined, options),
  delete: <T>(path: string, data?: unknown, options?: RequestOptions) =>
    request<T>('DELETE', path, data, undefined, options),
  uploadFile,
  logoutCurrentSession,
};
