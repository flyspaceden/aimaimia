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
 */
import { mockInboxMessages } from '../mocks';
import { InboxCategory, InboxMessage, Result } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

let messageCache = [...mockInboxMessages];

// 消息中心仓储：消息列表与已读状态（复杂业务逻辑需中文注释）
export const InboxRepo = {
  /**
   * 消息列表
   * - 后端接口：`GET /api/v1/inbox?category=&unreadOnly=`
   */
  list: async (category?: InboxCategory, unreadOnly?: boolean): Promise<Result<InboxMessage[]>> => {
    if (USE_MOCK) {
      let list = [...messageCache];
      if (category) {
        list = list.filter((item) => item.category === category);
      }
      if (unreadOnly) {
        list = list.filter((item) => item.unread);
      }
      return simulateRequest(list, { delay: 220 });
    }

    return ApiClient.get<InboxMessage[]>('/inbox', {
      category,
      unreadOnly: unreadOnly ? 'true' : undefined,
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
  /** 未读数：`GET /api/v1/inbox/unread-count` */
  getUnreadCount: async (): Promise<Result<number>> => {
    if (USE_MOCK) {
      const count = messageCache.filter((item) => item.unread).length;
      return simulateRequest(count, { delay: 160 });
    }

    return ApiClient.get<number>('/inbox/unread-count');
  },
};
