import client from './client';
import type { RuleConfig, ConfigVersion, PaginatedData, PaginationParams } from '@/types';

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

/** 配置版本历史 */
export const getConfigVersions = (params?: PaginationParams): Promise<PaginatedData<ConfigVersion>> =>
  client.get('/admin/config/versions', { params });

/** 版本详情 */
export const getConfigVersion = (id: string): Promise<ConfigVersion> =>
  client.get(`/admin/config/versions/${id}`);

/** 回滚到指定版本 */
export const rollbackConfigVersion = (id: string): Promise<RuleConfig> =>
  client.post(`/admin/config/versions/${id}/rollback`);
