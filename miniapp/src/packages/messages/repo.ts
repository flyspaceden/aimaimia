import { ApiClient } from '@/api/client';
import type { Result } from '@/types/result';
import type { InboxCategory, InboxDeleteResult, InboxMessage } from './types';

export const MessageRepo = {
  list: (
    category?: InboxCategory,
    unreadOnly = false,
    page = 1,
    pageSize = 20,
  ): Promise<Result<InboxMessage[]>> => ApiClient.get<InboxMessage[]>('/inbox', {
    category,
    unreadOnly: unreadOnly ? 'true' : undefined,
    page,
    pageSize,
  }),
  get: (id: string): Promise<Result<InboxMessage>> => ApiClient.get<InboxMessage>(`/inbox/${encodeURIComponent(id)}`),
  getUnreadCount: (): Promise<Result<number>> => ApiClient.get<number>('/inbox/unread-count'),
  markRead: (id: string): Promise<Result<InboxMessage[]>> => ApiClient.post<InboxMessage[]>(`/inbox/${encodeURIComponent(id)}/read`),
  markAllRead: (): Promise<Result<InboxMessage[]>> => ApiClient.post<InboxMessage[]>('/inbox/read-all'),
  delete: (id: string): Promise<Result<InboxDeleteResult>> => ApiClient.delete<InboxDeleteResult>(`/inbox/${encodeURIComponent(id)}`),
  restore: (id: string): Promise<Result<InboxDeleteResult>> => ApiClient.post<InboxDeleteResult>(`/inbox/${encodeURIComponent(id)}/restore`),
  deleteRead: (): Promise<Result<InboxDeleteResult>> => ApiClient.delete<InboxDeleteResult>('/inbox/read'),
  deleteAll: (): Promise<Result<InboxDeleteResult>> => ApiClient.delete<InboxDeleteResult>('/inbox/all'),
};
