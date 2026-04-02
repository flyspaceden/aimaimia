/**
 * 域模型：AI 功能入口（溯源/推荐/金融）
 *
 * 用途：
 * - AI 溯源概览、AI 推荐洞察、AI 金融服务入口（入口页展示用）
 *
 * 后端接入建议：
 * - 由后端直接返回可展示卡片数据（见 `说明文档/后端接口清单.md#7-ai-功能入口溯源推荐金融`）
 */
export type AiTraceStepStatus = 'done' | 'doing' | 'pending';

export type AiTraceStep = {
  id: string;
  title: string;
  description: string;
  status: AiTraceStepStatus;
  time?: string;
  location?: string;
};

export type AiTraceOverview = {
  productId: string;
  productName: string;
  batchId: string;
  farmName: string;
  statusLabel: string;
  tags: string[];
  steps: AiTraceStep[];
};

export type AiRecommendInsight = {
  id: string;
  title: string;
  description: string;
  weight: number;
  tags: string[];
};

export type AiFinanceServiceStatus = 'available' | 'soon' | 'locked';

export type AiFinanceService = {
  id: string;
  title: string;
  description: string;
  status: AiFinanceServiceStatus;
  badge?: string;
};
