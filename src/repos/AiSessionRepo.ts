import {
  AiChatMessage,
  AiChatMessageExtended,
  AiSuggestedAction,
  AiRecentConversationItem,
  AiSessionDetail,
  AiSessionSummary,
  AiSessionUtterance,
  Result,
} from '../types';
import { ApiClient } from './http/ApiClient';
import { USE_MOCK } from './http/config';

const buildAssistantMessage = (
  utteranceId: string,
  createdAt: string,
  content: string,
): AiChatMessage => ({
  id: `${utteranceId}-assistant`,
  role: 'assistant',
  content,
  createdAt,
});

const buildUserMessage = (
  utteranceId: string,
  createdAt: string,
  content: string,
): AiChatMessage => ({
  id: `${utteranceId}-user`,
  role: 'user',
  content,
  createdAt,
});

const mapSessionMessages = (session: AiSessionDetail): AiChatMessageExtended[] => {
  return session.utterances.flatMap((utterance) => {
    const messages: AiChatMessageExtended[] = [
      {
        ...buildUserMessage(utterance.id, utterance.createdAt, utterance.transcript),
      },
    ];

    // 从 actionPayload 中提取回复内容和 Phase 2 结构化字段
    let assistantContent: string | undefined;
    let suggestedActions: AiSuggestedAction[] | undefined;
    let followUpQuestions: string[] | undefined;

    for (const ir of utterance.intentResults || []) {
      for (const action of ir.actions || []) {
        const payload = action.payload as any;
        if (payload?.chatResponse) {
          // Phase 2 格式：从 chatResponse 提取结构化字段
          assistantContent = payload.chatResponse.reply;
          suggestedActions = payload.chatResponse.suggestedActions;
          followUpQuestions = payload.chatResponse.followUpQuestions;
        } else if (payload?.message && !assistantContent) {
          // Phase 1 兼容格式：仅提取 message 文本
          assistantContent = payload.message;
        }
      }
    }

    if (assistantContent) {
      messages.push({
        ...buildAssistantMessage(utterance.id, utterance.createdAt, assistantContent),
        suggestedActions,
        followUpQuestions,
      });
    }

    return messages;
  });
};

export const AiSessionRepo = {
  create: async (page: string, context?: Record<string, any>): Promise<Result<{ id: string; page: string }>> => {
    if (USE_MOCK) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: 'Mock 模式不使用真实 AI 会话',
          displayMessage: '当前仍在 Mock 模式',
        },
      };
    }

    return ApiClient.post<{ id: string; page: string }>('/ai/sessions', {
      page,
      context,
    });
  },

  list: async (): Promise<Result<AiSessionSummary[]>> => {
    if (USE_MOCK) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: 'Mock 模式不使用真实 AI 会话',
          displayMessage: '当前仍在 Mock 模式',
        },
      };
    }
    return ApiClient.get<AiSessionSummary[]>('/ai/sessions');
  },

  listRecentConversations: async (limit = 3): Promise<Result<AiRecentConversationItem[]>> => {
    if (USE_MOCK) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: 'Mock 模式不使用真实 AI 会话',
          displayMessage: '当前仍在 Mock 模式',
        },
      };
    }
    return ApiClient.get<AiRecentConversationItem[]>(`/ai/sessions/recent-conversations?limit=${limit}`);
  },

  get: async (sessionId: string): Promise<Result<AiSessionDetail>> => {
    if (USE_MOCK) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: 'Mock 模式不使用真实 AI 会话',
          displayMessage: '当前仍在 Mock 模式',
        },
      };
    }
    return ApiClient.get<AiSessionDetail>(`/ai/sessions/${sessionId}`);
  },

  sendMessage: async (
    sessionId: string,
    transcript: string,
  ): Promise<Result<AiSessionUtterance>> => {
    if (USE_MOCK) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN',
          message: 'Mock 模式不使用真实 AI 会话',
          displayMessage: '当前仍在 Mock 模式',
        },
      };
    }
    return ApiClient.post<AiSessionUtterance>(`/ai/sessions/${sessionId}/messages`, {
      transcript,
    });
  },

  /** 将首页一问一答写入 session（不调 Qwen），确保后续多轮有历史上下文 */
  seedMessage: async (
    sessionId: string,
    transcript: string,
    reply: string,
  ): Promise<Result<{ seeded: boolean }>> => {
    if (USE_MOCK) {
      return { ok: true, data: { seeded: true } };
    }
    return ApiClient.post<{ seeded: boolean }>(`/ai/sessions/${sessionId}/seed`, {
      transcript,
      reply,
    });
  },

  toMessages: mapSessionMessages,
};
