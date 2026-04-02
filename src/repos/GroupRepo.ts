/**
 * 考察团仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：使用 `src/mocks/groups.ts` 模拟"组团创建/参团/状态流转"
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 * - `GET /api/v1/groups` → `Result<Group[]>`
 * - `GET /api/v1/groups/company/{companyId}` → `Result<Group[]>`
 * - `GET /api/v1/groups/{id}` → `Result<Group | undefined>`
 * - `POST /api/v1/groups` → `Result<Group>`
 * - `PATCH /api/v1/groups/{id}/status` → `Result<Group>`
 * - `POST /api/v1/groups/{id}/join` → `Result<Group>`
 */
import { mockGroups } from '../mocks';
import { Group, GroupStatus, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

type GroupCreateInput = {
  companyId: string;
  title: string;
  destination: string;
  targetSize: number;
  deadline: string;
};

// 考察团仓储：管理组团状态与成员数
export const GroupRepo = {
  // 获取全部考察团
  /** `GET /api/v1/groups` */
  list: async (): Promise<Result<Group[]>> => {
    if (USE_MOCK) {
      return simulateRequest([...mockGroups]);
    }

    return ApiClient.get<Group[]>('/groups');
  },
  // 获取企业考察团
  /** `GET /api/v1/groups/company/{companyId}` */
  listByCompany: async (companyId: string): Promise<Result<Group[]>> => {
    if (USE_MOCK) {
      return simulateRequest(mockGroups.filter((item) => item.companyId === companyId));
    }

    return ApiClient.get<Group[]>(`/groups/company/${companyId}`);
  },
  // 获取考察团详情
  /** `GET /api/v1/groups/{id}` */
  getById: async (id: string): Promise<Result<Group | undefined>> => {
    if (USE_MOCK) {
      return simulateRequest(mockGroups.find((item) => item.id === id));
    }

    return ApiClient.get<Group | undefined>(`/groups/${id}`);
  },
  // 创建考察团（自动/手动）
  /**
   * 创建考察团
   * - 后端接口：`POST /api/v1/groups`
   * - body：`{ companyId, title, destination, targetSize, deadline }`
   */
  create: async (payload: GroupCreateInput): Promise<Result<Group>> => {
    if (USE_MOCK) {
      const group: Group = {
        id: `g-${Date.now()}`,
        companyId: payload.companyId,
        title: payload.title,
        destination: payload.destination,
        targetSize: payload.targetSize,
        memberCount: 0,
        deadline: payload.deadline,
        status: 'forming',
        createdAt: new Date().toISOString(),
      };
      mockGroups.unshift(group);
      return simulateRequest(group, { delay: 300 });
    }

    return ApiClient.post<Group>('/groups', payload);
  },
  // 更新组团状态
  /**
   * 更新组团状态
   * - 后端接口：`PATCH /api/v1/groups/{id}/status`
   * - body：`{ status }`
   */
  updateStatus: async (id: string, status: GroupStatus): Promise<Result<Group>> => {
    if (USE_MOCK) {
      const target = mockGroups.find((item) => item.id === id);
      if (!target) {
        return err(createAppError('NOT_FOUND', `考察团不存在: ${id}`, '考察团不存在'));
      }
      target.status = status;
      return simulateRequest(target, { delay: 300 });
    }

    return ApiClient.patch<Group>(`/groups/${id}/status`, { status });
  },
  // 一键参团：增加人数并检查是否达到阈值
  /**
   * 一键参团
   * - 后端接口：`POST /api/v1/groups/{id}/join`
   * - body：`{ count?: number }`
   */
  join: async (id: string, count = 1): Promise<Result<Group>> => {
    if (USE_MOCK) {
      const target = mockGroups.find((item) => item.id === id);
      if (!target) {
        return err(createAppError('NOT_FOUND', `考察团不存在: ${id}`, '考察团不存在'));
      }
      target.memberCount += Math.max(1, count);
      if (target.memberCount >= target.targetSize && target.status === 'forming') {
        target.status = 'inviting';
      }
      return simulateRequest(target, { delay: 300 });
    }

    return ApiClient.post<Group>(`/groups/${id}/join`, { count });
  },
};
