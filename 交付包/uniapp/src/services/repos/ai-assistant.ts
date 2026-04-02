// AI 农管家仓库：对话/快捷入口占位（需后端对接）
import type { Result } from '../types';

export type AiShortcut = {
  id: string;
  title: string;
  prompt: string;
};

export type AiChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

const shortcuts: AiShortcut[] = [
  { id: 's1', title: '查物流', prompt: '帮我查看最新物流状态' },
  { id: 's2', title: '售后咨询', prompt: '我要申请售后' },
  { id: 's3', title: '饮食建议', prompt: '给我一些低糖饮食建议' },
];

export const AiAssistantRepo = {
  // 快捷入口：后端可返回常用场景的推荐问题
  listShortcuts: async (): Promise<Result<AiShortcut[]>> => {
    return { ok: true, data: shortcuts };
  },

  // 对话接口：后端需返回 AI 回复内容
  chat: async (message: string): Promise<Result<AiChatMessage>> => {
    if (!message.trim()) {
      return { ok: false, error: { code: 'INVALID', message: '消息不能为空' } };
    }
    return {
      ok: true,
      data: {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: `已收到：${message}（占位回复）`,
        createdAt: new Date().toISOString(),
      },
    };
  },
};
