import client from './client';
import type {
  CaptainSeafoodConfig,
  ConfigVersion,
  PaginatedData,
  PaginationParams,
  ProfitSafetySummary,
  RuleConfig,
} from '@/types';

/** 所有配置 */
export const getConfigs = (): Promise<RuleConfig[]> =>
  client.get('/admin/config');

/** 单个配置 */
export const getConfig = (key: string): Promise<RuleConfig> =>
  client.get(`/admin/config/${key}`);

/** 更新配置 */
export const updateConfig = (key: string, data: {
  value: unknown;
  changeNote?: string;
}): Promise<RuleConfig> =>
  client.put(`/admin/config/${key}`, data);

/**
 * 批量更新配置（原子事务 + 最终态校验）
 * 用于同时调整多个比例类配置（如 VIP/普通用户六分比例），避免串行提交触发
 * 中间态校验失败（"总和为 0.99"）。
 */
export const batchUpdateConfig = (data: {
  updates: Array<{ key: string; value: unknown }>;
  changeNote?: string;
}): Promise<{ ok: boolean; version: string; updated: number }> =>
  client.put('/admin/config/batch', data);

/** 当前配置在全部买家/邀请人组合下的服务器利润安全状态 */
export const getProfitSafetySummary = (): Promise<ProfitSafetySummary> =>
  client.get('/admin/config/profit-safety-summary');

/** 保存前预检规则配置或团长 V3 配置 */
export const previewProfitSafety = (data: {
  updates?: Array<{ key: string; value: unknown }>;
  ruleUpdates?: Record<string, unknown>;
  captainConfig?: CaptainSeafoodConfig;
}): Promise<ProfitSafetySummary> =>
  client.post('/admin/config/profit-safety-preview', data);

/** 配置版本历史 */
export const getConfigVersions = (params?: PaginationParams): Promise<PaginatedData<ConfigVersion>> =>
  client.get('/admin/config/versions', { params });

/** 版本详情 */
export const getConfigVersion = (id: string): Promise<ConfigVersion> =>
  client.get(`/admin/config/versions/${id}`);

/** 回滚到指定版本 */
export const rollbackConfigVersion = (id: string): Promise<RuleConfig> =>
  client.post(`/admin/config/versions/${id}/rollback`);
