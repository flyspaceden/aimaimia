// Mock 数据工具：用于前端占位与分页模拟（后续由真实接口替换）
import type { PagedResult, Result } from '../types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockPage = async <T>(
  items: T[],
  page: number,
  pageSize: number
): Promise<Result<PagedResult<T>>> => {
  await sleep(300);
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    ok: true,
    data: {
      items: slice,
      page,
      pageSize,
      hasMore: start + pageSize < items.length,
    },
  };
};
