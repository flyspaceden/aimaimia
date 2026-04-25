import client from './client';
import type { Product, PaginatedData, QueryParams } from '@/types';

// 分类树（公开接口）
export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
}
export const getCategories = (): Promise<CategoryNode[]> =>
  client.get('/products/categories');

export const getProducts = (params?: QueryParams): Promise<PaginatedData<Product>> =>
  client.get('/seller/products', { params });

export const getProduct = (id: string): Promise<Product> =>
  client.get(`/seller/products/${id}`);

export const createProduct = (data: Record<string, unknown>): Promise<Product> =>
  client.post('/seller/products', data);

export const updateProduct = (id: string, data: Record<string, unknown>): Promise<Product> =>
  client.put(`/seller/products/${id}`, data);

export const toggleProductStatus = (id: string, status: string): Promise<Product> =>
  client.post(`/seller/products/${id}/status`, { status });

export const updateProductSkus = (id: string, skus: Record<string, unknown>[]): Promise<unknown> =>
  client.put(`/seller/products/${id}/skus`, { skus });

export const deleteProduct = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/seller/products/${id}`);

// ============================================================
// 草稿 API（仅 title 必填，其他字段可选）
// ============================================================

export const createDraft = (data: Record<string, unknown> & { title: string }): Promise<Product> =>
  client.post('/seller/products/draft', data);

export const updateDraft = (id: string, data: Record<string, unknown>): Promise<Product> =>
  client.put(`/seller/products/${id}/draft`, data);

export const submitDraft = (id: string): Promise<Product> =>
  client.post(`/seller/products/${id}/submit`);
