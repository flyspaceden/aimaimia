import Taro from '@tarojs/taro';
import { ApiClient } from '@/api/client';
import {
  logoutAndClearClientStateIfCurrent,
  replaceTrustedSession,
} from '@/session/clientState';
import { captureAuthSession, useAuthStore } from '@/store/auth';
import type { Result } from '@/types/result';

export type MiniappSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userId: string;
  loginMethod: 'wechat-miniapp' | 'phone';
};

export type MiniappBindingRequired = {
  bindRequired: true;
  miniLoginTicket: string;
  expiresInSeconds: number;
};

export type MiniappLoginResult = MiniappSession | MiniappBindingRequired;

function isSession(value: unknown): value is MiniappSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return typeof session.accessToken === 'string' && session.accessToken.length > 0
    && typeof session.refreshToken === 'string' && session.refreshToken.length > 0
    && typeof session.userId === 'string' && session.userId.length > 0
    && typeof session.expiresAt === 'string'
    && (session.loginMethod === 'wechat-miniapp' || session.loginMethod === 'phone');
}

function isBindingRequired(value: unknown): value is MiniappBindingRequired {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Record<string, unknown>;
  return binding.bindRequired === true
    && typeof binding.miniLoginTicket === 'string'
    && /^[a-f0-9]{64}$/.test(binding.miniLoginTicket)
    && typeof binding.expiresInSeconds === 'number';
}

type AuthAttempt = { id: number; revision: number };
let latestAuthAttemptId = 0;

function beginAuthAttempt(): AuthAttempt {
  return {
    id: ++latestAuthAttemptId,
    revision: useAuthStore.getState().revision,
  };
}

function isCurrentAuthAttempt(attempt: AuthAttempt): boolean {
  return attempt.id === latestAuthAttemptId
    && attempt.revision === useAuthStore.getState().revision;
}

function supersededAuthResult<T>(): Result<T> {
  return {
    ok: false,
    error: {
      code: 'AUTH_ATTEMPT_SUPERSEDED',
      message: 'a newer authentication attempt or session replacement completed first',
      displayMessage: '登录状态已更新，请重试',
      retryable: true,
    },
  };
}

function invalidAuthResponse<T>(): Result<T> {
  return {
    ok: false,
    error: {
      code: 'INVALID_AUTH_RESPONSE',
      message: 'authentication endpoint returned an invalid success payload',
      displayMessage: '登录服务响应异常，请重试',
      retryable: true,
    },
  };
}

function accountMismatchResult<T>(): Result<T> {
  return {
    ok: false,
    error: {
      code: 'WECHAT_ACCOUNT_MISMATCH',
      message: 'the verified WeChat identity belongs to a different user',
      displayMessage: '当前微信已属于另一个爱买买账号，未切换当前账号，请先联系客服处理',
      retryable: false,
    },
  };
}

function persistSession(
  result: Result<MiniappLoginResult>,
  attempt: AuthAttempt,
  expectedUserId?: string,
): Result<MiniappLoginResult> {
  if (result.ok && !isCurrentAuthAttempt(attempt)) return supersededAuthResult();
  if (result.ok && !isSession(result.data) && !isBindingRequired(result.data)) return invalidAuthResponse();
  if (result.ok && isSession(result.data) && expectedUserId && result.data.userId !== expectedUserId) {
    return accountMismatchResult();
  }
  if (result.ok && isSession(result.data)) replaceTrustedSession(result.data);
  return result;
}

async function persistPhoneSession(
  request: Promise<Result<MiniappSession>>,
  attempt: AuthAttempt,
): Promise<Result<MiniappSession>> {
  const result = await request;
  if (result.ok && !isCurrentAuthAttempt(attempt)) return supersededAuthResult();
  if (result.ok && !isSession(result.data)) return invalidAuthResponse();
  if (result.ok) replaceTrustedSession(result.data);
  return result;
}

export async function loginWithWechatMiniProgram(expectedUserId?: string): Promise<Result<MiniappLoginResult>> {
  const attempt = beginAuthAttempt();
  try {
    const { code } = await Taro.login({ timeout: 10_000 });
    if (!code) {
      return {
        ok: false,
        error: { code: 'WECHAT_CODE_EMPTY', message: 'wx.login returned an empty code' },
      };
    }
    if (!isCurrentAuthAttempt(attempt)) return supersededAuthResult();
    return persistSession(await ApiClient.post<MiniappLoginResult>(
      '/auth/oauth/wechat-miniapp',
      { code },
    ), attempt, expectedUserId);
  } catch (error) {
    const message = error && typeof error === 'object' && 'errMsg' in error
      ? String((error as { errMsg?: unknown }).errMsg || '')
      : 'wx.login failed';
    return {
      ok: false,
      error: {
        code: 'WECHAT_LOGIN_FAILED',
        message,
        displayMessage: '微信登录失败，请重试',
        retryable: true,
      },
    };
  }
}

export function sendMiniappBindPhoneCode(miniLoginTicket: string, phone: string) {
  return ApiClient.post<{ ok: boolean }>(
    '/auth/oauth/wechat-miniapp/bind-phone/sms/code',
    { miniLoginTicket, phone },
  );
}

export async function bindMiniappPhone(
  miniLoginTicket: string,
  phone: string,
  code: string,
  expectedUserId?: string,
): Promise<Result<MiniappSession>> {
  const attempt = beginAuthAttempt();
  const result = await ApiClient.post<MiniappSession>(
    '/auth/oauth/wechat-miniapp/bind-phone',
    { miniLoginTicket, phone, code },
  );
  if (result.ok && !isCurrentAuthAttempt(attempt)) return supersededAuthResult();
  if (result.ok && !isSession(result.data)) return invalidAuthResponse();
  if (result.ok && expectedUserId && result.data.userId !== expectedUserId) return accountMismatchResult();
  if (result.ok) replaceTrustedSession(result.data);
  return result;
}

export function requestPhoneSmsCode(phone: string): Promise<Result<{ ok: boolean }>> {
  return ApiClient.post<{ ok: boolean }>('/auth/sms/code', { phone });
}

export function loginWithPhone(input: {
  phone: string;
  mode: 'code' | 'password';
  code?: string;
  password?: string;
}): Promise<Result<MiniappSession>> {
  const attempt = beginAuthAttempt();
  return persistPhoneSession(ApiClient.post<MiniappSession>('/auth/login', input), attempt);
}

export function registerWithPhone(input: {
  phone: string;
  code: string;
  name: string;
  password: string;
}): Promise<Result<MiniappSession>> {
  const attempt = beginAuthAttempt();
  return persistPhoneSession(ApiClient.post<MiniappSession>('/auth/register', input), attempt);
}

export function getForgotPasswordCaptcha(): Promise<Result<{ captchaId: string; svg: string }>> {
  return ApiClient.get<{ captchaId: string; svg: string }>('/captcha');
}

export function sendForgotPasswordCode(input: {
  phone: string;
  captchaId: string;
  captchaCode: string;
}): Promise<Result<{ success: boolean }>> {
  return ApiClient.post<{ success: boolean }>('/auth/forgot-password/send-code', input);
}

export function resetForgotPassword(input: {
  phone: string;
  code: string;
  newPassword: string;
}): Promise<Result<{ success: boolean }>> {
  return ApiClient.post<{ success: boolean }>('/auth/forgot-password/reset', input);
}

export function changePassword(input: {
  oldPassword: string;
  newPassword: string;
}): Promise<Result<{ ok: boolean }>> {
  return ApiClient.post<{ ok: boolean }>('/auth/change-password', input);
}

export function normalizeAuthReturnUrl(value?: string): string | undefined {
  if (!value) return undefined;
  let candidate = value.trim();
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return undefined;
  }
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return undefined;
  if (candidate.includes('://') || /[\r\n]/.test(candidate)) return undefined;
  if (/^\/packages\/account\/account-(?:login|forgot-password|legal)\/index(?:\?|$)/.test(candidate)) {
    return undefined;
  }
  return candidate;
}

export function hasWechatMiniProgramSession(): boolean {
  const state = useAuthStore.getState();
  return Boolean(
    state.accessToken
    && state.refreshToken
    && state.userId
    && state.loginMethod === 'wechat-miniapp',
  );
}

export function wechatMiniProgramReauthUrl(rawReturnUrl: string): string {
  const returnUrl = normalizeAuthReturnUrl(rawReturnUrl) || '/pages/me/index';
  return `/packages/account/account-login/index?requireWechat=1&returnUrl=${encodeURIComponent(returnUrl)}`;
}

/**
 * 微信支付与微信零钱提现必须使用当前小程序微信身份。
 * 手机号会话先跳转身份重验，调用方必须在 false 时立即停止资金请求。
 */
export async function ensureWechatMiniProgramSession(returnUrl: string): Promise<boolean> {
  if (hasWechatMiniProgramSession()) return true;
  const state = useAuthStore.getState();
  if (state.accessToken && !state.userId) {
    const guard = captureAuthSession();
    logoutAndClearClientStateIfCurrent(guard);
    const normalizedReturnUrl = normalizeAuthReturnUrl(returnUrl) || '/pages/me/index';
    await Taro.navigateTo({
      url: `/packages/account/account-login/index?returnUrl=${encodeURIComponent(normalizedReturnUrl)}`,
    });
    return false;
  }
  await Taro.navigateTo({ url: wechatMiniProgramReauthUrl(returnUrl) });
  return false;
}

/** Return to the protected destination, the previous page, or finally the Me tab. */
export async function completeAuthNavigation(rawReturnUrl?: string): Promise<void> {
  const returnUrl = normalizeAuthReturnUrl(rawReturnUrl);
  if (returnUrl) {
    const path = returnUrl.split('?')[0];
    if (['/pages/home/index', '/pages/products/index', '/pages/me/index'].includes(path)) {
      await Taro.switchTab({ url: path });
      return;
    }
    try {
      await Taro.redirectTo({ url: returnUrl });
      return;
    } catch {
      // Fall through to a known tab when the destination is no longer routable.
    }
  } else if (Taro.getCurrentPages().length > 1) {
    try {
      await Taro.navigateBack();
      return;
    } catch {
      // Fall through when this page is the launch/root page.
    }
  }
  await Taro.switchTab({ url: '/pages/me/index' });
}

/** 同步封锁并清理当前会话代，再 best-effort 撤销对应的服务端 Session。 */
export async function logoutMiniapp(): Promise<Result<{ ok: boolean }>> {
  try {
    return await ApiClient.logoutCurrentSession();
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'LOGOUT_REVOKE_FAILED',
        message: error instanceof Error ? error.message : 'server logout failed',
        displayMessage: '已退出当前设备',
        retryable: false,
      },
    };
  }
}
