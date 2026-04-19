import client from './client';
import type { LoginResponse, SelectCompanyResponse, SellerProfile } from '@/types';

/** 获取图形验证码 */
export const getCaptcha = (): Promise<{ captchaId: string; svg: string }> =>
  client.get('/seller/auth/captcha');

/** 发送验证码（方案 A：无图形码，靠后端速率限制保护） */
export const sendSmsCode = (
  phone: string,
): Promise<{ ok: boolean }> =>
  client.post('/seller/auth/sms/code', { phone });

/** 手机号 + 验证码登录 */
export const login = (phone: string, code: string): Promise<LoginResponse | SelectCompanyResponse> =>
  client.post('/seller/auth/login', { phone, code });

/** 手机号 + 密码登录（需通过图形验证码校验） */
export const loginByPassword = (
  phone: string,
  password: string,
  captchaId: string,
  captchaCode: string,
): Promise<LoginResponse | SelectCompanyResponse> =>
  client.post('/seller/auth/login-by-password', { phone, password, captchaId, captchaCode });

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

// ===================== C40c7 账号安全 =====================

/** 修改密码（仅当前 staff 的 passwordHash） */
export const changePassword = (data: {
  oldPassword: string;
  newPassword: string;
}): Promise<{ ok: boolean }> =>
  client.post('/seller/auth/change-password', data);

/** 给新手机号发绑定验证码（已登录态） */
export const sendBindPhoneSmsCode = (
  phone: string,
): Promise<{ ok: boolean; message?: string }> =>
  client.post('/seller/auth/bind-phone/sms/code', { phone });

/** 修改手机号（双重 SMS 验证，影响 User 名下所有企业 staff） */
export const changePhone = (data: {
  oldPhoneCode: string;
  newPhone: string;
  newPhoneCode: string;
}): Promise<{ ok: boolean }> =>
  client.post('/seller/auth/change-phone', data);
