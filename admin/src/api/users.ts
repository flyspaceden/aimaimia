import client from './client';
import type { AdminUser, PaginatedData, PaginationParams } from '@/types';

/** 管理员列表 */
export const getAdminUsers = (params?: PaginationParams): Promise<PaginatedData<AdminUser>> =>
  client.get('/admin/users', { params });

/** 管理员详情 */
export const getAdminUser = (id: string): Promise<AdminUser> =>
  client.get(`/admin/users/${id}`);

/** 创建管理员 */
export const createAdminUser = (data: {
  username: string;
  password: string;
  realName?: string;
  phone?: string;
  roleIds?: string[];
}): Promise<AdminUser> =>
  client.post('/admin/users', data);

/** 更新管理员 */
export const updateAdminUser = (id: string, data: {
  realName?: string;
  phone?: string;
  status?: 'ACTIVE' | 'DISABLED';
  roleIds?: string[];
}): Promise<AdminUser> =>
  client.put(`/admin/users/${id}`, data);

/** 重置密码 */
export const resetPassword = (id: string, newPassword: string): Promise<void> =>
  client.post(`/admin/users/${id}/reset-password`, { newPassword });

/** 删除管理员 */
export const deleteAdminUser = (id: string): Promise<void> =>
  client.delete(`/admin/users/${id}`);
