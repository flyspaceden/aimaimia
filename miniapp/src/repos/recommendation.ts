import { ApiClient } from '@/api/client';
import type { Product, RecommendationItem, Result } from '@/types';
import { invalidContract } from './contracts';

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false;
  const product = value as Partial<Product>;
  return typeof product.id === 'string'
    && typeof product.title === 'string'
    && typeof product.price === 'number'
    && Number.isFinite(product.price)
    && (product.type === 'SIMPLE' || product.type === 'BUNDLE')
    && typeof product.unit === 'string'
    && typeof product.origin === 'string'
    && typeof product.image === 'string'
    && Array.isArray(product.tags);
}

function isRecommendation(value: unknown): value is RecommendationItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RecommendationItem>;
  return typeof item.id === 'string'
    && typeof item.reason === 'string'
    && isProduct(item.product);
}

export const RecommendationRepo = {
  async listForMe(): Promise<Result<RecommendationItem[]>> {
    const result = await ApiClient.get<unknown>('/recommendations/me');
    if (!result.ok) return result;
    return Array.isArray(result.data) && result.data.every(isRecommendation)
      ? { ok: true, data: result.data }
      : invalidContract('recommendations response is malformed');
  },
};
