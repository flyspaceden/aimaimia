/**
 * 统一 HTTP 客户端
 *
 * 职责：
 * - baseURL + Token 注入 + 超时控制
 * - HTTP 错误 → AppError 映射
 * - 后端已返回 { ok, data/error } 格式，直接透传为 Result<T>
 * - 401 自动刷新 Token 后重试原请求（一次）
 *
 * 参考：src/repos/helpers.ts 注释中的 ApiClient 指引
 */
import { AppError, Result } from '../../types';
import { API_BASE_URL } from './config';
import { logoutAndClearClientState } from '../../utils/logout';

const TIMEOUT_MS = 12000;

/** 防止并发刷新 Token */
let refreshPromise: Promise<boolean> | null = null;

/** 从 useAuthStore 获取 token（延迟导入避免循环依赖） */
const getAccessToken = (): string | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAuthStore } = require('../../store/useAuthStore');
    return useAuthStore.getState().accessToken;
  } catch {
    return undefined;
  }
};

/** 获取 refreshToken */
const getRefreshToken = (): string | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAuthStore } = require('../../store/useAuthStore');
    return useAuthStore.getState().refreshToken;
  } catch {
    return undefined;
  }
};

/** 尝试刷新 Token，成功返回 true */
const tryRefreshToken = async (): Promise<boolean> => {
  const rt = getRefreshToken();
  if (!rt) return false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const json = await response.json();
    if (json.ok && json.data) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useAuthStore } = require('../../store/useAuthStore');
      const state = useAuthStore.getState();
      state.setLoggedIn({
        accessToken: json.data.accessToken,
        refreshToken: json.data.refreshToken ?? rt,
        userId: state.userId,
        loginMethod: state.loginMethod ?? 'phone',
      });
      return true;
    }
  } catch {
    // 刷新失败，不阻塞
  }
  return false;
};

/** 并发安全的 Token 刷新（多个 401 只触发一次刷新） */
const refreshTokenOnce = (): Promise<boolean> => {
  if (!refreshPromise) {
    refreshPromise = tryRefreshToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

const buildHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

const networkError: AppError = {
  code: 'NETWORK',
  message: '网络请求失败',
  displayMessage: '网络开小差了',
  retryable: true,
};

async function rawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | number | undefined>,
  extraHeaders?: Record<string, string>,
): Promise<{ result: Result<T>; status: number }> {
  // 构建 URL + query params
  let url = `${API_BASE_URL}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const response = await fetch(url, {
    method,
    headers: buildHeaders(extraHeaders),
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  });

  clearTimeout(timer);

  const json = await response.json();
  return { result: json as Result<T>, status: response.status };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | number | undefined>,
  extraHeaders?: Record<string, string>,
): Promise<Result<T>> {
  try {
    const { result, status } = await rawRequest<T>(method, path, body, params, extraHeaders);

    // 401 → 尝试刷新 Token 后重试一次（刷新请求本身不重试）
    if (status === 401 && !path.startsWith('/auth/')) {
      const refreshed = await refreshTokenOnce();
      if (refreshed) {
        const retry = await rawRequest<T>(method, path, body, params, extraHeaders);
        return retry.result;
      }
      // 刷新失败 → 登出
      try {
        logoutAndClearClientState();
      } catch { /* 忽略 */ }
    }

    return result;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        error: { ...networkError, message: '请求超时', displayMessage: '请求超时，请稍后重试' },
      };
    }
    return { ok: false, error: networkError };
  }
}

/**
 * multipart/form-data 上传（用于音频文件等二进制数据）
 * 不走 rawRequest，因为需要让 fetch 自动设置 Content-Type（含 boundary）
 */
async function uploadRequest<T>(
  path: string,
  formData: FormData,
): Promise<Result<T>> {
  try {
    const url = `${API_BASE_URL}${path}`;
    console.log('[Upload] URL:', url);
    const headers: Record<string, string> = {};
    const token = getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    // 注意：不设置 Content-Type，让 fetch 自动生成 multipart boundary
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000); // 上传超时延长到 30s

    console.log('[Upload] 开始上传...');
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);
    console.log('[Upload] 响应状态:', response.status);

    const json = await response.json();

    // 401 → 尝试刷新 Token 后重试一次
    if (response.status === 401) {
      const refreshed = await refreshTokenOnce();
      if (refreshed) {
        const retryToken = getAccessToken();
        if (retryToken) {
          headers['Authorization'] = `Bearer ${retryToken}`;
        }
        const retryController = new AbortController();
        const retryTimer = setTimeout(() => retryController.abort(), 30000);
        const retryResponse = await fetch(url, {
          method: 'POST',
          headers,
          body: formData,
          signal: retryController.signal,
        });
        clearTimeout(retryTimer);
        return (await retryResponse.json()) as Result<T>;
      }
      try {
        logoutAndClearClientState();
      } catch { /* 忽略 */ }
    }

    return json as Result<T>;
  } catch (error: any) {
    console.error('[Upload] 请求异常:', error?.name, error?.message, error);
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        error: { ...networkError, message: '上传超时', displayMessage: '上传超时，请稍后重试' },
      };
    }
    return { ok: false, error: { ...networkError, message: `网络请求失败: ${error?.message || '未知'}` } };
  }
}

export const ApiClient = {
  get: <T>(path: string, params?: Record<string, string | number | undefined>) =>
    request<T>('GET', path, undefined, params),

  post: <T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }) =>
    request<T>('POST', path, body, undefined, options?.headers),

  patch: <T>(path: string, body?: unknown) =>
    request<T>('PATCH', path, body),

  put: <T>(path: string, body?: unknown) =>
    request<T>('PUT', path, body),

  delete: <T>(path: string) =>
    request<T>('DELETE', path),

  /** multipart/form-data 上传（音频/图片等二进制文件） */
  upload: <T>(path: string, formData: FormData) =>
    uploadRequest<T>(path, formData),
};
