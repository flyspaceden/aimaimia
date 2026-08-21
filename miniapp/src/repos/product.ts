import { ApiClient } from '@/api/client';
import type {
  Category,
  PageResult,
  Product,
  ProductDetail,
  ProductListQuery,
  Result,
} from '@/types';
import { normalizePageResult } from './contracts';

const DEFAULT_PAGE_SIZE = 8;

export const ProductRepo = {
  async list(query: ProductListQuery = {}): Promise<Result<PageResult<Product>>> {
    const result = await ApiClient.get<unknown>('/products', {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
      categoryId: query.categoryId,
      keyword: query.keyword,
      preferRecommended: query.preferRecommended ? 1 : undefined,
      constraints: query.constraints?.length ? query.constraints.join(',') : undefined,
      maxPrice: query.maxPrice,
      recommendThemes: query.recommendThemes?.length
        ? query.recommendThemes.join(',')
        : undefined,
      usageScenario: query.usageScenario,
      originPreference: query.originPreference,
      dietaryPreference: query.dietaryPreference,
      flavorPreference: query.flavorPreference,
      categoryHint: query.categoryHint,
    });
    return normalizePageResult<Product>(result, 'products page');
  },

  getById: (productId: string): Promise<Result<ProductDetail>> =>
    ApiClient.get<ProductDetail>(`/products/${productId}`),

  listCategories: (): Promise<Result<Category[]>> =>
    ApiClient.get<Category[]>('/products/categories'),
};
