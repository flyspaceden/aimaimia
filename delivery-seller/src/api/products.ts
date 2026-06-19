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
  client.get('/delivery-seller/products', { params });

export const getProduct = (id: string): Promise<Product> =>
  client.get(`/delivery-seller/products/${id}`);

export const createProduct = (data: Record<string, unknown>): Promise<Product> =>
  client.post('/delivery-seller/products', data);

export const updateProduct = (id: string, data: Record<string, unknown>): Promise<Product> =>
  client.patch(`/delivery-seller/products/${id}`, data);

export const submitProduct = (id: string): Promise<Product> =>
  client.post(`/delivery-seller/products/${id}/submit`);
