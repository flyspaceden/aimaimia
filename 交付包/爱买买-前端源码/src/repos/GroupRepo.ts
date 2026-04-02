/**
 * 考察团仓储（Repo）
 *
 * 当前实现：
 * - 使用 `src/mocks/groups.ts` 模拟“组团创建/参团/状态流转”
 *
 * 后端接入说明：
 * - 组团阈值（默认 30）建议后端按企业可配置，并由后端统计预约池后自动触发/手动发起
 * - 建议接口见：`说明文档/后端接口清单.md#24-考察团group`
 */
import { mockGroups } from '../mocks';
import { Group, GroupStatus, Result, err } from '../types';
import { createAppError, simulateRequest } from './helpers';

type GroupCreateInput = {
  companyId: string;
  title: string;
  destination: string;
  targetSize: number;
  deadline: string;
};

// 考察团仓储：管理组团状态与成员数（Mock 数据）
export const GroupRepo = {
  // 获取全部考察团
  /** `GET /api/v1/groups` */
  list: async (): Promise<Result<Group[]>> => simulateRequest([...mockGroups]),
  // 获取企业考察团
  /** `GET /api/v1/companies/{companyId}/groups` */
  listByCompany: async (companyId: string): Promise<Result<Group[]>> =>
    simulateRequest(mockGroups.filter((item) => item.companyId === companyId)),
  // 获取考察团详情
  /** `GET /api/v1/groups/{id}` */
  getById: async (id: string): Promise<Result<Group | undefined>> =>
    simulateRequest(mockGroups.find((item) => item.id === id)),
  // 创建考察团（自动/手动）
  /**
   * 创建考察团
   * - 后端建议：`POST /api/v1/groups`
   * - body：`{ companyId, title, destination, targetSize, deadline }`
   */
  create: async (payload: GroupCreateInput): Promise<Result<Group>> => {
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
  },
  // 更新组团状态
  /**
   * 更新组团状态
   * - 后端建议：`PATCH /api/v1/groups/{id}/status`
   * - body：`{ status }`
   */
  updateStatus: async (id: string, status: GroupStatus): Promise<Result<Group>> => {
    const target = mockGroups.find((item) => item.id === id);
    if (!target) {
      return err(createAppError('NOT_FOUND', `考察团不存在: ${id}`, '考察团不存在'));
    }
    target.status = status;
    return simulateRequest(target, { delay: 300 });
  },
  // 一键参团：增加人数并检查是否达到阈值
  /**
   * 一键参团
   * - 后端建议：`POST /api/v1/groups/{id}/join`
   * - body：`{ count?: number }`
   */
  join: async (id: string, count = 1): Promise<Result<Group>> => {
    const target = mockGroups.find((item) => item.id === id);
    if (!target) {
      return err(createAppError('NOT_FOUND', `考察团不存在: ${id}`, '考察团不存在'));
    }
    target.memberCount += Math.max(1, count);
    if (target.memberCount >= target.targetSize && target.status === 'forming') {
      target.status = 'inviting';
    }
    return simulateRequest(target, { delay: 300 });
  },
};
