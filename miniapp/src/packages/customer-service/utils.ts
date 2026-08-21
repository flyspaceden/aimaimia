import type { Result } from '@/types/result';
import type { CsMessage, CsSessionListResult, CsSessionSource, CsSessionStatus, CsSessionSummary } from './types';

const CS_MESSAGE_SENDERS = new Set(['USER', 'AI', 'AGENT', 'SYSTEM']);
const CS_CONTENT_TYPES = new Set(['TEXT', 'RICH_CARD', 'ACTION_CONFIRM', 'ACTION_RESULT', 'IMAGE']);

export const CS_SOURCE_LABEL: Record<CsSessionSource, string> = {
  MY_PAGE: '我的咨询',
  ORDER_DETAIL: '订单咨询',
  AFTERSALE_DETAIL: '售后咨询',
  ADMIN_OUTREACH: '平台客服',
};

export const CS_STATUS_LABEL: Record<CsSessionStatus, string> = {
  AI_HANDLING: 'AI 接待中',
  QUEUING: '等待人工客服',
  AGENT_HANDLING: '客服处理中',
  CLOSED: '已结束',
};

export function formatCsTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function sortCsMessages(messages: CsMessage[]): CsMessage[] {
  return [...messages].sort((left, right) => {
    const delta = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return delta || left.id.localeCompare(right.id);
  });
}

function hasServerCounterpart(local: CsMessage, serverMessages: CsMessage[]): boolean {
  if (local._status !== 'sending' && local._status !== 'failed') return false;
  return serverMessages.some((server) => server.senderType === 'USER'
    && server.content === local.content
    && Math.abs(Date.parse(server.createdAt) - Date.parse(local.createdAt)) < 15_000);
}

export function mergeCsMessages(previous: CsMessage[], incoming: CsMessage[]): CsMessage[] {
  const merged = new Map<string, CsMessage>();
  incoming.forEach((message) => merged.set(message.id, message));
  previous.forEach((message) => {
    if (!merged.has(message.id) && !hasServerCounterpart(message, incoming)) merged.set(message.id, message);
  });
  return sortCsMessages([...merged.values()]);
}

export function nextCsSessionPage(last: Result<CsSessionListResult>): number | undefined {
  if (!last.ok || last.data.pageSize <= 0) return undefined;
  return last.data.items.length >= last.data.pageSize ? last.data.page + 1 : undefined;
}

export function mergeCsSessionPages(pages: Array<Result<CsSessionListResult>>): CsSessionSummary[] {
  const unique = new Map<string, CsSessionSummary>();
  pages.forEach((page) => {
    if (!page.ok) return;
    page.data.items.forEach((session) => {
      if (!unique.has(session.id)) unique.set(session.id, session);
    });
  });
  return [...unique.values()];
}

export function normalizeCsMessage(value: unknown, sessionId: string): CsMessage | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId !== sessionId) return null;
  if (typeof candidate.senderType !== 'string' || !CS_MESSAGE_SENDERS.has(candidate.senderType)) return null;
  if (candidate.senderId !== undefined && candidate.senderId !== null && typeof candidate.senderId !== 'string') return null;
  if (typeof candidate.content !== 'string' || !candidate.content.trim()) return null;
  const contentType = candidate.contentType ?? 'TEXT';
  if (typeof contentType !== 'string' || !CS_CONTENT_TYPES.has(contentType)) return null;
  if (typeof candidate.createdAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt))) return null;
  if (candidate.metadata !== undefined
    && candidate.metadata !== null
    && (typeof candidate.metadata !== 'object' || Array.isArray(candidate.metadata))) {
    return null;
  }
  return {
    id: candidate.id,
    sessionId,
    senderType: candidate.senderType as CsMessage['senderType'],
    senderId: typeof candidate.senderId === 'string' ? candidate.senderId : undefined,
    contentType: contentType as CsMessage['contentType'],
    content: candidate.content,
    metadata: candidate.metadata && typeof candidate.metadata === 'object'
      ? candidate.metadata as Record<string, unknown>
      : undefined,
    createdAt: candidate.createdAt,
  };
}

export const normalizeSocketMessage = normalizeCsMessage;
