import type { AppError, Result } from '@/types/result';
import { isPageResult, withNextPage, type PageResult } from '@/types';

const invalidContractError = (contract: string): AppError => ({
  code: 'INVALID_CONTRACT',
  message: `invalid ${contract} response`,
  displayMessage: '服务响应异常，请稍后重试',
  retryable: true,
});

export function invalidContract<T>(contract: string): Result<T> {
  return { ok: false, error: invalidContractError(contract) };
}

export function normalizePageResult<T>(
  result: Result<unknown>,
  contract: string,
): Result<PageResult<T>> {
  if (!result.ok) return result;
  if (!isPageResult(result.data)) return invalidContract(contract);
  return {
    ok: true,
    data: withNextPage(result.data as Omit<PageResult<T>, 'nextPage'>),
  };
}
