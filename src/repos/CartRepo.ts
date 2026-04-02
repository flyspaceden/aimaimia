/**
 * 服务端购物车仓储（Repo）
 *
 * 后端接口：
 * - GET /api/v1/cart → ServerCart
 * - POST /api/v1/cart/items → ServerCart
 * - PATCH /api/v1/cart/items/:skuId → ServerCart
 * - DELETE /api/v1/cart/items/:skuId → ServerCart
 * - DELETE /api/v1/cart → void
 * - POST /api/v1/cart/merge → ServerCart（合并本地购物车到服务端）
 */
import { ServerCart, Result } from '../types';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';

// Mock 数据
let mockCart: ServerCart = {
  id: 'cart-mock-1',
  items: [],
};

/** Mock 专用：外部模块向 mock 购物车注入商品（如抽奖奖品） */
export function _mockInjectItem(item: import('../types').ServerCartItem) {
  mockCart.items.push(item);
}

export const CartRepo = {
  /** 获取购物车 */
  get: async (): Promise<Result<ServerCart>> => {
    if (USE_MOCK) {
      return simulateRequest({ ...mockCart, items: [...mockCart.items] });
    }
    return ApiClient.get<ServerCart>('/cart');
  },

  /** 添加商品（productInfo 仅 Mock 模式使用，真实 API 由后端返回完整商品数据） */
  addItem: async (skuId: string, quantity: number, productInfo?: { id: string; title: string; image: string; price: number }): Promise<Result<ServerCart>> => {
    if (USE_MOCK) {
      const existing = mockCart.items.find((i) => i.skuId === skuId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        mockCart.items.push({
          id: `ci-${Date.now()}`,
          skuId,
          quantity,
          product: {
            id: productInfo?.id ?? `p-${skuId}`,
            title: productInfo?.title ?? `商品 ${skuId.slice(-4)}`,
            image: productInfo?.image ?? null,
            price: productInfo?.price ?? 29.9,
            originalPrice: null,
            stock: 100,
          },
        });
      }
      return simulateRequest({ ...mockCart }, { delay: 300 });
    }
    return ApiClient.post<ServerCart>('/cart/items', { skuId, quantity });
  },

  /** 更新数量 */
  updateQuantity: async (skuId: string, quantity: number): Promise<Result<ServerCart>> => {
    if (USE_MOCK) {
      const item = mockCart.items.find((i) => i.skuId === skuId);
      if (item) item.quantity = quantity;
      return simulateRequest({ ...mockCart }, { delay: 200 });
    }
    return ApiClient.patch<ServerCart>(`/cart/items/${skuId}`, { quantity });
  },

  /** 删除商品 */
  removeItem: async (skuId: string): Promise<Result<ServerCart>> => {
    if (USE_MOCK) {
      mockCart.items = mockCart.items.filter((i) => i.skuId !== skuId);
      return simulateRequest({ ...mockCart }, { delay: 200 });
    }
    return ApiClient.delete<ServerCart>(`/cart/items/${skuId}`);
  },

  /** 删除购物车奖品项（按 cartItemId 删除） */
  removePrizeItem: async (cartItemId: string): Promise<Result<ServerCart>> => {
    if (USE_MOCK) {
      mockCart.items = mockCart.items.filter((i) => i.id !== cartItemId);
      return simulateRequest({ ...mockCart }, { delay: 200 });
    }
    return ApiClient.delete<ServerCart>(`/cart/prize-items/${cartItemId}`);
  },

  /** 清空购物车 */
  clear: async (): Promise<Result<void>> => {
    if (USE_MOCK) {
      mockCart.items = [];
      return simulateRequest(undefined as void, { delay: 200 });
    }
    return ApiClient.delete<void>('/cart');
  },

  /** 合并本地购物车到服务端（登录时调用）
   *  HC-1: 奖品项只传 claimToken，后端从 Redis 反查元数据
   *  HC-3: 带 Idempotency-Key 防重复消耗 token */
  mergeItems: async (items: { localKey?: string; skuId: string; quantity: number; isPrize?: boolean; claimToken?: string }[]): Promise<Result<ServerCart>> => {
    if (USE_MOCK) {
      // Mock: 简单合并
      for (const item of items) {
        const existing = mockCart.items.find((i) => i.skuId === item.skuId && !item.isPrize);
        if (existing && !item.isPrize) {
          existing.quantity += item.quantity;
        } else {
          mockCart.items.push({
            id: `ci-merge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            skuId: item.skuId,
            quantity: item.quantity,
            isPrize: item.isPrize,
            product: {
              id: `p-${item.skuId}`,
              title: `商品 ${item.skuId.slice(-4)}`,
              image: null,
              price: 0,
              originalPrice: null,
              stock: 100,
            },
          });
        }
      }
      return simulateRequest({ ...mockCart }, { delay: 400 });
    }
    // HC-3: 生成幂等键防网络重试重复消耗 claimToken
    const idempotencyKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return ApiClient.post<ServerCart>('/cart/merge', { items }, {
      headers: { 'idempotency-key': idempotencyKey },
    });
  },
};
