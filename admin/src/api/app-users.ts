import client from './client';
import type { AppUser, AppUserDetail, AppUserStats, PaginatedData, PaginationParams } from '@/types';

interface AppUserQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
  tier?: string;
  startDate?: string;
  endDate?: string;
}

/** App 用户列表（买家） */
export const getAppUsers = (params?: AppUserQueryParams): Promise<PaginatedData<AppUser>> =>
  client.get('/admin/app-users', { params });

/** App 用户统计概览 */
export const getAppUserStats = (): Promise<AppUserStats> =>
  client.get('/admin/app-users/stats');

/** App 用户详情 */
export const getAppUser = (id: string): Promise<AppUserDetail> =>
  client.get(`/admin/app-users/${id}`);

/** 封禁/解封 App 用户 */
export const toggleAppUserBan = (id: string, status: 'ACTIVE' | 'BANNED', reason?: string): Promise<void> =>
  client.post(`/admin/app-users/${id}/toggle-ban`, { status, reason });
