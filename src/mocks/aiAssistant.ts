import { AiChatMessage, AiShortcut } from '../types';

export const mockAiShortcuts: AiShortcut[] = [
  { id: 'sc-001', title: '查物流', prompt: '我的订单到哪了？' },
  { id: 'sc-002', title: '低糖推荐', prompt: '推荐一些低糖水果' },
  { id: 'sc-003', title: '补货建议', prompt: '本周适合补货什么？' },
  { id: 'sc-004', title: '考察进度', prompt: '查看我的考察预约进度' },
];

export const mockAiGreeting: AiChatMessage = {
  id: 'ai-hello',
  role: 'assistant',
  content: '你好，我是 AI 农管家。你可以问我物流、健康饮食或农事日历等问题。',
  createdAt: new Date().toISOString(),
};
