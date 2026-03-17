/**
 * AI 功能入口仓储（Repo）：AI 溯源 / AI 推荐 / AI 金融
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/aiFeatures.ts` 提供占位数据
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接入说明：
 * - 这些页面属于”入口页/仪表盘”，建议后端直接返回可展示的卡片数据（含文案与跳转/动作）
 * - 建议接口：
 *   - `GET /api/v1/ai/trace/overview` → `Result<AiTraceOverview>`
 *   - `GET /api/v1/ai/recommend/insights` → `Result<AiRecommendInsight[]>`
 *   - `GET /api/v1/ai/finance/services` → `Result<AiFinanceService[]>`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#7-ai-功能入口溯源推荐金融`
 */
import { mockAiFinanceServices, mockAiRecommendInsights, mockAiTraceOverview, mockProducts } from '../mocks';
import { AiFinanceService, AiRecommendInsight, AiRecommendPlanResult, AiRecommendTheme, AiTraceOverview, Result } from '../types';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';

// AI 功能入口仓储：溯源/推荐/金融（支持 USE_MOCK 切换）
export const AiFeatureRepo = {
  /** AI 溯源概览：`GET /api/v1/ai/trace/overview?productId=xxx` */
  getTraceOverview: async (productId?: string): Promise<Result<AiTraceOverview>> => {
    if (USE_MOCK) {
      return simulateRequest(mockAiTraceOverview, { delay: 280 });
    }
    return ApiClient.get<AiTraceOverview>('/ai/trace/overview', { productId });
  },
  /** AI 推荐洞察：`GET /api/v1/ai/recommend/insights` */
  getRecommendInsights: async (): Promise<Result<AiRecommendInsight[]>> => {
    if (USE_MOCK) {
      return simulateRequest(mockAiRecommendInsights, { delay: 260 });
    }
    return ApiClient.get<AiRecommendInsight[]>('/ai/recommend/insights');
  },
  /** AI 推荐方案：`GET /api/v1/ai/recommend/plan` */
  getRecommendPlan: async (params?: {
    query?: string;
    categoryId?: string;
    categoryName?: string;
    preferRecommended?: boolean;
    constraints?: string[];
    maxPrice?: number;
    recommendThemes?: AiRecommendTheme[];
    /** 语义槽：使用场景（来自语音意图解析） */
    usageScenario?: string;
    /** 语义槽：促销意图 */
    promotionIntent?: 'threshold-optimization' | 'best-deal';
    /** 语义槽：搭配意图 */
    bundleIntent?: 'meal-kit' | 'complement';
    /** 语义槽：产地偏好 */
    originPreference?: string;
    /** 语义槽：饮食偏好 */
    dietaryPreference?: string;
    /** 语义槽：口味偏好 */
    flavorPreference?: string;
    /** 语义槽：品类提示 */
    categoryHint?: string;
  }): Promise<Result<AiRecommendPlanResult>> => {
    if (USE_MOCK) {
      const products = mockProducts.slice(0, 4);
      return simulateRequest({
        query: params?.query,
        categoryId: params?.categoryId,
        categoryName: params?.categoryName,
        budget: params?.maxPrice,
        constraints: params?.constraints ?? [],
        recommendThemes: params?.recommendThemes ?? [],
        preferRecommended: !!params?.preferRecommended || !params?.query,
        summary: params?.maxPrice
          ? `按 ¥${params.maxPrice} 预算，为你整理了一组值得先看的推荐商品`
          : '为你整理了一组值得先看的推荐商品',
        aiReason: ['AI优选', ...(params?.constraints ?? [])].slice(0, 3).join(' · '),
        tags: ['AI优选', ...(params?.recommendThemes ?? []), ...(params?.constraints ?? [])].slice(0, 6),
        products,
        plans: [
          {
            id: 'mock-plan-1',
            title: params?.maxPrice ? '预算内稳妥组合' : '今日优选组合',
            description: '基于你的条件先挑出一组更容易直接下单的商品。',
            tone: 'brand',
            totalPrice: products.slice(0, 3).reduce((sum, item) => sum + item.price, 0),
            products: products.slice(0, 3),
            highlights: ['AI优选', ...(params?.constraints ?? [])].slice(0, 4),
          },
        ],
      }, { delay: 260 });
    }
    return ApiClient.get<AiRecommendPlanResult>('/ai/recommend/plan', {
      q: params?.query,
      categoryId: params?.categoryId,
      categoryName: params?.categoryName,
      preferRecommended: params?.preferRecommended ? 1 : undefined,
      constraints: params?.constraints?.length ? params.constraints.join(',') : undefined,
      maxPrice: params?.maxPrice,
      recommendThemes: params?.recommendThemes?.length ? params.recommendThemes.join(',') : undefined,
      usageScenario: params?.usageScenario,
      promotionIntent: params?.promotionIntent,
      bundleIntent: params?.bundleIntent,
      originPreference: params?.originPreference,
      dietaryPreference: params?.dietaryPreference,
      flavorPreference: params?.flavorPreference,
      categoryHint: params?.categoryHint,
    });
  },
  /** AI 金融服务列表：`GET /api/v1/ai/finance/services` */
  getFinanceServices: async (): Promise<Result<AiFinanceService[]>> => {
    if (USE_MOCK) {
      return simulateRequest(mockAiFinanceServices, { delay: 240 });
    }
    return ApiClient.get<AiFinanceService[]>('/ai/finance/services');
  },
};
