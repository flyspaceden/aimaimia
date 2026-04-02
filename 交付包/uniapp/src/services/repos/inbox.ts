// 消息中心仓库：消息列表/已读占位
import type { Result, PagedResult } from '../types';
import type { InteractionAction } from '../constants/interaction';
import { mockPage } from './mock';

export type InboxItem = {
  id: string;
  title: string;
  desc: string;
  time: string;
  unread: boolean;
  type: '互动' | '交易' | '系统';
  status?: string;
  actionType?: InteractionAction;
};

const STORAGE_KEY = 'nm_inbox_items_v1';

const seedItems: InboxItem[] = [
  { id: 'm1', title: '咨询回复', desc: '专家已回复你的提问', time: '刚刚', unread: true, type: '互动', status: '已回复', actionType: 'expert' },
  { id: 'm2', title: '订单更新', desc: '订单已发货', time: '10:30', unread: false, type: '交易', status: '运输中', actionType: 'system' },
  { id: 'm3', title: '成团通知', desc: '你参与的考察团已成团', time: '昨天', unread: false, type: '系统', status: '已通知', actionType: 'group' },
  { id: 'm4', title: '点赞提醒', desc: '有人点赞了你的帖子', time: '周一', unread: true, type: '互动', actionType: 'like' },
];

const readStored = (): InboxItem[] => {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed as InboxItem[];
  } catch {
    return [];
  }
};

const writeStored = (items: InboxItem[]) => {
  uni.setStorageSync(STORAGE_KEY, JSON.stringify(items));
};

export const InboxRepo = {
  list: async (params: { page: number; pageSize: number; type?: string; unreadOnly?: boolean; keyword?: string }): Promise<Result<PagedResult<InboxItem>>> => {
    let items = readStored().concat(seedItems);
    if (params.type && params.type !== '全部') {
      items = items.filter((item) => item.type === params.type);
    }
    if (params.unreadOnly) {
      items = items.filter((item) => item.unread);
    }
    if (params.keyword) {
      const key = params.keyword.trim();
      if (key) {
        items = items.filter((item) => item.title.includes(key) || item.desc.includes(key));
      }
    }
    return mockPage(items, params.page, params.pageSize);
  },

  push: async (payload: Omit<InboxItem, 'id' | 'time' | 'unread'> & { time?: string }): Promise<Result<{ id: string }>> => {
    const items = readStored();
    const id = `m-${Date.now()}`;
    const record: InboxItem = {
      id,
      title: payload.title,
      desc: payload.desc,
      time: payload.time || '刚刚',
      unread: true,
      type: payload.type,
      status: payload.status,
      actionType: payload.actionType,
    };
    items.unshift(record);
    writeStored(items);
    return { ok: true, data: { id } };
  },

  markRead: async (id: string): Promise<Result<{ ok: true }>> => {
    const items = readStored();
    const target = items.find((item) => item.id === id);
    if (target) target.unread = false;
    writeStored(items);
    return { ok: true, data: { ok: true } };
  },

  markAllRead: async (): Promise<Result<{ ok: true }>> => {
    const items = readStored().map((item) => ({ ...item, unread: false }));
    writeStored(items);
    return { ok: true, data: { ok: true } };
  },

  getById: async (id: string): Promise<Result<InboxItem | null>> => {
    const items = readStored().concat(seedItems);
    const found = items.find((item) => item.id === id) || null;
    return { ok: true, data: found };
  },

  // 汇总统计占位：用于消息中心快捷筛选与未读统计
  summary: async (): Promise<Result<{ total: number; unread: number; byType: Record<string, number> }>> => {
    const items = readStored().concat(seedItems);
    const byType: Record<string, number> = {};
    let unread = 0;
    items.forEach((item) => {
      byType[item.type] = (byType[item.type] || 0) + 1;
      if (item.unread) unread += 1;
    });
    return { ok: true, data: { total: items.length, unread, byType } };
  },
};
