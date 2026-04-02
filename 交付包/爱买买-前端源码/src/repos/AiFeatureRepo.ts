/**
 * AI 功能入口仓储（Repo）：AI 溯源 / AI 推荐 / AI 金融
 *
 * 当前实现：
 * - 使用 `src/mocks/aiFeatures.ts` 提供占位数据
 *
 * 后端接入说明：
 * - 这些页面属于“入口页/仪表盘”，建议后端直接返回可展示的卡片数据（含文案与跳转/动作）
 * - 建议接口：
 *   - `GET /api/v1/ai/trace/overview` → `Result<AiTraceOverview>`
 *   - `GET /api/v1/ai/recommend/insights` → `Result<AiRecommendInsight[]>`
 *   - `GET /api/v1/ai/finance/services` → `Result<AiFinanceService[]>`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#7-ai-功能入口溯源推荐金融`
 */
import { mockAiFinanceServices, mockAiRecommendInsights, mockAiTraceOverview } from '../mocks';
import { AiFinanceService, AiRecommendInsight, AiTraceOverview, Result } from '../types';
import { simulateRequest } from './helpers';

// AI 功能入口仓储：溯源/推荐/金融的接口占位
export const AiFeatureRepo = {
  /** AI 溯源概览：`GET /api/v1/ai/trace/overview` */
  getTraceOverview: async (): Promise<Result<AiTraceOverview>> =>
    simulateRequest(mockAiTraceOverview, { delay: 280 }),
  /** AI 推荐洞察：`GET /api/v1/ai/recommend/insights` */
  getRecommendInsights: async (): Promise<Result<AiRecommendInsight[]>> =>
    simulateRequest(mockAiRecommendInsights, { delay: 260 }),
  /** AI 金融服务列表：`GET /api/v1/ai/finance/services` */
  getFinanceServices: async (): Promise<Result<AiFinanceService[]>> =>
    simulateRequest(mockAiFinanceServices, { delay: 240 }),
};
