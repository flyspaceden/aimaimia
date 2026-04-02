/**
 * AI 智能创作助手仓储（Repo）
 *
 * 当前实现：
 * - 前端占位算法：基于模板/关键词返回配乐与标签建议
 *
 * 后端接入说明：
 * - 建议后端统一接入 LLM/推荐系统，前端只消费“建议结果”
 * - 建议接口：
 *   - `POST /api/v1/ai/posts/music` → `Result<AiMusicTrack[]>`
 *   - `POST /api/v1/ai/posts/tags` → `Result<AiTagSuggestion[]>`
 * - body：`{ template, title, content }`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#44-ai-智能创作助手配乐打标`
 */
import { farmingTags, postTags } from '../constants';
import { mockAiTracks } from '../mocks';
import { AiMusicTrack, AiTagSuggestion, PostTemplate, Result } from '../types';
import { simulateRequest } from './helpers';

const templateTagMap: Record<PostTemplate, string[]> = {
  story: ['产品故事'],
  diary: ['种植日志'],
  recipe: ['食谱教程'],
  general: ['企业动态'],
};

const keywordTagMap: Array<{ keywords: string[]; label: string; reason: string }> = [
  { keywords: ['丰收', '采收', '收获'], label: '#丰收#', reason: '识别到丰收场景' },
  { keywords: ['育苗', '苗期', '发芽'], label: '#育苗期#', reason: '识别到育苗关键词' },
  { keywords: ['成长期', '生长', '温室'], label: '#成长期#', reason: '识别到种植阶段' },
  { keywords: ['采摘', '冷链', '仓储'], label: '#采收季#', reason: '识别到采收流程' },
  { keywords: ['轻食', '沙拉', '低卡'], label: '#轻食#', reason: '识别到轻食描述' },
];

// AI 推荐：智能配乐/自动打标的占位仓储（复杂业务逻辑需中文注释）
export const AiRepo = {
  /**
   * AI 智能配乐
   * - 用途：发布页选择配乐/试听
   * - 后端建议：`POST /api/v1/ai/posts/music`
   */
  recommendMusic: async (payload: {
    template: PostTemplate;
    title: string;
    content: string;
  }): Promise<Result<AiMusicTrack[]>> => {
    const text = `${payload.title} ${payload.content}`;
    const tracks = [...mockAiTracks];
    const moodBoost = text.includes('丰收') ? '温暖' : text.includes('雨') ? '治愈' : null;
    const sorted = moodBoost
      ? tracks.sort((a, b) => (a.mood === moodBoost ? -1 : b.mood === moodBoost ? 1 : 0))
      : tracks;
    return simulateRequest(sorted, { delay: 260 });
  },
  /**
   * AI 自动打标/推荐标签
   * - 用途：发布页“AI 推荐标签”
   * - 后端建议：`POST /api/v1/ai/posts/tags`
   */
  recommendTags: async (payload: {
    template: PostTemplate;
    title: string;
    content: string;
  }): Promise<Result<AiTagSuggestion[]>> => {
    const text = `${payload.title} ${payload.content}`;
    const suggestions: AiTagSuggestion[] = [];
    const baseTags = templateTagMap[payload.template] ?? [];
    baseTags.forEach((tag) => suggestions.push({ label: tag, reason: '基于模板推荐' }));
    keywordTagMap.forEach((item) => {
      if (item.keywords.some((keyword) => text.includes(keyword))) {
        suggestions.push({ label: item.label, reason: item.reason });
      }
    });
    const fallback = [...postTags, ...farmingTags].slice(0, 3);
    fallback.forEach((tag) => {
      if (!suggestions.some((item) => item.label === tag)) {
        suggestions.push({ label: tag, reason: '热门标签' });
      }
    });
    const unique = suggestions.reduce<AiTagSuggestion[]>((acc, item) => {
      if (!acc.some((existing) => existing.label === item.label)) {
        acc.push(item);
      }
      return acc;
    }, []);
    return simulateRequest(unique, { delay: 240 });
  },
};
