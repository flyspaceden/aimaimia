/**
 * 后端分页响应 → 前端分页格式转换
 * 后端: { items, total, page, pageSize }
 * 前端: { items, total, page, pageSize, nextPage? }
 * 保留后端原始的 total/page/pageSize，同时计算 nextPage 方便前端判断是否还有更多
 */
export function normalizePagination<T>(response: {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}): { items: T[]; total?: number; page?: number; pageSize?: number; nextPage?: number } {
  const { items, total, page, pageSize } = response;
  let nextPage: number | undefined;
  if (total !== undefined && page !== undefined && pageSize !== undefined) {
    const totalPages = Math.ceil(total / pageSize);
    if (page < totalPages) {
      nextPage = page + 1;
    }
  }
  return { items, total, page, pageSize, nextPage };
}
