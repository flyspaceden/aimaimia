// 考察团仓库：详情/列表/参团接口占位（需后端对接）
import type { Result, PagedResult } from '../types';
import { mockPage } from './mock';

export type GroupStatus = 'forming' | 'inviting' | 'confirmed' | 'paid' | 'completed';

export type Group = {
  id: string;
  companyId: string;
  title: string;
  destination: string;
  memberCount: number;
  targetSize: number;
  deadline: string;
  status: GroupStatus;
};

const groups: Group[] = [
  {
    id: 'e3',
    companyId: 'c1',
    title: '品牌开放日考察团',
    destination: '青禾有机农场',
    memberCount: 18,
    targetSize: 30,
    deadline: '2024-12-12',
    status: 'forming',
  },
  {
    id: 'e5',
    companyId: 'c1',
    title: '秋冬专题考察团',
    destination: '青禾有机农场',
    memberCount: 26,
    targetSize: 30,
    deadline: '2024-12-18',
    status: 'inviting',
  },
  {
    id: 'e7',
    companyId: 'c2',
    title: '果园溯源探访团',
    destination: '山谷果园',
    memberCount: 12,
    targetSize: 40,
    deadline: '2024-12-20',
    status: 'forming',
  },
];

export const GroupRepo = {
  // 考察团列表：后端需支持按 companyId 分页查询
  list: async (params: {
    page: number;
    pageSize: number;
    companyId?: string;
  }): Promise<Result<PagedResult<Group>>> => {
    const filtered = params.companyId ? groups.filter((item) => item.companyId === params.companyId) : groups;
    return mockPage(filtered, params.page, params.pageSize);
  },

  // 考察团详情：后端返回单个考察团信息
  getById: async (groupId: string): Promise<Result<Group>> => {
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '未找到考察团' } };
    }
    return { ok: true, data: group };
  },

  // 参团入口：后端需创建参团记录并返回订单/支付信息
  join: async (payload: { groupId: string; headcount: number }): Promise<Result<{ ok: true }>> => {
    if (!payload.groupId || payload.headcount <= 0) {
      return { ok: false, error: { code: 'INVALID', message: '参团信息不完整' } };
    }
    return { ok: true, data: { ok: true } };
  },
};
