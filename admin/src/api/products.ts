import client from './client';
import type { Product, PaginatedData, PaginationParams } from '@/types';

interface ProductQueryParams extends PaginationParams {
  status?: string;
  auditStatus?: string;
  keyword?: string;
  companyId?: string;
  startDate?: string;
  endDate?: string;
}

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  children?: CategoryNode[];
}

/** 商品列表 */
export const getProducts = (params?: ProductQueryParams): Promise<PaginatedData<Product>> =>
  client.get('/admin/products', { params });

/** 商品详情 */
export const getProduct = (id: string): Promise<Product> =>
  client.get(`/admin/products/${id}`);

/** 更新商品 */
export const updateProduct = (id: string, data: {
  title?: string;
  subtitle?: string;
  description?: string;
  basePrice?: number;
  categoryId?: string;
  origin?: any;
  aiKeywords?: string[];
  attributes?: Record<string, any>;
  flavorTags?: string[];
  seasonalMonths?: number[];
  usageScenarios?: string[];
  dietaryTags?: string[];
  originRegion?: string;
  tagIds?: string[];
}): Promise<Product> =>
  client.put(`/admin/products/${id}`, data);

/** 触发 AI 重新生成语义标签 */
export const refillSemanticTags = (id: string): Promise<void> =>
  client.post(`/admin/products/${id}/refill-semantic`);

/** 上下架 */
export const toggleProductStatus = (id: string, status: 'ACTIVE' | 'INACTIVE'): Promise<Product> =>
  client.post(`/admin/products/${id}/toggle-status`, { status });

/** 审核商品 */
export const auditProduct = (id: string, data: {
  auditStatus: 'APPROVED' | 'REJECTED';
  auditNote?: string;
}): Promise<Product> =>
  client.post(`/admin/products/${id}/audit`, data);

/** 获取商品分类树 — 复用买家端公开接口 */
export const getCategories = (): Promise<CategoryNode[]> =>
  client.get('/products/categories');

/** 商品统计 */
export const getProductStats = (): Promise<Record<string, number>> =>
  client.get('/admin/products/stats');
