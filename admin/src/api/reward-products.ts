import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

export interface RewardProductSku {
  id: string;
  title: string;
  price: number;
  cost?: number | null;
  stock: number;
  skuCode?: string | null;
  weightGram?: number | null;
  status?: string;
}

export interface RewardProduct {
  id: string;
  title: string;
  description?: string | null;
  basePrice: number;
  cost?: number | null;
  status: string;
  categoryId?: string | null;
  skus: RewardProductSku[];
  media?: Array<{
    id: string;
    url: string;
    type: string;
    sortOrder: number;
  }>;
  referenceSummary?: {
    vipGiftOptionCount: number;
    lotteryPrizeCount: number;
    totalReferences: number;
  };
  createdAt: string;
}

interface RewardProductParams extends PaginationParams { keyword?: string; status?: string; }

export interface CreateRewardProductInput {
  title: string;
  subtitle?: string;
  description?: string;
  categoryId?: string;
  basePrice: number;
  cost?: number;
  origin?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  skus: Array<{
    title: string;
    price: number;
    cost?: number;
    stock: number;
    skuCode?: string;
    weightGram?: number;
  }>;
  media?: Array<{
    type: string;
    url: string;
    sortOrder?: number;
    alt?: string;
  }>;
}

export interface UpdateRewardProductInput {
  title?: string;
  description?: string;
  categoryId?: string;
  basePrice?: number;
  cost?: number;
  status?: string;
}

export interface CreateSkuInput {
  title: string;
  price: number;
  cost?: number;
  stock: number;
  skuCode?: string;
  weightGram?: number;
}

export interface UpdateSkuInput {
  title?: string;
  price?: number;
  cost?: number;
  stock?: number;
  skuCode?: string;
  weightGram?: number;
}

// 商品列表
export const getRewardProducts = (params?: RewardProductParams): Promise<PaginatedData<RewardProduct>> =>
  client.get('/admin/reward-products', { params });

// 商品详情
export const getRewardProduct = (id: string): Promise<RewardProduct> =>
  client.get(`/admin/reward-products/${id}`);

// 创建商品
export const createRewardProduct = (data: CreateRewardProductInput): Promise<RewardProduct> =>
  client.post('/admin/reward-products', data);

// 更新商品基本信息
export const updateRewardProduct = (id: string, data: UpdateRewardProductInput): Promise<RewardProduct> =>
  client.put(`/admin/reward-products/${id}`, data);

// 删除商品
export const deleteRewardProduct = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/admin/reward-products/${id}`);

// 新增 SKU
export const addRewardProductSku = (productId: string, data: CreateSkuInput): Promise<RewardProductSku> =>
  client.post(`/admin/reward-products/${productId}/skus`, data);

// 更新 SKU
export const updateRewardProductSku = (productId: string, skuId: string, data: UpdateSkuInput): Promise<RewardProductSku> =>
  client.put(`/admin/reward-products/${productId}/skus/${skuId}`, data);

// 删除 SKU
export const deleteRewardProductSku = (productId: string, skuId: string): Promise<{ ok: boolean }> =>
  client.delete(`/admin/reward-products/${productId}/skus/${skuId}`);
