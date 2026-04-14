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

/** 发送手机短信验证码（管理员手机登录，需先通过图形验证码） */
export const sendSmsCode = (
  phone: string,
  captchaId: string,
  captchaCode: string,
): Promise<{ ok: boolean; message?: string }> =>
  client.post('/admin/auth/sms/code', { phone, captchaId, captchaCode });

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
