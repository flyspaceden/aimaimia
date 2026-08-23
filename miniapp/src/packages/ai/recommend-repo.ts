import { ApiClient } from '@/api/client';
import type { Product, Result } from '@/types';
import type {
  AiBundleIntent,
  AiPromotionIntent,
  AiRecommendTheme,
} from './types';

export type AiRecommendInsight = {
  id: string;
  title: string;
  description: string;
  weight: number;
  tags: string[];
};

export type AiRecommendPlan = {
  id: string;
  title: string;
  description: string;
  tone: 'brand' | 'accent' | 'analysis';
  totalPrice: number;
  products: Product[];
  highlights: string[];
};

export type AiRecommendPlanResult = {
  query?: string;
  categoryId?: string;
  categoryName?: string;
  budget?: number;
  constraints: string[];
  recommendThemes: AiRecommendTheme[];
  preferRecommended: boolean;
  summary: string;
  aiReason: string;
  tags: string[];
  products: Product[];
  plans: AiRecommendPlan[];
};

export type AiRecommendPlanInput = {
  query?: string;
  categoryId?: string;
  categoryName?: string;
  preferRecommended?: boolean;
  constraints?: string[];
  maxPrice?: number;
  recommendThemes?: AiRecommendTheme[];
  usageScenario?: string;
  promotionIntent?: AiPromotionIntent;
  bundleIntent?: AiBundleIntent;
  originPreference?: string;
  dietaryPreference?: string;
  flavorPreference?: string;
  categoryHint?: string;
};

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

function isProduct(value: unknown): value is Product {
  const item = record(value);
  return Boolean(item
    && typeof item.id === 'string'
    && typeof item.title === 'string'
    && isFiniteNumber(item.price)
    && (item.type === 'SIMPLE' || item.type === 'BUNDLE')
    && typeof item.image === 'string'
    && isStringArray(item.tags));
}

function isPlan(value: unknown): value is AiRecommendPlan {
  const item = record(value);
  return Boolean(item
    && typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.description === 'string'
    && ['brand', 'accent', 'analysis'].includes(String(item.tone))
    && isFiniteNumber(item.totalPrice)
    && Array.isArray(item.products)
    && item.products.every(isProduct)
    && isStringArray(item.highlights));
}

function isPlanResult(value: unknown): value is AiRecommendPlanResult {
  const item = record(value);
  return Boolean(item
    && typeof item.summary === 'string'
    && typeof item.aiReason === 'string'
    && typeof item.preferRecommended === 'boolean'
    && isStringArray(item.constraints)
    && isStringArray(item.recommendThemes)
    && item.recommendThemes.every((theme) => ['hot', 'discount', 'tasty', 'seasonal', 'recent'].includes(theme))
    && isStringArray(item.tags)
    && Array.isArray(item.products)
    && item.products.every(isProduct)
    && Array.isArray(item.plans)
    && item.plans.every(isPlan)
    && (item.budget === undefined || isFiniteNumber(item.budget)));
}

function isInsight(value: unknown): value is AiRecommendInsight {
  const item = record(value);
  return Boolean(item
    && typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.description === 'string'
    && isFiniteNumber(item.weight)
    && isStringArray(item.tags));
}

function invalidContract<T>(message: string): Result<T> {
  return {
    ok: false,
    error: {
      code: 'INVALID_AI_RECOMMEND_CONTRACT',
      message,
      displayMessage: 'AI 推荐数据异常，请稍后重试',
      retryable: true,
    },
  };
}

export const AiRecommendRepo = {
  async getPlan(input: AiRecommendPlanInput): Promise<Result<AiRecommendPlanResult>> {
    const result = await ApiClient.get<unknown>('/ai/recommend/plan', {
      q: input.query,
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      preferRecommended: input.preferRecommended ? 1 : undefined,
      constraints: input.constraints?.length ? input.constraints.join(',') : undefined,
      maxPrice: input.maxPrice,
      recommendThemes: input.recommendThemes?.length ? input.recommendThemes.join(',') : undefined,
      usageScenario: input.usageScenario,
      promotionIntent: input.promotionIntent,
      bundleIntent: input.bundleIntent,
      originPreference: input.originPreference,
      dietaryPreference: input.dietaryPreference,
      flavorPreference: input.flavorPreference,
      categoryHint: input.categoryHint,
    });
    if (!result.ok) return result;
    return isPlanResult(result.data)
      ? { ok: true, data: result.data }
      : invalidContract('recommend plan response is malformed');
  },

  async getInsights(): Promise<Result<AiRecommendInsight[]>> {
    const result = await ApiClient.get<unknown>('/ai/recommend/insights');
    if (!result.ok) return result;
    return Array.isArray(result.data) && result.data.every(isInsight)
      ? { ok: true, data: result.data }
      : invalidContract('recommend insights response is malformed');
  },
};
