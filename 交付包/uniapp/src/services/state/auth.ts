// 登录态本地占位（仅前端）+ 后端对接接口说明
//
// 当前阶段目标：
// - 让“未登录态”在“我的”页面显示登录/注册卡片
// - 点击登录后先本地模拟登录成功（写入 token + profile），以便联动消息中心/关注/订单等
//
// 后端对接建议（手机号验证码为默认）：
// - POST /auth/sms/send { phone } -> { requestId }
// - POST /auth/sms/verify { phone, code, requestId } -> { token, user }
// - POST /auth/logout
// - GET /me -> user
//
// 注意：
// - 真正接入后端时，AuthState.loginByCode / logout 里调用 AuthRepo 即可
// - token 建议存储在安全区（App 可用 plus.runtime/原生能力），先占位用 storage
import { APP_EVENTS } from './events';
import { emitAppEvent } from './uniEvents';

export type UserProfile = {
  id: string;
  nickname: string;
  city?: string;
  vipLevel?: 'seed' | 'growth' | 'harvest';
};

export type AuthSession = {
  token: string;
  user: UserProfile;
};

const TOKEN_KEY = 'nm_auth_token_v1';
const PROFILE_KEY = 'nm_auth_profile_v1';

const readSession = (): AuthSession | null => {
  const token = uni.getStorageSync(TOKEN_KEY);
  const rawProfile = uni.getStorageSync(PROFILE_KEY);
  if (!token) return null;
  try {
    const user = rawProfile ? (JSON.parse(String(rawProfile)) as UserProfile) : null;
    if (!user?.id) return null;
    return { token: String(token), user };
  } catch {
    return null;
  }
};

const writeSession = (session: AuthSession | null) => {
  if (!session) {
    uni.removeStorageSync(TOKEN_KEY);
    uni.removeStorageSync(PROFILE_KEY);
    emitAppEvent(APP_EVENTS.AUTH_CHANGED, null);
    return;
  }
  uni.setStorageSync(TOKEN_KEY, session.token);
  uni.setStorageSync(PROFILE_KEY, JSON.stringify(session.user));
  emitAppEvent(APP_EVENTS.AUTH_CHANGED, session);
};

export const AuthState = {
  getSession: readSession,

  // 占位：验证码登录（默认）
  async loginByCode(payload: { phone: string; code: string }): Promise<{ ok: true } | { ok: false; message: string }> {
    // TODO(后端)：这里应调用 AuthRepo.verifySmsCode，然后写入真实 token/user
    const phone = payload.phone.trim();
    const code = payload.code.trim();
    if (phone.length < 8) return { ok: false, message: '请输入正确手机号' };
    if (!code) return { ok: false, message: '请输入验证码' };

    writeSession({
      token: 'mock-token',
      user: { id: 'u_mock', nickname: '江晴', city: '杭州', vipLevel: 'growth' },
    });
    return { ok: true };
  },

  // 占位：密码登录（备用）
  async loginByPassword(payload: { phone: string; password: string }): Promise<{ ok: true } | { ok: false; message: string }> {
    // TODO(后端)：这里应调用 AuthRepo.loginByPassword
    const phone = payload.phone.trim();
    const password = payload.password.trim();
    if (phone.length < 8) return { ok: false, message: '请输入正确手机号' };
    if (password.length < 4) return { ok: false, message: '请输入密码' };
    writeSession({
      token: 'mock-token',
      user: { id: 'u_mock', nickname: '江晴', city: '杭州', vipLevel: 'growth' },
    });
    return { ok: true };
  },

  logout() {
    // TODO(后端)：调用 AuthRepo.logout（可选），再清理本地 token
    writeSession(null);
  },
};

