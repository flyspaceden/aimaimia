import axios, { type AxiosRequestConfig } from 'axios';

/**
 * 卖家后台 Axios 实例
 *
 * 【M13 三端响应信封差异说明】
 * 后端统一返回 { ok: boolean, data: T, error?: string } 信封格式。
 * 三端对该信封的处理方式不同：
 *
 * - 买家 App（React Native）：Repository 层返回 Result<T> 包装，页面通过
 *   React Query 调用，响应保留 { ok, data } 信封，由调用方自行解包。
 *
 * - 卖家后台（本文件）：响应拦截器自动解包 { ok, data } 信封，
 *   成功时直接返回 data（即 body.data），失败时 reject Error。
 *   因此卖家端 API 调用拿到的直接是业务数据，而非完整信封。
 *
 * - 管理后台：与卖家后台相同，响应拦截器自动解包，直接返回 data。
 *
 * 注意：如果后端某些接口返回非标准信封（无 ok 字段），
 * 拦截器会直接透传 response.data，不做解包。
 */
const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

const parseErrorMessage = (payload: any, fallback = '请求失败') => {
  if (!payload) return fallback;
  const candidate = payload?.error ?? payload;
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object') {
    if (typeof candidate.displayMessage === 'string' && candidate.displayMessage) return candidate.displayMessage;
    if (typeof candidate.message === 'string' && candidate.message) return candidate.message;
  }
  if (typeof payload?.message === 'string' && payload.message) return payload.message;
  return fallback;
};

/**
 * 携带业务子错误码的 Axios 错误类
 *
 * 调用方需要根据具体错误场景分支时用：
 *   `if (err instanceof ApiError && err.businessCode === 'CAPTCHA_INVALID') { ... }`
 * 例如忘记密码页：CAPTCHA_INVALID → 自动刷新图形码；STAFF_PHONE_MISMATCH → 回到选企业步骤
 */
export class ApiError extends Error {
  readonly businessCode?: string;
  readonly status?: number;
  constructor(message: string, opts: { businessCode?: string; status?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.businessCode = opts.businessCode;
    this.status = opts.status;
  }
}

/** 从后端信封 `{ ok:false, error: { businessCode, ... } }` 中提取业务子错误码 */
const extractBusinessCode = (payload: any): string | undefined => {
  const err = payload?.error;
  if (err && typeof err === 'object' && typeof err.businessCode === 'string') {
    return err.businessCode;
  }
  return undefined;
};

// 请求拦截：附加 seller JWT
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('seller_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Token 刷新队列（包含 resolve 和 reject 回调，以便错误传播）
let isRefreshing = false;
let pendingRequests: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

// 刷新超时时间（毫秒）
const REFRESH_TIMEOUT = 10_000;

const processQueue = (token: string) => {
  pendingRequests.forEach((req) => req.resolve(token));
  pendingRequests = [];
};

const rejectQueue = (error: unknown) => {
  pendingRequests.forEach((req) => req.reject(error));
  pendingRequests = [];
};

// [I23] 安全导航到登录页，使用 replace 避免保留回退历史
const safeNavigateToLogin = () => {
  localStorage.removeItem('seller_token');
  localStorage.removeItem('seller_refresh_token');
  localStorage.removeItem('nongmai-seller-auth');
  if (!window.location.pathname.includes('/login')) {
    window.location.replace('/login');
  }
};

// 响应拦截：解包信封 + 401 自动刷新
client.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === 'object' && 'ok' in body) {
      if (!body.ok) {
        return Promise.reject(
          new ApiError(parseErrorMessage(body, '请求失败'), {
            businessCode: extractBusinessCode(body),
            status: response.status,
          }),
        );
      }
      // [I20] 检查响应中 data 字段是否存在
      if (body.data === undefined) {
        console.warn('[API] 响应缺少 data 字段:', response.config?.url);
      }
      return body.data;
    }
    return body;
  },
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/seller/auth/refresh') &&
      !originalRequest.url?.includes('/seller/auth/login')
    ) {
      originalRequest._retry = true;
      const refreshTokenStr = localStorage.getItem('seller_refresh_token');

      if (!refreshTokenStr) {
        safeNavigateToLogin();
        return Promise.reject(error);
      }

      // [I21] 如果已在刷新中，将请求加入队列（包含 reject 回调）
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingRequests.push({
            resolve: (newToken: string) => {
              originalRequest.headers = {
                ...originalRequest.headers,
                Authorization: `Bearer ${newToken}`,
              };
              resolve(client(originalRequest));
            },
            reject,
          });
        });
      }

      isRefreshing = true;

      try {
        // [I21] 添加刷新超时控制（10秒）
        const refreshPromise = axios.post(
          `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/seller/auth/refresh`,
          { refreshToken: refreshTokenStr },
        );

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Token 刷新超时')), REFRESH_TIMEOUT),
        );

        const res = await Promise.race([refreshPromise, timeoutPromise]);

        const data = res.data?.data ?? res.data;
        const { accessToken, refreshToken: newRefreshToken } = data;

        localStorage.setItem('seller_token', accessToken);
        if (newRefreshToken) {
          localStorage.setItem('seller_refresh_token', newRefreshToken);
        }

        processQueue(accessToken);

        originalRequest.headers = {
          ...originalRequest.headers,
          Authorization: `Bearer ${accessToken}`,
        };
        return client(originalRequest);
      } catch (refreshError) {
        // [I21] 将错误传播给所有排队中的请求
        rejectQueue(refreshError);
        safeNavigateToLogin();
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    const payload = error.response?.data;
    const msg = parseErrorMessage(payload, error.message || '网络错误');
    return Promise.reject(
      new ApiError(msg, {
        businessCode: extractBusinessCode(payload),
        status: error.response?.status,
      }),
    );
  },
);

export default client;
