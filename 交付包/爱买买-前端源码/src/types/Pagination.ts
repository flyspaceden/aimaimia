/**
 * 分页结构（前后端契约）
 *
 * 约定：
 * - `items`：当前页数据
 * - `nextPage`：下一页页码（无则表示没有更多）
 *
 * 后端建议：
 * - 入参：`page`（从 1 开始）、`pageSize`
 * - 出参：`PaginationResult<T>`
 *
 * 参考：`说明文档/后端接口清单.md#03-分页约定`
 */
// 分页结果结构：用于列表分页加载
export type PaginationResult<T> = {
  items: T[];
  nextPage?: number;
};
