import { ApiClient } from '@/api/client';
import type { Result } from '@/types/result';
import type {
  CsMessage,
  CsQuickEntry,
  CsSendMessageResult,
  CsSessionDetail,
  CsSessionInfo,
  CsSessionListResult,
  CsSessionScope,
  CsSessionSource,
} from './types';
import { normalizeCsMessage } from './utils';

export const CUSTOMER_SERVICE_SOURCES: CsSessionSource[] = [
  'MY_PAGE',
  'ORDER_DETAIL',
  'AFTERSALE_DETAIL',
];

function invalidMessageResponse<T>(): Result<T> {
  return {
    ok: false,
    error: {
      code: 'INVALID_RESPONSE',
      message: 'Invalid customer service message response',
      displayMessage: '客服消息数据异常，请稍后重试',
      retryable: true,
    },
  };
}

async function getMessages(sessionId: string): Promise<Result<CsMessage[]>> {
  const result = await ApiClient.get<unknown>(`/cs/sessions/${encodeURIComponent(sessionId)}/messages`);
  if (!result.ok) return result;
  if (!Array.isArray(result.data)) return invalidMessageResponse();
  const messages = result.data.map((value) => normalizeCsMessage(value, sessionId));
  if (messages.some((message) => message === null)) return invalidMessageResponse();
  return { ok: true, data: messages as CsMessage[] };
}

async function sendMessage(sessionId: string, content: string): Promise<Result<CsSendMessageResult>> {
  const result = await ApiClient.post<unknown>(`/cs/sessions/${encodeURIComponent(sessionId)}/messages`, {
    content,
    contentType: 'TEXT',
  });
  if (!result.ok) return result;
  if (!result.data || typeof result.data !== 'object') return invalidMessageResponse();
  const candidate = result.data as Record<string, unknown>;
  const userMessage = normalizeCsMessage(candidate.userMessage, sessionId);
  const aiReply = candidate.aiReply === null ? null : normalizeCsMessage(candidate.aiReply, sessionId);
  if (!userMessage || (candidate.aiReply !== null && !aiReply) || typeof candidate.transferred !== 'boolean') {
    return invalidMessageResponse();
  }
  return {
    ok: true,
    data: { userMessage, aiReply, transferred: candidate.transferred },
  };
}

export function normalizeCsSource(value?: string): CsSessionSource {
  return CUSTOMER_SERVICE_SOURCES.includes(value as CsSessionSource)
    ? value as CsSessionSource
    : 'MY_PAGE';
}

export const CustomerServiceRepo = {
  listSessions: (scope: CsSessionScope, page = 1, pageSize = 30): Promise<Result<CsSessionListResult>> =>
    ApiClient.get<CsSessionListResult>('/cs/sessions', { scope, page, pageSize }),
  getSession: (sessionId: string): Promise<Result<CsSessionDetail>> =>
    ApiClient.get<CsSessionDetail>(`/cs/sessions/${encodeURIComponent(sessionId)}`),
  createSession: (source: CsSessionSource, sourceId?: string): Promise<Result<CsSessionInfo>> =>
    ApiClient.post<CsSessionInfo>('/cs/sessions', { source, sourceId: sourceId || undefined }),
  getMessages,
  markRead: (sessionId: string): Promise<Result<{ id: string; buyerLastReadAt: string }>> =>
    ApiClient.post<{ id: string; buyerLastReadAt: string }>(`/cs/sessions/${encodeURIComponent(sessionId)}/read`),
  sendMessage,
  closeSession: (sessionId: string): Promise<Result<{ ok: boolean }>> =>
    ApiClient.post<{ ok: boolean }>(`/cs/sessions/${encodeURIComponent(sessionId)}/close`),
  submitRating: (
    sessionId: string,
    input: { score: number; tags?: string[]; comment?: string },
  ): Promise<Result<{ id: string; alreadyRated: boolean }>> =>
    ApiClient.post<{ id: string; alreadyRated: boolean }>(`/cs/sessions/${encodeURIComponent(sessionId)}/rating`, input),
  getQuickEntries: (): Promise<Result<CsQuickEntry[]>> =>
    ApiClient.get<CsQuickEntry[]>('/cs/quick-entries'),
};
