import client from './client';

/** 获取图形验证码（卖家专属路由） */
export const getCaptcha = (): Promise<{ captchaId: string; svg: string }> =>
  client.get('/seller/auth/captcha');

/** 步骤 1：发送重置验证码 */
export const sendForgotPasswordCode = (data: {
  phone: string;
  captchaId: string;
  captchaCode: string;
}): Promise<{ success: boolean }> =>
  client.post('/seller/auth/forgot-password/send-code', data);

/** 步骤 2：以短信验证码换取可重置的企业列表（OTP 只读验证，不消费） */
export const listCompaniesForReset = (data: {
  phone: string;
  code: string;
}): Promise<{
  success: boolean;
  companies: Array<{
    staffId: string;
    companyId: string;
    companyName: string;
    role: string;
  }>;
}> => client.post('/seller/auth/forgot-password/list-companies', data);

/** 步骤 3：提交新密码（CAS 消费 OTP + 更新指定 staff 密码） */
export const resetForgotPassword = (data: {
  phone: string;
  code: string;
  staffId: string;
  newPassword: string;
}): Promise<{ success: boolean; companyName: string }> =>
  client.post('/seller/auth/forgot-password/reset', data);
