/**
 * Result<T>：前后端接口返回的统一外壳
 *
 * 约定：
 * - 成功：`{ ok: true, data }`
 * - 失败：`{ ok: false, error }`
 *
 * 好处：
 * - 页面层无需 try/catch，直接按 ok 分支渲染 Skeleton/Empty/Error
 * - 后端对接时，只要按此结构返回即可（或在 ApiClient 里映射成此结构）
 *
 * 参考：`说明文档/后端接口清单.md#01-返回结构建议与前端-resultt-对齐`
 */
import { AppError } from './AppError';

// 统一结果结构：成功返回数据，失败返回错误
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const err = (error: AppError): Result<never> => ({ ok: false, error });
