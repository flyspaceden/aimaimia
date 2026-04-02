/**
 * 应用级错误结构（前后端契约）
 *
 * 作用：
 * - 前端统一用 `AppError` 表达“可展示错误”与“可重试性”
 * - 后端建议把业务错误映射为 `code`，并提供 `displayMessage` 供前端直接展示
 *
 * 建议：
 * - HTTP 层可继续用状态码（400/401/403/404/500），同时在 body 里返回本结构便于前端统一处理
 *
 * 参考：`说明文档/后端接口清单.md#01-返回结构建议与前端-resultt-对齐`
 */
// 应用级错误结构：用于统一处理可展示错误与错误码
export type AppErrorCode = 'NETWORK' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' | 'UNKNOWN';

export type AppError = {
  code: AppErrorCode;
  message: string;
  displayMessage?: string;
  retryable?: boolean;
};
