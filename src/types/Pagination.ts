/**
 * 分页结构（前后端契约）
 *
 * 约定：
 * - `items`：当前页数据
 * - `total`：符合条件的总记录数
 * - `page`：当前页码（从 1 开始）
 * - `pageSize`：每页条数
 * - `nextPage`：下一页页码（无则表示没有更多，由 normalizePagination 计算）
 *
 * 后端返回：`{ items, total, page, pageSize }`
 * 前端经 normalizePagination 转换后额外携带 `nextPage`
 *
 * 参考：`说明文档/后端接口清单.md#03-分页约定`
 */
// 分页结果结构：用于列表分页加载
export type PaginationResult<T> = {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  nextPage?: number;
};
