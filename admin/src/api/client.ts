import axios, { type AxiosRequestConfig } from 'axios';
import useAuthStore from '../store/useAuthStore';

/**
 * 管理后台 Axios 实例
 * A-6: 从环境变量读取 baseURL，开发环境通过 Vite proxy 转发
 *
 * 【M13 三端响应信封差异说明】
 * 后端统一返回 { ok: boolean, data: T, error?: string } 信封格式。
 * 三端对该信封的处理方式不同：
 *
 * - 买家 App（React Native）：Repository 层返回 Result<T> 包装，页面通过
 *   React Query 调用，响应保留 { ok, data } 信封，由调用方自行解包。
 *
 * - 管理后台（本文件）：响应拦截器自动解包 { ok, data } 信封，
 *   成功时直接返回 data（即 body.data），失败时 reject Error。
 *   因此管理端 API 调用拿到的直接是业务数据，而非完整信封。
 *
 * - 卖家后台：与管理后台相同，响应拦截器自动解包，直接返回 data。
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

// 请求拦截：附加 admin JWT
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// A-5: Token 刷新队列，避免并发刷新
let isRefreshing = false;
let pendingRequests: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (token: string) => {
  pendingRequests.forEach((req) => req.resolve(token));
  pendingRequests = [];
};

const rejectQueue = (error: unknown) => {
  pendingRequests.forEach((req) => req.reject(error));
  pendingRequests = [];
};

const clearAuthAndRedirect = () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_refresh_token');
  // 清除 zustand persist 缓存
  localStorage.removeItem('nongmai-admin-auth');
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login';
  }
};

// 响应拦截：解包 { ok, data } 信封 + 401 自动刷新
client.interceptors.response.use(
  (response) => {
    const body = response.data;
    // 后端统一包装 { ok: true, data: ... }
    if (body && typeof body === 'object' && 'ok' in body) {
      if (!body.ok) {
        return Promise.reject(new Error(parseErrorMessage(body, '请求失败')));
      }
      // I24修复：检查 data 字段存在性
      if (body.data === undefined) {
        console.warn('[Admin API] 响应成功但缺少 data 字段');
        return body;
      }
      return body.data;
    }
    return body;
  },
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // 401 且非刷新请求本身 → 尝试刷新 Token
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/admin/auth/refresh') &&
      !originalRequest.url?.includes('/admin/auth/login') &&
      !originalRequest.url?.includes('/admin/auth/logout')
    ) {
      originalRequest._retry = true;
      const refreshTokenStr = localStorage.getItem('admin_refresh_token');

      if (!refreshTokenStr) {
        clearAuthAndRedirect();
        return Promise.reject(error);
      }

      // 正在刷新中，排队等待
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
        // 用原始 axios 调用刷新接口，避免走拦截器死循环
        const res = await axios.post(
          `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/admin/auth/refresh`,
          { refreshToken: refreshTokenStr },
        );

        const data = res.data?.data ?? res.data;
        const { accessToken, refreshToken: newRefreshToken } = data;

        // 更新本地存储
        localStorage.setItem('admin_token', accessToken);
        if (newRefreshToken) {
          localStorage.setItem('admin_refresh_token', newRefreshToken);
        }

        // B13修复：同步更新 Zustand store
        try {
          const store = useAuthStore.getState();
          if (store && typeof useAuthStore.setState === 'function') {
            useAuthStore.setState({
              token: accessToken,
              ...(newRefreshToken ? { refreshToken: newRefreshToken } : {}),
            });
          }
        } catch {
          // store 未初始化时忽略
        }

        // 处理排队的请求
        processQueue(accessToken);

        // 重试原请求
        originalRequest.headers = {
          ...originalRequest.headers,
          Authorization: `Bearer ${accessToken}`,
        };
        return client(originalRequest);
      } catch {
        // 刷新失败 → 清除并跳转登录
        rejectQueue(error);
        clearAuthAndRedirect();
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    // 非 401 或刷新失败后的错误
    const msg = parseErrorMessage(error.response?.data, error.message || '网络错误');
    return Promise.reject(new Error(msg));
  },
);

export default client;
