import client from './client';
import type {
  LoginRequest,
  LoginResponse,
  LoginByPhoneCodeRequest,
  CaptchaResponse,
  AdminProfile,
} from '@/types';

/** 管理员登录（账号 + 密码 + 图形验证码） */
export const login = (data: LoginRequest): Promise<LoginResponse> =>
  client.post('/admin/auth/login', data);

/** 获取图形验证码 */
export const getCaptcha = (): Promise<CaptchaResponse> =>
  client.get('/admin/auth/captcha');

/** 发送手机短信验证码（管理员手机登录，方案 A：无图形码，靠后端速率限制保护） */
export const sendSmsCode = (
  phone: string,
): Promise<{ ok: boolean; message?: string }> =>
  client.post('/admin/auth/sms/code', { phone });

/** 管理员手机号 + 短信验证码登录 */
export const loginByPhoneCode = (
  data: LoginByPhoneCodeRequest,
): Promise<LoginResponse> =>
  client.post('/admin/auth/login-by-phone-code', data);

/** 刷新 token */
export const refreshToken = (refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> =>
  client.post('/admin/auth/refresh', { refreshToken });

/** 管理员登出 */
export const logout = (): Promise<void> =>
  client.post('/admin/auth/logout');

/** 获取当前管理员信息 */
export const getProfile = (): Promise<AdminProfile> =>
  client.get('/admin/auth/profile');

// ===================== C40c7 账号安全 =====================

/** 修改密码 */
export const changePassword = (data: {
  oldPassword: string;
  newPassword: string;
}): Promise<{ ok: boolean }> =>
  client.post('/admin/auth/change-password', data);

/** 给新手机号发绑定验证码（已登录态） */
export const sendBindPhoneSmsCode = (
  phone: string,
): Promise<{ ok: boolean; message?: string }> =>
  client.post('/admin/auth/bind-phone/sms/code', { phone });

/** 修改手机号（双重 SMS 验证） */
export const changePhone = (data: {
  oldPhoneCode: string;
  newPhone: string;
  newPhoneCode: string;
}): Promise<{ ok: boolean }> =>
  client.post('/admin/auth/change-phone', data);
