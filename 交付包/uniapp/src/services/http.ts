// ApiClient：后端接入占位（统一处理 baseURL / headers / 错误映射）
import type { AppError, Result } from './types';

const buildError = (message: string, code = 'NETWORK_ERROR'): AppError => ({
  code,
  message,
});

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  data?: Record<string, unknown>;
};

export const request = async <T>(url: string, options: RequestOptions = {}): Promise<Result<T>> => {
  return new Promise((resolve) => {
    uni.request({
      url,
      method: options.method || 'GET',
      data: options.data || {},
      header: options.headers || {},
      success: (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, data: res.data as T });
        } else {
          resolve({ ok: false, error: buildError('服务异常', `HTTP_${res.statusCode}`) });
        }
      },
      fail: () => {
        resolve({ ok: false, error: buildError('网络不可用') });
      },
    });
  });
};
