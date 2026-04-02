/**
 * Repo 层公共工具（当前为 Mock 模式）
 *
 * 作用：
 * - `simulateRequest`：模拟网络延迟/随机失败，用于在无后端时验证 UI 的 Loading/Empty/Error 三态
 * - `createAppError`：构造统一错误结构，便于 UI 展示与后续对接后端错误码
 *
 * 后端接入说明：
 * - 当接入真实后端时，建议新增一个统一的 `ApiClient`（例如 `src/repos/http/ApiClient.ts`）
 *   负责：baseURL、鉴权 token、超时、错误映射（HTTP -> AppError）、Result<T> 组装。
 * - 接入后，本文件仍可保留用于“离线开发/演示 Mock”模式（通过环境变量切换）。
 *
 * 参考接口清单：`说明文档/后端接口清单.md`
 */
import { AppError, AppErrorCode, Result, err, ok } from '../types';
import { sleep } from '../utils/sleep';

const DEFAULT_DELAY = 500;
const DEFAULT_FAIL_RATE = 0.12;

// 构造统一错误对象，便于 UI 侧展示
export const createAppError = (code: AppErrorCode, message: string, displayMessage?: string): AppError => ({
  code,
  message,
  displayMessage,
  retryable: code === 'NETWORK',
});

// 模拟网络请求：延迟 + 随机错误
export const simulateRequest = async <T>(
  data: T,
  options?: { delay?: number; failRate?: number }
): Promise<Result<T>> => {
  const delay = options?.delay ?? DEFAULT_DELAY;
  const failRate = options?.failRate ?? DEFAULT_FAIL_RATE;

  await sleep(delay);

  if (Math.random() < failRate) {
    return err(createAppError('NETWORK', '模拟网络异常', '网络开小差了'));
  }

  return ok(data);
};
