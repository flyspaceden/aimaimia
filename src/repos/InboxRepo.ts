/**
 * 消息中心仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/inbox.ts` 模拟消息数据
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 * - `GET /api/v1/inbox?category=&unreadOnly=` → `Result<InboxMessage[]>`
 * - `POST /api/v1/inbox/{id}/read` → `Result<InboxMessage[]>`
 * - `POST /api/v1/inbox/read-all` → `Result<InboxMessage[]>`
 * - `GET /api/v1/inbox/unread-count` → `Result<number>`
 *
 * 兼容性：
 * - 旧数据使用 `target.route`
 * - 新通知使用 `action.routeKey`，页面层统一解析，不在 Repo 层透传任意路由
 */
import { mockInboxMessages } from '../mocks';
import { InboxCategory, InboxMessage, Result } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

let messageCache = [...mockInboxMessages];
const deletedMessageCache = new Map<string, InboxMessage>();

type InboxListParams = {
  page?: number;
  pageSize?: number;
};

type InboxDeleteResult = {
  id?: string;
  deletedCount?: number;
  restoredCount?: number;
};

// 消息中心仓储：消息列表与已读状态（复杂业务逻辑需中文注释）
export const InboxRepo = {
  /**
   * 消息列表
   * - 后端接口：`GET /api/v1/inbox?category=&unreadOnly=`
   */
  list: async (
    category?: InboxCategory,
    unreadOnly?: boolean,
    params: InboxListParams = {},
  ): Promise<Result<InboxMessage[]>> => {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.max(1, params.pageSize ?? 20);

    if (USE_MOCK) {
      let list = [...messageCache];
      if (category) {
        list = list.filter((item) => item.category === category);
      }
      if (unreadOnly) {
        list = list.filter((item) => item.unread);
      }
      const start = (page - 1) * pageSize;
      return simulateRequest(list.slice(start, start + pageSize), { delay: 220 });
    }

    return ApiClient.get<InboxMessage[]>('/inbox', {
      category,
      unreadOnly: unreadOnly ? 'true' : undefined,
      page,
      pageSize,
    });
  },
  /** 标记单条已读：`POST /api/v1/inbox/{id}/read` */
  markRead: async (id: string): Promise<Result<InboxMessage[]>> => {
    if (USE_MOCK) {
      messageCache = messageCache.map((item) => (item.id === id ? { ...item, unread: false } : item));
      return simulateRequest(messageCache, { delay: 180 });
    }

    return ApiClient.post<InboxMessage[]>(`/inbox/${id}/read`);
  },
  /** 全部已读：`POST /api/v1/inbox/read-all` */
  markAllRead: async (): Promise<Result<InboxMessage[]>> => {
    if (USE_MOCK) {
      messageCache = messageCache.map((item) => ({ ...item, unread: false }));
      return simulateRequest(messageCache, { delay: 200 });
    }

    return ApiClient.post<InboxMessage[]>('/inbox/read-all');
  },
  /** 删除单条消息：后端软删除，仅影响当前买家。 */
  deleteMessage: async (id: string): Promise<Result<InboxDeleteResult>> => {
    if (USE_MOCK) {
      const message = messageCache.find((item) => item.id === id);
      if (!message) {
        return {
          ok: false,
          error: { code: 'NOT_FOUND', message: '消息不存在', displayMessage: '消息不存在', retryable: false },
        };
      }
      deletedMessageCache.set(id, message);
      messageCache = messageCache.filter((item) => item.id !== id);
      return simulateRequest({ id, deletedCount: 1 }, { delay: 160 });
    }

    return ApiClient.delete<InboxDeleteResult>(`/inbox/${id}`);
  },
  /** 恢复刚删除的单条消息。 */
  restoreMessage: async (id: string): Promise<Result<InboxDeleteResult>> => {
    if (USE_MOCK) {
      const message = deletedMessageCache.get(id);
      if (!message) {
        return {
          ok: false,
          error: { code: 'NOT_FOUND', message: '消息无法恢复', displayMessage: '消息无法恢复', retryable: false },
        };
      }
      messageCache = [message, ...messageCache];
      deletedMessageCache.delete(id);
      return simulateRequest({ id, restoredCount: 1 }, { delay: 160 });
    }

    return ApiClient.post<InboxDeleteResult>(`/inbox/${id}/restore`);
  },
  /** 清空已读消息，保留未读消息。 */
  deleteReadMessages: async (): Promise<Result<InboxDeleteResult>> => {
    if (USE_MOCK) {
      const readMessages = messageCache.filter((item) => !item.unread);
      readMessages.forEach((message) => deletedMessageCache.set(message.id, message));
      messageCache = messageCache.filter((item) => item.unread);
      return simulateRequest({ deletedCount: readMessages.length }, { delay: 200 });
    }

    return ApiClient.delete<InboxDeleteResult>('/inbox/read');
  },
  /** 清空当前买家的全部消息。 */
  deleteAllMessages: async (): Promise<Result<InboxDeleteResult>> => {
    if (USE_MOCK) {
      const deletedCount = messageCache.length;
      messageCache.forEach((message) => deletedMessageCache.set(message.id, message));
      messageCache = [];
      return simulateRequest({ deletedCount }, { delay: 220 });
    }

    return ApiClient.delete<InboxDeleteResult>('/inbox/all');
  },
  /** 未读数：`GET /api/v1/inbox/unread-count` */
  getUnreadCount: async (): Promise<Result<number>> => {
    if (USE_MOCK) {
      const count = messageCache.filter((item) => item.unread).length;
      return simulateRequest(count, { delay: 160 });
    }

    return ApiClient.get<number>('/inbox/unread-count');
  },
};
