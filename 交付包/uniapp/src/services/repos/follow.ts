// 关注仓库：关注列表占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type FollowItem = {
  id: string;
  name: string;
  meta: string;
  type: 'user' | 'company';
  author?: {
    id: string;
    name: string;
    avatar?: string;
    city?: string;
    title?: string;
    tags?: string[];
    type: 'user' | 'company';
    companyId?: string;
  };
};

const items: FollowItem[] = [
  {
    id: 'u1',
    name: '江晴',
    meta: '杭州 · 爱买买圈创作者',
    type: 'user',
    author: { id: 'u1', name: '江晴', city: '杭州', title: '爱买买圈创作者', tags: ['轻食', '阳台种植'], type: 'user' },
  },
  {
    id: 'u2',
    name: '小麦',
    meta: '苏州 · 健康饮食爱好者',
    type: 'user',
    author: { id: 'u2', name: '小麦', city: '苏州', title: '健康饮食爱好者', tags: ['有机偏好'], type: 'user' },
  },
  {
    id: 'c1',
    name: '青禾农场',
    meta: '昆明 · 有机蔬菜供应商',
    type: 'company',
    author: { id: 'c1', name: '青禾农场', city: '昆明', title: '有机蔬菜供应商', type: 'company', companyId: 'c1' },
  },
  {
    id: 'c2',
    name: '山谷果园',
    meta: '昆明 · 高山水果',
    type: 'company',
    author: { id: 'c2', name: '山谷果园', city: '昆明', title: '高山水果', type: 'company', companyId: 'c2' },
  },
];

export const FollowRepo = {
  list: async (params: { page: number; pageSize: number; type: 'user' | 'company' }): Promise<Result<PagedResult<FollowItem>>> => {
    const filtered = items.filter((item) => item.type === params.type);
    return mockPage(filtered, params.page, params.pageSize);
  },

  // 关注/取关占位：后端需变更关注状态并返回结果
  toggleFollow: async (authorId: string): Promise<Result<{ ok: true }>> => {
    if (!authorId) {
      return { ok: false, error: { code: 'INVALID', message: '缺少关注对象' } };
    }
    return { ok: true, data: { ok: true } };
  },
};
