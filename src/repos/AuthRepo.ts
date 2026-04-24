/**
 * 认证仓储（Repo）
 *
 * 当前实现：
 * - USE_MOCK=true：前端占位模拟登录/注册/验证码请求
 * - USE_MOCK=false：调用后端 API
 *
 * 后端接口：
 *   - `POST /api/v1/auth/login`（手机号 + 验证码或密码）
 *   - `POST /api/v1/auth/register`（手机号 + 验证码）
 *   - `POST /api/v1/auth/sms/code`（发送短信验证码）
 *   - `POST /api/v1/auth/oauth/wechat`（微信授权登录/注册）
 *   - `POST /api/v1/auth/refresh`（刷新 Token）
 */
import { AuthSession, LoginMode, Result } from '../types';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { ApiClient } from './http/ApiClient';

const createSession = (): AuthSession => ({
  accessToken: `demo_token_${Date.now()}`,
  loginMethod: 'phone',
  userId: 'demo_user',
});

// 认证仓储：登录/注册/验证码发送
export const AuthRepo = {
  // 手机号登录
  loginWithPhone: async (payload: { phone: string; code?: string; password?: string; mode: LoginMode }): Promise<Result<AuthSession>> => {
    if (USE_MOCK) return simulateRequest({ ...createSession(), loginMethod: 'phone' }, { delay: 420 });
    return ApiClient.post<AuthSession>('/auth/login', payload);
  },
  // 手机号注册
  registerWithPhone: async (payload: { phone: string; code: string; name: string; password: string }): Promise<Result<AuthSession>> => {
    if (USE_MOCK) return simulateRequest({ ...createSession(), loginMethod: 'phone' }, { delay: 480 });
    return ApiClient.post<AuthSession>('/auth/register', payload);
  },
  // 发送短信验证码
  requestSmsCode: async (phone: string): Promise<Result<{ ok: boolean }>> => {
    if (USE_MOCK) return simulateRequest({ ok: true }, { delay: 300 });
    return ApiClient.post<{ ok: boolean }>('/auth/sms/code', { phone });
  },
  // 微信授权登录/注册（OAuth：用授权码换取 Session，后端自动创建账号）
  loginWithWeChat: async (code: string): Promise<Result<AuthSession>> => {
    if (USE_MOCK) return simulateRequest({ ...createSession(), loginMethod: 'wechat' }, { delay: 520 });
    return ApiClient.post<AuthSession>('/auth/oauth/wechat', { code });
  },
  // 刷新 Token
  refreshToken: async (refreshToken: string): Promise<Result<AuthSession>> => {
    if (USE_MOCK) return simulateRequest(createSession(), { delay: 300 });
    return ApiClient.post<AuthSession>('/auth/refresh', { refreshToken });
  },
  // 登出（撤销服务端 Session）
  logout: async (): Promise<Result<{ ok: boolean }>> => {
    if (USE_MOCK) return simulateRequest({ ok: true }, { delay: 200 });
    return ApiClient.post<{ ok: boolean }>('/auth/logout');
  },
  // 修改密码
  changePassword: async (payload: { oldPassword: string; newPassword: string }): Promise<Result<{ ok: boolean }>> => {
    if (USE_MOCK) return simulateRequest({ ok: true }, { delay: 400 });
    return ApiClient.post<{ ok: boolean }>('/auth/change-password', payload);
  },
  // 注销账号
  deleteAccount: async (): Promise<Result<{ ok: boolean }>> => {
    if (USE_MOCK) return simulateRequest({ ok: true }, { delay: 600 });
    return ApiClient.post<{ ok: boolean }>('/auth/delete-account');
  },
  // 获取图形验证码（用于忘记密码流程的 send-code 前置防刷）
  getCaptcha: async (): Promise<Result<{ captchaId: string; svg: string }>> => {
    if (USE_MOCK) {
      return simulateRequest(
        { captchaId: `mock_${Date.now()}`, svg: '<svg/>' },
        { delay: 200 },
      );
    }
    return ApiClient.get<{ captchaId: string; svg: string }>('/captcha');
  },
  // 忘记密码 - 发送短信验证码
  sendForgotPasswordCode: async (payload: {
    phone: string;
    captchaId: string;
    captchaCode: string;
  }): Promise<Result<{ success: boolean }>> => {
    if (USE_MOCK) return simulateRequest({ success: true }, { delay: 400 });
    return ApiClient.post<{ success: boolean }>('/auth/forgot-password/send-code', payload);
  },
  // 忘记密码 - 提交新密码
  resetForgotPassword: async (payload: {
    phone: string;
    code: string;
    newPassword: string;
  }): Promise<Result<{ success: boolean }>> => {
    if (USE_MOCK) return simulateRequest({ success: true }, { delay: 500 });
    return ApiClient.post<{ success: boolean }>('/auth/forgot-password/reset', payload);
  },
};
