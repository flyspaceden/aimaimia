/**
 * 认证仓储（Repo）
 *
 * 当前实现：
 * - 前端占位：模拟登录/注册/验证码请求
 *
 * 后端接入说明：
 * - 建议接口：
 *   - `POST /api/v1/auth/login`（手机号/邮箱 + 验证码或密码）
 *   - `POST /api/v1/auth/register`（手机号/邮箱 + 验证码或密码）
 *   - `POST /api/v1/auth/sms/code`（发送短信验证码）
 *   - `POST /api/v1/auth/email/code`（发送邮箱验证码）
 *   - `POST /api/v1/auth/oauth/wechat`（微信登录）
 *   - `POST /api/v1/auth/oauth/apple`（Apple 登录）
 *
 * 详细接口清单：`说明文档/后端接口清单.md#04-认证Auth`
 */
import { AuthSession, LoginMethod, LoginMode, Result } from '../types';
import { simulateRequest } from './helpers';

const createSession = (loginMethod: LoginMethod): AuthSession => ({
  accessToken: `demo_${loginMethod}_${Date.now()}`,
  loginMethod,
  userId: 'demo_user',
});

// 认证仓储：登录/注册/验证码发送
export const AuthRepo = {
  // 手机号登录
  loginWithPhone: async (payload: { phone: string; code?: string; password?: string; mode: LoginMode }) =>
    simulateRequest(createSession('phone'), { delay: 420 }),
  // 邮箱登录
  loginWithEmail: async (payload: { email: string; code?: string; password?: string; mode: LoginMode }) =>
    simulateRequest(createSession('email'), { delay: 420 }),
  // 手机号注册
  registerWithPhone: async (payload: { phone: string; code?: string; password?: string; mode: LoginMode }) =>
    simulateRequest(createSession('phone'), { delay: 480 }),
  // 邮箱注册
  registerWithEmail: async (payload: { email: string; code?: string; password?: string; mode: LoginMode }) =>
    simulateRequest(createSession('email'), { delay: 480 }),
  // 发送短信验证码
  requestSmsCode: async (phone: string): Promise<Result<{ ok: boolean }>> =>
    simulateRequest({ ok: true }, { delay: 300 }),
  // 发送邮箱验证码
  requestEmailCode: async (email: string): Promise<Result<{ ok: boolean }>> =>
    simulateRequest({ ok: true }, { delay: 300 }),
  // 微信登录（占位）
  loginWithWeChat: async (): Promise<Result<AuthSession>> => simulateRequest(createSession('wechat'), { delay: 520 }),
  // Apple 登录（占位）
  loginWithApple: async (): Promise<Result<AuthSession>> => simulateRequest(createSession('apple'), { delay: 520 }),
};

