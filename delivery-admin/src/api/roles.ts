import client from './client';
import type { AdminRole, AdminPermission } from '@/types';

/** 角色列表 */
export const getRoles = (): Promise<AdminRole[]> =>
  client.get('/delivery-admin/roles');

/** 角色详情 */
export const getRole = (id: string): Promise<AdminRole> =>
  client.get(`/delivery-admin/roles/${id}`);

/** 所有可用权限 */
export const getPermissions = (): Promise<AdminPermission[]> =>
  client.get('/delivery-admin/roles/permissions');

/** 创建角色 */
export const createRole = (data: {
  name: string;
  description?: string;
  permissionIds?: string[];
}): Promise<AdminRole> =>
  client.post('/delivery-admin/roles', data);

/** 更新角色 */
export const updateRole = (id: string, data: {
  name?: string;
  description?: string;
  permissionIds?: string[];
}): Promise<AdminRole> =>
  client.put(`/delivery-admin/roles/${id}`, data);

/** 删除角色 */
export const deleteRole = (id: string): Promise<void> =>
  client.delete(`/delivery-admin/roles/${id}`);
