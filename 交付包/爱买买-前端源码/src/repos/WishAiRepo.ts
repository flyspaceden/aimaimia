/**
 * AI 心愿助手仓储（Repo）
 *
 * 当前实现：
 * - 前端基于关键词做“自动打标/推荐”占位算法
 *
 * 后端接入说明：
 * - 推荐把这类 AI 逻辑放后端（可调用 LLM/规则引擎），前端只展示建议并允许用户一键加入
 * - 建议接口：
 *   - `POST /api/v1/ai/wishes/tags` → `Result<AiTagSuggestion[]>`
 *   - `GET  /api/v1/ai/wishes/recommendations` → `Result<WishRecommendation[]>`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#33-ai-心愿助手分类打标推荐`
 */
import { wishTags } from '../constants';
import { mockWishes } from '../mocks';
import { AiTagSuggestion, Result, WishRecommendation } from '../types';
import { simulateRequest } from './helpers';

const keywordTagMap: Array<{ keywords: string[]; label: string; reason: string }> = [
  { keywords: ['采购', '供货', '供应'], label: '采购需求', reason: '识别到采购/供货意图' },
  { keywords: ['技术', '方案', '种植', '溯源'], label: '技术求助', reason: '识别到技术支持需求' },
  { keywords: ['尝鲜', '新品', '礼盒'], label: '新品尝鲜', reason: '识别到新品/礼盒诉求' },
  { keywords: ['团购', '合作', '批量'], label: '团购意向', reason: '识别到团购/合作关键词' },
  { keywords: ['功能', '优化', '体验'], label: '功能建议', reason: '识别到平台功能诉求' },
  { keywords: ['有机', '绿色'], label: '有机/绿色', reason: '识别到认证关键词' },
  { keywords: ['GAP'], label: 'GAP 认证', reason: '识别到 GAP 认证' },
];

// AI 心愿助手：自动打标/推荐心愿（复杂业务逻辑需中文注释）
export const WishAiRepo = {
  /**
   * 推荐标签（自动打标）
   * - 用途：心愿发布页，辅助用户快速选择标签
   * - 后端建议：`POST /api/v1/ai/wishes/tags`
   * - body：`{ title, description }`
   */
  suggestTags: async (payload: { title: string; description: string }): Promise<Result<AiTagSuggestion[]>> => {
    const text = `${payload.title} ${payload.description}`;
    const suggestions: AiTagSuggestion[] = [];
    keywordTagMap.forEach((item) => {
      if (item.keywords.some((keyword) => text.includes(keyword))) {
        suggestions.push({ label: item.label, reason: item.reason });
      }
    });
    wishTags.forEach((tag) => {
      if (!suggestions.some((item) => item.label === tag) && suggestions.length < 6) {
        suggestions.push({ label: tag, reason: '热门标签' });
      }
    });
    return simulateRequest(suggestions, { delay: 240 });
  },
  /**
   * 推荐心愿（AI 推荐）
   * - 用途：心愿池“AI 推荐/你可能也想要”
   * - 后端建议：`GET /api/v1/ai/wishes/recommendations`
   */
  recommendWishes: async (): Promise<Result<WishRecommendation[]>> => {
    const sorted = [...mockWishes].sort((a, b) => b.wishPower.score - a.wishPower.score);
    const recommendations = sorted.slice(0, 3).map((wish, index) => ({
      id: `ai-wish-${wish.id}`,
      wish,
      reason:
        index === 0
          ? '高心愿力与高互动'
          : wish.badges?.length
            ? `命中徽章：${wish.badges[0].label}`
            : '近期热度上涨',
      tags: wish.tags.slice(0, 2),
    }));
    return simulateRequest(recommendations, { delay: 220 });
  },
};
