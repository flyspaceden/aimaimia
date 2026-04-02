/**
 * 域模型：AI 智能创作（配乐/标签）
 *
 * 用途：
 * - 发布页：AI 智能配乐、AI 自动打标/推荐标签
 *
 * 后端接入建议：
 * - 由后端提供推荐结果（见 `说明文档/后端接口清单.md#44-ai-智能创作助手配乐打标`）
 */
export type AiMusicTrack = {
  id: string;
  title: string;
  mood: string;
  bpm: number;
  duration: string;
  cover: string;
};

export type AiTagSuggestion = {
  label: string;
  reason?: string;
};

export type AiChatRole = 'user' | 'assistant' | 'system';

export type AiChatMessage = {
  id: string;
  role: AiChatRole;
  content: string;
  createdAt: string;
};

export type AiShortcut = {
  id: string;
  title: string;
  prompt: string;
};
