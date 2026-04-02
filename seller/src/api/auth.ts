import client from './client';
import type { LoginResponse, SelectCompanyResponse, SellerProfile } from '@/types';

/** 发送验证码 */
export const sendSmsCode = (phone: string): Promise<{ ok: boolean }> =>
  client.post('/seller/auth/sms/code', { phone });

/** 手机号 + 验证码登录 */
export const login = (phone: string, code: string): Promise<LoginResponse | SelectCompanyResponse> =>
  client.post('/seller/auth/login', { phone, code });

/** 多企业用户选择企业 */
export const selectCompany = (tempToken: string, companyId: string): Promise<LoginResponse> =>
  client.post('/seller/auth/select-company', { tempToken, companyId });

/** 刷新 Token */
export const refreshToken = (refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> =>
  client.post('/seller/auth/refresh', { refreshToken });

/** 登出 */
export const logout = (): Promise<void> =>
  client.post('/seller/auth/logout');

/** 获取当前卖家信息 */
export const getMe = (): Promise<SellerProfile> =>
  client.get('/seller/auth/me');
