/**
 * AI 农管家仓储（Repo）
 *
 * 当前实现：
 * - Mock 问候语 + 快捷入口 + 对话占位回复（关键词匹配）
 *
 * 后端接入说明：
 * - 建议后端提供统一对话接口（可接 LLM/工具调用），前端只负责展示对话与快捷入口
 * - 建议接口：
 *   - `GET /api/v1/ai-assistant/shortcuts` → `Result<AiShortcut[]>`
 *   - `GET /api/v1/ai-assistant/greeting` → `Result<AiChatMessage>`
 *   - `POST /api/v1/ai-assistant/chat` → `Result<AiChatMessage>`
 *     - body：`{ message }`
 *
 * 详细接口清单：`说明文档/后端接口清单.md#0-总体约定`
 */
import { mockAiGreeting, mockAiShortcuts } from '../mocks';
import { AiChatMessage, AiShortcut, Result } from '../types';
import { simulateRequest } from './helpers';

const now = () => new Date().toISOString();

// AI 农管家仓储：对话入口与快捷问题（复杂业务逻辑需中文注释）
export const AiAssistantRepo = {
  /**
   * 快捷入口列表
   * - 用途：我的页 AI 农管家“场景卡/快捷问题”
   * - 后端建议：`GET /api/v1/ai-assistant/shortcuts`
   */
  listShortcuts: async (): Promise<Result<AiShortcut[]>> => simulateRequest(mockAiShortcuts, { delay: 220 }),
  /**
   * 问候语（开场消息）
   * - 用途：进入 AI 农管家页面时的欢迎消息
   * - 后端建议：`GET /api/v1/ai-assistant/greeting`
   */
  getGreeting: async (): Promise<Result<AiChatMessage>> => simulateRequest({ ...mockAiGreeting, createdAt: now() }),
  /**
   * 对话
   * - 用途：AI 农管家聊天
   * - 后端建议：`POST /api/v1/ai-assistant/chat`
   * - body：`{ message }`
   * - 说明：后端可根据 message + 用户上下文（token）进行工具调用（订单/物流/售后等）
   */
  chat: async (message: string): Promise<Result<AiChatMessage>> => {
    // 根据关键词给出占位回复（后续由后端/LLM 接入替换）
    let reply = '我已收到你的问题，稍后为你生成详细建议。';
    if (message.includes('订单') || message.includes('物流')) {
      reply = '我正在为你查询最近订单的物流轨迹，请稍等（占位）。';
    } else if (message.includes('低糖') || message.includes('健康')) {
      reply = '建议选择低糖水果，如蓝莓/草莓，并搭配坚果（占位）。';
    } else if (message.includes('补货')) {
      reply = '根据你的购买周期，本周建议补货鸡蛋/绿叶蔬菜（占位）。';
    } else if (message.includes('考察') || message.includes('预约')) {
      reply = '你的考察预约状态：待审核（占位）。';
    }
    const response: AiChatMessage = {
      id: `ai-${Date.now()}`,
      role: 'assistant',
      content: reply,
      createdAt: now(),
    };
    return simulateRequest(response, { delay: 500 });
  },
};
