/**
 * 商品仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/products.ts` + `simulateRequest` 模拟后端分页
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 *   - `GET /api/v1/products?page=&pageSize=` → `Result<PaginationResult<Product>>`
 *   - `GET /api/v1/products/{id}` → `Result<Product>`
 */
import { mockProducts } from '../mocks';
import { AiRecommendTheme, PaginationResult, Product, ProductDetail, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';
import { normalizePagination } from './http/pagination';

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
const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[“”"'`]/g, '')
    .replace(/[，。！？,.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const constraintKeywordMap: Record<string, string[]> = {
  organic: ['有机'],
  'low-sugar': ['低糖', '控糖'],
  seasonal: ['当季', '应季'],
  traceable: ['溯源', '可信溯源'],
  'cold-chain': ['冷链'],
  'geo-certified': ['地理标志'],
  healthy: ['健康', '轻食'],
  fresh: ['新鲜', '鲜'],
};

const recommendThemeKeywordMap: Record<AiRecommendTheme, string[]> = {
  hot: ['热销', '爆款', '热门', '畅销', '人气'],
  discount: ['折扣', '优惠', '特价', '特惠', '秒杀'],
  tasty: ['好吃', '美味', '鲜甜', '香甜', '鲜', '香'],
  seasonal: ['当季', '应季', '时令'],
  recent: ['新品', '新上', '上新', '最新'],
};

// 商品仓储：对外仅暴露 list/getById 等方法
export const ProductRepo = {
  /**
   * 获取商品分页列表
   * - 用途：首页/分类/搜索商品流
   * - 后端接口：`GET /api/v1/products?page=&pageSize=&categoryId=&keyword=&preferRecommended=&constraints=&maxPrice=`
   * - 响应：`Result<PaginationResult<Product>>`
   */
  list: async (
    options?: {
      page?: number;
      pageSize?: number;
      categoryId?: string;
      keyword?: string;
      preferRecommended?: boolean;
      constraints?: string[];
      maxPrice?: number;
      recommendThemes?: AiRecommendTheme[];
      usageScenario?: string;
      originPreference?: string;
      dietaryPreference?: string;
    },
  ): Promise<Result<PaginationResult<Product>>> => {
    if (USE_MOCK) {
      const page = options?.page ?? 1;
      const pageSize = options?.pageSize ?? PAGE_SIZE;
      const keyword = normalizeSearchText(options?.keyword ?? '');
      const categoryId = options?.categoryId;
      const preferRecommended = !!options?.preferRecommended;
      const constraints = (options?.constraints ?? []).filter(Boolean);
      const recommendThemes = (options?.recommendThemes ?? []).filter(Boolean);
      const maxPrice = options?.maxPrice;
      let filteredProducts = pagedProducts;

      if (categoryId) {
        filteredProducts = filteredProducts.filter((product) => product.categoryId === categoryId);
      }

      if (keyword) {
        filteredProducts = filteredProducts.filter((product) => {
          const haystack = normalizeSearchText(
            [product.title, product.origin, product.categoryName ?? '', product.tags.join(' ')].join(' '),
          );
          return haystack.includes(keyword);
        });
      }

      if (typeof maxPrice === 'number' && Number.isFinite(maxPrice) && maxPrice > 0) {
        filteredProducts = filteredProducts.filter((product) => product.price <= maxPrice);
      }

      if (preferRecommended || constraints.length > 0 || recommendThemes.length > 0) {
        filteredProducts = [...filteredProducts].sort((a, b) => {
          const buildScore = (product: Product) => {
            const haystack = normalizeSearchText(
              [product.title, product.origin, product.categoryName ?? '', product.tags.join(' ')].join(' '),
            );
            let score = 0;
            if (preferRecommended) {
              if (haystack.includes('有机')) score += 16;
              if (haystack.includes('溯源')) score += 14;
              if (haystack.includes('地理标志')) score += 12;
              if (haystack.includes('检测报告')) score += 10;
            }
            constraints.forEach((constraint) => {
              const aliases = constraintKeywordMap[constraint] ?? [constraint];
              if (aliases.some((alias) => haystack.includes(normalizeSearchText(alias)))) score += 20;
            });
            recommendThemes.forEach((theme) => {
              const aliases = recommendThemeKeywordMap[theme] ?? [theme];
              if (aliases.some((alias) => haystack.includes(normalizeSearchText(alias)))) score += 24;
              if (theme === 'discount' && typeof product.strikePrice === 'number' && product.strikePrice > product.price) score += 30;
              if (theme === 'recent') score += 8;
              if (theme === 'tasty' && product.rating) score += product.rating * 2;
            });
            return score;
          };
          return buildScore(b) - buildScore(a);
        });
      }

      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const items = filteredProducts.slice(start, end);
      const nextPage = end < filteredProducts.length ? page + 1 : undefined;
      return simulateRequest(
        { items, total: filteredProducts.length, page, pageSize, nextPage },
        { failRate: page === 1 ? 0.12 : 0.08 },
      );
    }

    // I14修复：后端返回 { items, total, page, pageSize }，需转换为前端 { items, nextPage? }
    const res = await ApiClient.get<{ items: Product[]; total: number; page: number; pageSize: number }>('/products', {
      page: options?.page ?? 1,
      pageSize: options?.pageSize ?? PAGE_SIZE,
      categoryId: options?.categoryId,
      keyword: options?.keyword,
      preferRecommended: options?.preferRecommended ? 1 : undefined,
      constraints: options?.constraints?.length ? options.constraints.join(',') : undefined,
      maxPrice: options?.maxPrice,
      recommendThemes: options?.recommendThemes?.length ? options.recommendThemes.join(',') : undefined,
      ...(options?.usageScenario && { usageScenario: options.usageScenario }),
      ...(options?.originPreference && { originPreference: options.originPreference }),
      ...(options?.dietaryPreference && { dietaryPreference: options.dietaryPreference }),
    });
    if (res.ok) {
      return { ok: true, data: normalizePagination(res.data) };
    }
    return res as Result<PaginationResult<Product>>;
  },
  /**
   * 获取商品详情
   * - 用途：商品详情页/挂商品卡片
   * - 后端接口：`GET /api/v1/products/{id}`
   * - 响应：`Result<Product>`
   */
  getById: async (id: string): Promise<Result<ProductDetail>> => {
    if (USE_MOCK) {
      const normalizedId = normalizeId(id);
      const product = mockProducts.find((item) => item.id === normalizedId);
      if (!product) {
        return err(createAppError('NOT_FOUND', `商品不存在: ${id}`, '商品已下架'));
      }
      // Mock 兼容：将简单 Product 包装为 ProductDetail
      return simulateRequest({
        ...product,
        id,
        basePrice: product.price,
        images: product.image ? [{ id: '1', url: product.image }] : [],
        skus: [
          { id: 'sku-1', title: '500g 装', price: product.price, stock: 100 },
          { id: 'sku-2', title: '1kg 装', price: product.price * 1.8, stock: 50 },
          { id: 'sku-3', title: '2.5kg 家庭装', price: product.price * 4, stock: 30 },
        ],
        description: `${product.title}，产自${product.origin}，精选优质农产品，品质保证。`,
      } as ProductDetail);
    }

    return ApiClient.get<ProductDetail>(`/products/${id}`);
  },
};
