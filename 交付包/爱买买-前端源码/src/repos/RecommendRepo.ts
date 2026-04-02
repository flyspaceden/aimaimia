/**
 * 个性推荐仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/recommendations.ts` 作为“为你推荐”数据源
 *
 * 后端接入说明：
 * - 推荐逻辑建议后端完成，并返回“可解释理由 reasons[]”
 * - 建议接口：
 *   - `GET /api/v1/recommendations/me` → `Result<RecommendationItem[]>`
 *   - `POST /api/v1/recommendations/{id}/not-interested` → `Result<RecommendationItem[]>`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#54-个性推荐`
 */
import { mockRecommendations } from '../mocks';
import { RecommendationItem, Result } from '../types';
import { simulateRequest } from './helpers';

let recommendCache = [...mockRecommendations];

// 推荐仓储：我的页个性推荐（复杂业务逻辑需中文注释）
export const RecommendRepo = {
  /** 获取推荐列表：`GET /api/v1/recommendations/me` */
  listForMe: async (): Promise<Result<RecommendationItem[]>> => simulateRequest(recommendCache, { delay: 240 }),
  /**
   * 标记“不感兴趣”
   * - 用途：推荐卡片右侧操作
   * - 后端建议：`POST /api/v1/recommendations/{id}/not-interested`
   */
  markNotInterested: async (id: string): Promise<Result<RecommendationItem[]>> => {
    recommendCache = recommendCache.filter((item) => item.id !== id);
    return simulateRequest(recommendCache, { delay: 200 });
  },
};
