// 搜索仓库：搜索结果占位
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type SearchItem = {
  id: string;
  title: string;
  meta: string;
  type: string;
};

const items: SearchItem[] = [
  { id: 'r1', title: '高山小番茄礼盒', meta: '商品 · ￥39.9', type: '商品' },
  { id: 'r2', title: '青禾有机农场', meta: '企业 · 杭州 · 有机', type: '企业' },
  { id: 'r3', title: '雨季育苗期注意事项', meta: '帖子 · 爱买买圈', type: '帖子' },
  { id: 'r4', title: '阳光草莓', meta: '商品 · ￥29.9', type: '商品' },
  { id: 'r5', title: '山谷果园', meta: '企业 · 昆明 · 绿色', type: '企业' },
];

export const SearchRepo = {
  list: async (params: { page: number; pageSize: number; keyword: string; type?: string }): Promise<Result<PagedResult<SearchItem>>> => {
    return mockPage(items, params.page, params.pageSize);
  },
};
