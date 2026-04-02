/**
 * AI 农管家仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：前端占位模拟问候语/快捷入口/对话回复
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 *   - `GET /api/v1/ai/assistant/shortcuts` → `Result<AiShortcut[]>`
 *   - `GET /api/v1/ai/assistant/greeting` → `Result<AiChatMessage>`
 *   - `POST /api/v1/ai/assistant/chat` → `Result<AiChatMessage>`
 *     - body：`{ message }`
 */
import { mockAiGreeting, mockAiShortcuts } from '../mocks';
import { AiChatHistoryItem, AiChatMessage, AiShortcut, AiVoiceIntent, Result } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

const now = () => new Date().toISOString();

// AI 农管家仓储：对话入口与快捷问题
export const AiAssistantRepo = {
  /**
   * 快捷入口列表
   * - 用途：我的页 AI 农管家"场景卡/快捷问题"
   * - 后端接口：`GET /api/v1/ai/assistant/shortcuts`
   */
  listShortcuts: async (): Promise<Result<AiShortcut[]>> => {
    if (USE_MOCK) return simulateRequest(mockAiShortcuts, { delay: 220 });
    return ApiClient.get<AiShortcut[]>('/ai/assistant/shortcuts');
  },
  /**
   * 问候语（开场消息）
   * - 用途：进入 AI 农管家页面时的欢迎消息
   * - 后端接口：`GET /api/v1/ai/assistant/greeting`
   */
  getGreeting: async (): Promise<Result<AiChatMessage>> => {
    if (USE_MOCK) return simulateRequest({ ...mockAiGreeting, createdAt: now() });
    return ApiClient.get<AiChatMessage>('/ai/assistant/greeting');
  },
  /**
   * 对话
   * - 用途：AI 农管家聊天
   * - 后端接口：`POST /api/v1/ai/assistant/chat`
   * - body：`{ message }`
   */
  chat: async (message: string): Promise<Result<AiChatMessage>> => {
    if (USE_MOCK) {
      // 根据关键词给出占位回复（Mock 模式）
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
    }
    return ApiClient.post<AiChatMessage>('/ai/assistant/chat', { message });
  },

  /**
   * 对话历史列表
   * - 用途：首页最近对话区域
   * - 后端接口：`GET /api/v1/ai/assistant/history`
   */
  listHistory: async (): Promise<Result<AiChatHistoryItem[]>> => {
    if (USE_MOCK) {
      // Mock 模式：返回占位对话历史
      const mockHistory: AiChatHistoryItem[] = [
        { id: 'ch-1', title: '有机蓝莓推荐', lastMessage: '帮你找到了3款有机蓝莓', updatedAt: '2分钟前' },
        { id: 'ch-2', title: '当季枇杷礼盒', lastMessage: '推荐了当季枇杷礼盒', updatedAt: '昨天' },
        { id: 'ch-3', title: '有机农场对比', lastMessage: '对比了5家有机农场', updatedAt: '3天前' },
      ];
      return simulateRequest(mockHistory, { delay: 200 });
    }
    return ApiClient.get<AiChatHistoryItem[]>('/ai/assistant/history');
  },

  /**
   * 语音识别 + 意图解析
   * - 真实实现：expo-av 录音 → 音频文件上传后端 → STT + 意图解析
   * - Mock 模式：随机返回预设意图
   * @param localUri 本地录音文件 URI（expo-av 录音产出的 file:// 路径）
   */
  parseVoiceIntent: async (
    localUri: string,
    prepareId?: string,
    options?: { sessionId?: string; page?: string },
  ): Promise<Result<AiVoiceIntent>> => {
    if (USE_MOCK) {
      // Mock 模式：随机返回预设意图（忽略 localUri）
      const mockIntents: AiVoiceIntent[] = [
        {
          type: 'search',
          transcript: '帮我找有机蔬菜',
          param: '有机蔬菜',
          feedback: '正在为你搜索有机蔬菜...',
          search: { query: '有机蔬菜', matchedCategoryId: 'vegetable', matchedCategoryName: '蔬菜' },
        },
        {
          type: 'search',
          transcript: '当季水果有哪些',
          param: '水果',
          feedback: '正在为你搜索水果...',
          search: { query: '水果', matchedCategoryId: 'fruit', matchedCategoryName: '水果', preferRecommended: true },
        },
        {
          type: 'search',
          transcript: '我想买土鸡蛋',
          param: '土鸡蛋',
          feedback: '正在为你搜索土鸡蛋...',
          search: { query: '土鸡蛋', matchedCategoryId: 'fresh', matchedCategoryName: '生鲜' },
        },
        {
          type: 'search',
          transcript: '看看有机蓝莓',
          param: '有机蓝莓',
          feedback: '正在为你搜索有机蓝莓...',
          search: { query: '有机蓝莓', matchedCategoryId: 'fruit', matchedCategoryName: '水果' },
        },
        { type: 'navigate', transcript: '打开购物车', param: 'cart', feedback: '正在为你打开购物车...' },
        { type: 'navigate', transcript: '去结算', param: 'checkout', feedback: '正在带你去结算...' },
        { type: 'navigate', transcript: '打开设置', param: 'settings', feedback: '正在打开设置...' },
        {
          type: 'transaction',
          transcript: '帮我查订单到哪了',
          param: 'track-order',
          feedback: '正在为你查询订单物流信息...',
          transaction: { action: 'track-order', status: 'shipping' },
        },
        {
          type: 'transaction',
          transcript: '帮我看一下待付款订单',
          param: 'pay',
          feedback: '我来帮你看看付款相关操作。',
          transaction: { action: 'pay', status: 'pendingPay' },
        },
        {
          type: 'recommend',
          transcript: '推荐一些低糖水果',
          param: '水果',
          feedback: '正在为你推荐低糖水果...',
          recommend: {
            query: '水果',
            matchedCategoryId: 'fruit',
            matchedCategoryName: '水果',
            preferRecommended: true,
            constraints: ['low-sugar'],
          },
        },
        {
          type: 'recommend',
          transcript: '推荐今天的爆款',
          param: '爆款',
          feedback: '正在为你挑选爆款商品...',
          recommend: {
            preferRecommended: true,
            recommendThemes: ['hot'],
          },
        },
        {
          type: 'recommend',
          transcript: '推荐今天的折扣商品',
          param: '折扣',
          feedback: '正在为你挑选折扣商品...',
          recommend: {
            preferRecommended: true,
            recommendThemes: ['discount'],
          },
        },
        { type: 'company', transcript: '云南绿源农场怎么样', param: 'comp-1', feedback: '正在查看云南绿源农场...' },
        { type: 'chat', transcript: '最近有什么优惠活动', param: '最近有什么优惠活动', feedback: '让我帮你看看最近的优惠...' },
      ];
      const intent = mockIntents[Math.floor(Math.random() * mockIntents.length)];
      return simulateRequest(intent, { delay: 800 });
    }
    // 真实实现：将录音文件以 multipart/form-data 上传到后端
    const formData = new FormData();
    formData.append('audio', {
      uri: localUri,
      type: 'audio/wav',
      name: 'voice.wav',
    } as any);
    const params = new URLSearchParams();
    if (prepareId) params.set('prepareId', prepareId);
    if (options?.sessionId) params.set('sessionId', options.sessionId);
    if (options?.page) params.set('page', options.page);
    const query = params.toString();
    const path = query ? `/ai/voice-intent?${query}` : '/ai/voice-intent';
    return ApiClient.upload<AiVoiceIntent>(path, formData);
  },

  prepareVoiceIntent: async (): Promise<Result<{ prepareId: string }>> => {
    if (USE_MOCK) {
      return simulateRequest({ prepareId: `mock-${Date.now()}` }, { delay: 100 });
    }
    return ApiClient.post<{ prepareId: string }>('/ai/voice-intent/prepare');
  },
};
