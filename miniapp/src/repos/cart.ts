import { ApiClient } from '@/api/client';
import type { Cart, CartMergeItem, CartQuantityAck, Result } from '@/types';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function mergeFingerprint(items: CartMergeItem[]): string {
  const snapshot = items
    .map((item) => `${item.skuId}:${item.quantity}:${item.isPrize ? 1 : 0}`)
    .sort()
    .join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < snapshot.length; index += 1) {
    hash ^= snapshot.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 一个 key 代表一次“将当前本地快照合并到当前登录代”的业务操作。
 * 调用方需要手动重试时，应保留并传回同一个 key，不要重新生成。
 */
export function createCartMergeIdempotencyKey(items: CartMergeItem[]): string {
  const operationNonce = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return [
    'mini-cart-merge',
    Date.now().toString(36),
    mergeFingerprint(items),
    operationNonce,
  ].join(':');
}

function invalidIdempotencyKey(): Result<Cart> {
  return {
    ok: false,
    error: {
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'cart merge idempotency key is invalid',
      displayMessage: '购物车合并请求无效，请重试',
      retryable: true,
    },
  };
}

export const CartRepo = {
  get: (): Promise<Result<Cart>> => ApiClient.get<Cart>('/cart'),

  addItem: (skuId: string, quantity: number): Promise<Result<Cart>> =>
    ApiClient.post<Cart>('/cart/items', { skuId, quantity }),

  updateQuantity: (cartItemId: string, quantity: number): Promise<Result<CartQuantityAck>> =>
    ApiClient.put<CartQuantityAck>(`/cart/item-ids/${cartItemId}`, { quantity }),

  toggleSelected: (skuId: string, isSelected: boolean): Promise<Result<Cart>> =>
    ApiClient.put<Cart>(`/cart/items/${skuId}/select`, { isSelected }),

  removeItem: (skuId: string): Promise<Result<Cart>> =>
    ApiClient.delete<Cart>(`/cart/items/${skuId}`),

  removePrizeItem: (cartItemId: string): Promise<Result<Cart>> =>
    ApiClient.delete<Cart>(`/cart/prize-items/${cartItemId}`),

  clear: (): Promise<Result<Cart>> => ApiClient.delete<Cart>('/cart'),

  createMergeIdempotencyKey: (items: CartMergeItem[]): string =>
    createCartMergeIdempotencyKey(items),

  mergeItems: async (
    items: CartMergeItem[],
    idempotencyKey = createCartMergeIdempotencyKey(items),
  ): Promise<Result<Cart>> => {
    const normalizedKey = idempotencyKey.trim();
    if (!IDEMPOTENCY_KEY_PATTERN.test(normalizedKey)) return invalidIdempotencyKey();

    return ApiClient.post<Cart>(
      '/cart/merge',
      {
        items: items.map((item) => ({
          skuId: item.skuId,
          quantity: item.quantity,
          ...(item.localKey !== undefined && { localKey: item.localKey }),
          ...(item.isPrize !== undefined && { isPrize: item.isPrize }),
          ...(item.claimToken !== undefined && { claimToken: item.claimToken }),
        })),
      },
      { idempotencyKey: normalizedKey },
    );
  },
};
