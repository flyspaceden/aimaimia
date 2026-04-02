/**
 * 消息中心仓储（Repo）
 *
 * 作用：
 * - 承接所有站内消息：咨询/打赏/合作、点赞/评论/@、订单/预约/成团等系统通知
 * - 支持：分类筛选、仅看未读、单条已读、全部已读、未读角标
 *
 * 后端接入说明：
 * - 建议接口见：`说明文档/后端接口清单.md#55-消息中心`
 * - 关键点：
 *   - 消息应与用户绑定（鉴权 token）
 *   - `unread` 状态需支持幂等更新
 */
import { mockInboxMessages } from '../mocks';
import { InboxCategory, InboxMessage, Result } from '../types';
import { simulateRequest } from './helpers';

let messageCache = [...mockInboxMessages];

// 消息中心仓储：消息列表与已读状态（复杂业务逻辑需中文注释）
export const InboxRepo = {
  /**
   * 消息列表
   * - 后端建议：`GET /api/v1/inbox?category=&unreadOnly=`
   */
  list: async (category?: InboxCategory, unreadOnly?: boolean): Promise<Result<InboxMessage[]>> => {
    let list = [...messageCache];
    if (category) {
      list = list.filter((item) => item.category === category);
    }
    if (unreadOnly) {
      list = list.filter((item) => item.unread);
    }
    return simulateRequest(list, { delay: 220 });
  },
  /** 标记单条已读：`POST /api/v1/inbox/{id}/read` */
  markRead: async (id: string): Promise<Result<InboxMessage[]>> => {
    messageCache = messageCache.map((item) => (item.id === id ? { ...item, unread: false } : item));
    return simulateRequest(messageCache, { delay: 180 });
  },
  /** 全部已读：`POST /api/v1/inbox/read-all` */
  markAllRead: async (): Promise<Result<InboxMessage[]>> => {
    messageCache = messageCache.map((item) => ({ ...item, unread: false }));
    return simulateRequest(messageCache, { delay: 200 });
  },
  /** 未读数：`GET /api/v1/inbox/unread-count` */
  getUnreadCount: async (): Promise<Result<number>> => {
    const count = messageCache.filter((item) => item.unread).length;
    return simulateRequest(count, { delay: 160 });
  },
};
