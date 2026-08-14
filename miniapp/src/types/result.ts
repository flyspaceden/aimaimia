export type AppError = {
  code: string;
  /**
   * 后端全局异常过滤器保留 `code` 作为 HTTP 通用分类，
   * 服务层需要页面分支处理的具体错误码放在此字段。
   */
  businessCode?: string;
  message: string;
  displayMessage?: string;
  retryable?: boolean;
};

export function resolveAppErrorCode(error: AppError): string {
  return error.businessCode || error.code;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };
