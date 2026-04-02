import client from './client';
import type { LoginRequest, LoginResponse, AdminProfile } from '@/types';

/** 管理员登录 */
export const login = (data: LoginRequest): Promise<LoginResponse> =>
  client.post('/admin/auth/login', data);

/** 刷新 token */
export const refreshToken = (refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> =>
  client.post('/admin/auth/refresh', { refreshToken });

/** 管理员登出 */
export const logout = (): Promise<void> =>
  client.post('/admin/auth/logout');

/** 获取当前管理员信息 */
export const getProfile = (): Promise<AdminProfile> =>
  client.get('/admin/auth/profile');
