export type PageQuery = {
  page?: number;
  pageSize?: number;
};

/** 后端分页原始契约；nextPage 由小程序端根据 total 计算。 */
export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  nextPage?: number;
};

export function withNextPage<T>(page: Omit<PageResult<T>, 'nextPage'>): PageResult<T> {
  const consumed = page.page * page.pageSize;
  return {
    ...page,
    nextPage: consumed < page.total ? page.page + 1 : undefined,
  };
}
