/**
 * 商品仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/products.ts` + `simulateRequest` 模拟后端分页
 *
 * 后端接入说明：
 * - 将 `list/getById` 内部实现替换为 HTTP 请求即可，页面层不需要改动
 * - 建议接口：
 *   - `GET /api/v1/products?page=&pageSize=` → `Result<PaginationResult<Product>>`
 *   - `GET /api/v1/products/{id}` → `Result<Product>`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#1-商品product`
 */
import { mockProducts } from '../mocks';
import { PaginationResult, Product, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

const PAGE_SIZE = 8;
const TOTAL_PAGES = 4;

const buildPagedProducts = () => {
  const items: Product[] = [];

  for (let page = 1; page <= TOTAL_PAGES; page += 1) {
    mockProducts.forEach((product, index) => {
      const suffix = page > 1 ? `-p${page}` : '';
      items.push({
        ...product,
        id: `${product.id}${suffix}`,
        title: page > 1 ? `${product.title} · 批次${page}` : product.title,
        rating: product.rating ?? 4.6 + (index % 3) * 0.1,
      });
    });
  }

  return items;
};

const pagedProducts = buildPagedProducts();

const normalizeId = (id: string) => id.split('-p')[0];

// 商品仓储：对外仅暴露 list/getById 等方法
export const ProductRepo = {
  /**
   * 获取商品分页列表
   * - 用途：首页/分类/搜索商品流
   * - 后端建议：`GET /api/v1/products?page=&pageSize=`
   * - 响应：`Result<PaginationResult<Product>>`
   */
  list: async (options?: { page?: number; pageSize?: number }): Promise<Result<PaginationResult<Product>>> => {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? PAGE_SIZE;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = pagedProducts.slice(start, end);
    const nextPage = end < pagedProducts.length ? page + 1 : undefined;

    return simulateRequest({ items, nextPage }, { failRate: page === 1 ? 0.12 : 0.08 });
  },
  /**
   * 获取商品详情
   * - 用途：商品详情页/挂商品卡片
   * - 后端建议：`GET /api/v1/products/{id}`
   * - 响应：`Result<Product>`
   */
  getById: async (id: string): Promise<Result<Product>> => {
    const normalizedId = normalizeId(id);
    const product = mockProducts.find((item) => item.id === normalizedId);
    if (!product) {
      return err(createAppError('NOT_FOUND', `商品不存在: ${id}`, '商品已下架'));
    }
    return simulateRequest({ ...product, id });
  },
};
