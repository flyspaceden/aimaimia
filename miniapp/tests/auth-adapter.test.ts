import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '@/query/client';
import {
  bindMiniappPhone,
  changePassword,
  completeAuthNavigation,
  ensureWechatMiniProgramSession,
  loginWithPhone,
  loginWithWechatMiniProgram,
  logoutMiniapp,
  normalizeAuthReturnUrl,
  sendMiniappBindPhoneCode,
  wechatMiniProgramReauthUrl,
} from '@/platform/auth';
import { useAuthStore } from '@/store/auth';

const loginMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn());
const getMock = vi.hoisted(() => vi.fn());
const logoutCurrentSessionMock = vi.hoisted(() => vi.fn());
const getCurrentPagesMock = vi.hoisted(() => vi.fn(() => [{ route: 'account-login' }]));
const navigateBackMock = vi.hoisted(() => vi.fn());
const redirectToMock = vi.hoisted(() => vi.fn());
const switchTabMock = vi.hoisted(() => vi.fn());
const navigateToMock = vi.hoisted(() => vi.fn());

vi.mock('@tarojs/taro', () => ({
  default: {
    login: loginMock,
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    getCurrentPages: getCurrentPagesMock,
    navigateBack: navigateBackMock,
    redirectTo: redirectToMock,
    switchTab: switchTabMock,
    navigateTo: navigateToMock,
  },
}));
vi.mock('@/api/client', () => ({
  ApiClient: {
    get: getMock,
    post: postMock,
    logoutCurrentSession: logoutCurrentSessionMock,
  },
}));

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

describe('miniapp auth adapter', () => {
  beforeEach(() => {
    loginMock.mockReset();
    postMock.mockReset();
    getMock.mockReset();
    logoutCurrentSessionMock.mockReset();
    getCurrentPagesMock.mockReset();
    getCurrentPagesMock.mockReturnValue([{ route: 'account-login' }]);
    navigateBackMock.mockReset();
    navigateBackMock.mockResolvedValue(undefined);
    redirectToMock.mockReset();
    redirectToMock.mockResolvedValue(undefined);
    switchTabMock.mockReset();
    switchTabMock.mockResolvedValue(undefined);
    navigateToMock.mockReset();
    navigateToMock.mockResolvedValue(undefined);
    queryClient.clear();
    useAuthStore.setState({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
      loginMethod: undefined,
      revision: 0,
      logoutGeneration: 0,
      hydrated: true,
    });
  });

  it('exchanges wx.login code and persists a trusted session', async () => {
    loginMock.mockResolvedValue({ code: 'one-time-code' });
    postMock.mockResolvedValue({
      ok: true,
      data: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2026-08-03T00:00:00.000Z',
        userId: 'user-1',
        loginMethod: 'wechat-miniapp',
      },
    });

    await expect(loginWithWechatMiniProgram()).resolves.toMatchObject({ ok: true });
    expect(postMock).toHaveBeenCalledWith('/auth/oauth/wechat-miniapp', { code: 'one-time-code' });
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      userId: 'user-1',
    });
  });

  it('does not create a local session when phone binding is required', async () => {
    loginMock.mockResolvedValue({ code: 'one-time-code' });
    postMock.mockResolvedValue({
      ok: true,
      data: { bindRequired: true, miniLoginTicket: 'a'.repeat(64), expiresInSeconds: 300 },
    });
    await expect(loginWithWechatMiniProgram()).resolves.toMatchObject({
      ok: true,
      data: { bindRequired: true },
    });
    expect(useAuthStore.getState().accessToken).toBeUndefined();
  });

  it('does not replace a phone session when reverified WeChat belongs to another user', async () => {
    useAuthStore.getState().setSession({ accessToken: 'phone-access', refreshToken: 'phone-refresh', userId: 'phone-user', loginMethod: 'phone' });
    loginMock.mockResolvedValue({ code: 'other-wechat-code' });
    postMock.mockResolvedValue({
      ok: true,
      data: { accessToken: 'other-access', refreshToken: 'other-refresh', expiresAt: '2026-08-03T00:00:00.000Z', userId: 'other-user', loginMethod: 'wechat-miniapp' },
    });

    await expect(loginWithWechatMiniProgram('phone-user')).resolves.toMatchObject({ ok: false, error: { code: 'WECHAT_ACCOUNT_MISMATCH' } });
    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'phone-access', userId: 'phone-user', loginMethod: 'phone' });
  });

  it('does not trust a binding result for a different reauthentication user', async () => {
    useAuthStore.getState().setSession({ accessToken: 'phone-access', refreshToken: 'phone-refresh', userId: 'phone-user', loginMethod: 'phone' });
    postMock.mockResolvedValue({
      ok: true,
      data: { accessToken: 'other-access', refreshToken: 'other-refresh', expiresAt: '2026-08-03T00:00:00.000Z', userId: 'other-user', loginMethod: 'wechat-miniapp' },
    });

    await expect(bindMiniappPhone('ticket', '13800138000', '123456', 'phone-user')).resolves.toMatchObject({ ok: false, error: { code: 'WECHAT_ACCOUNT_MISMATCH' } });
    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'phone-access', userId: 'phone-user', loginMethod: 'phone' });
  });

  it('supports the existing phone login contract and persists its session', async () => {
    postMock.mockResolvedValue({
      ok: true,
      data: {
        accessToken: 'phone-access',
        refreshToken: 'phone-refresh',
        expiresAt: '2026-08-03T00:00:00.000Z',
        userId: 'phone-user',
        loginMethod: 'phone',
      },
    });

    await expect(loginWithPhone({
      phone: '13800138000', mode: 'password', password: 'Aa123456',
    })).resolves.toMatchObject({ ok: true });
    expect(postMock).toHaveBeenCalledWith('/auth/login', {
      phone: '13800138000', mode: 'password', password: 'Aa123456',
    });
    expect(useAuthStore.getState()).toMatchObject({ userId: 'phone-user', loginMethod: 'phone' });
  });

  it('routes a phone session to explicit WeChat reauthentication before money actions', async () => {
    useAuthStore.getState().setSession({ accessToken: 'phone-access', refreshToken: 'phone-refresh', userId: 'phone-user', loginMethod: 'phone' });
    const returnUrl = '/packages/member/wechat-withdraw/index';
    await expect(ensureWechatMiniProgramSession(returnUrl)).resolves.toBe(false);
    expect(navigateToMock).toHaveBeenCalledWith({ url: wechatMiniProgramReauthUrl(returnUrl) });
  });

  it('allows money actions only after the current session was issued for mini-program WeChat', async () => {
    useAuthStore.getState().setSession({ accessToken: 'wechat-access', refreshToken: 'wechat-refresh', userId: 'user-1', loginMethod: 'wechat-miniapp' });
    await expect(ensureWechatMiniProgramSession('/packages/commerce/checkout/index')).resolves.toBe(true);
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  it('fails closed and clears an inconsistent token-only session before money actions', async () => {
    useAuthStore.setState({
      accessToken: 'orphan-access',
      refreshToken: 'orphan-refresh',
      userId: undefined,
      loginMethod: 'wechat-miniapp',
    });

    await expect(ensureWechatMiniProgramSession('/packages/commerce/checkout/index'))
      .resolves.toBe(false);

    expect(useAuthStore.getState().accessToken).toBeUndefined();
    expect(navigateToMock).toHaveBeenCalledWith({
      url: '/packages/account/account-login/index?returnUrl=%2Fpackages%2Fcommerce%2Fcheckout%2Findex',
    });
  });

  it('rejects malformed success payloads without trusting partial tokens', async () => {
    postMock.mockResolvedValue({
      ok: true,
      data: { accessToken: 'unsafe-partial-token', loginMethod: 'phone' },
    });

    await expect(loginWithPhone({
      phone: '13800138000', mode: 'code', code: '123456',
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_AUTH_RESPONSE' } });
    expect(useAuthStore.getState().accessToken).toBeUndefined();
  });

  it('uses the backend bind-code response contract without invented expiry fields', async () => {
    postMock.mockResolvedValue({ ok: true, data: { ok: true } });
    await expect(sendMiniappBindPhoneCode('a'.repeat(64), '13800138000')).resolves.toEqual({
      ok: true, data: { ok: true },
    });
    expect(postMock).toHaveBeenCalledWith(
      '/auth/oauth/wechat-miniapp/bind-phone/sms/code',
      { miniLoginTicket: 'a'.repeat(64), phone: '13800138000' },
    );
  });

  it('clears the previous account query cache before replacing its trusted session', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-a', refreshToken: 'refresh-a', userId: 'user-a',
    });
    queryClient.setQueryData(['wallet'], { balance: 88 });
    postMock.mockResolvedValue({
      ok: true,
      data: {
        accessToken: 'access-b', refreshToken: 'refresh-b', userId: 'user-b',
        expiresAt: '2026-08-03T00:00:00.000Z', loginMethod: 'wechat-miniapp',
      },
    });

    await bindMiniappPhone('ticket-b', '13800138000', '123456');

    expect(useAuthStore.getState().userId).toBe('user-b');
    expect(queryClient.getQueryData(['wallet'])).toBeUndefined();
  });

  it('lets only the latest concurrent anonymous authentication attempt create a session', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    loginMock
      .mockResolvedValueOnce({ code: 'code-a' })
      .mockResolvedValueOnce({ code: 'code-b' });
    postMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const loginA = loginWithWechatMiniProgram();
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const loginB = loginWithWechatMiniProgram();
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    second.resolve({
      ok: true,
      data: {
        accessToken: 'access-b', refreshToken: 'refresh-b', userId: 'user-b',
        expiresAt: '2026-08-03T00:00:00.000Z', loginMethod: 'wechat-miniapp',
      },
    });
    await loginB;
    first.resolve({
      ok: true,
      data: {
        accessToken: 'access-a', refreshToken: 'refresh-a', userId: 'user-a',
        expiresAt: '2026-08-03T00:00:00.000Z', loginMethod: 'wechat-miniapp',
      },
    });

    await expect(loginA).resolves.toMatchObject({
      ok: false, error: { code: 'AUTH_ATTEMPT_SUPERSEDED' },
    });
    expect(useAuthStore.getState().userId).toBe('user-b');
  });

  it('revokes the server session and clears local state on logout', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-a', refreshToken: 'refresh-a', userId: 'user-a',
    });
    queryClient.setQueryData(['orders'], [{ id: 'order-a' }]);
    logoutCurrentSessionMock.mockImplementation(async () => {
      useAuthStore.getState().clearSession();
      queryClient.clear();
      return { ok: true, data: { ok: true } };
    });

    await logoutMiniapp();

    expect(logoutCurrentSessionMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBeUndefined();
    expect(queryClient.getQueryData(['orders'])).toBeUndefined();
  });

  it('changes password without sending a user or identity selector', async () => {
    postMock.mockResolvedValue({ ok: true, data: { ok: true } });
    await expect(changePassword({ oldPassword: 'OldPass1', newPassword: 'NewPass2' }))
      .resolves.toEqual({ ok: true, data: { ok: true } });
    expect(postMock).toHaveBeenCalledWith('/auth/change-password', {
      oldPassword: 'OldPass1',
      newPassword: 'NewPass2',
    });
  });

  it('still clears local state when server revocation fails', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-a', refreshToken: 'refresh-a', userId: 'user-a',
    });
    logoutCurrentSessionMock.mockImplementation(async () => {
      useAuthStore.getState().clearSession();
      throw new Error('offline');
    });

    await expect(logoutMiniapp()).resolves.toMatchObject({ ok: false });
    expect(useAuthStore.getState().accessToken).toBeUndefined();
  });

  it('only accepts internal miniapp return paths', () => {
    expect(normalizeAuthReturnUrl('%2Fpackages%2Faccount%2Faccount-profile%2Findex')).toBe('/packages/account/account-profile/index');
    expect(normalizeAuthReturnUrl('https://evil.example/path')).toBeUndefined();
    expect(normalizeAuthReturnUrl('//evil.example/path')).toBeUndefined();
    expect(normalizeAuthReturnUrl('/packages/account/account-login/index')).toBeUndefined();
  });

  it('redirects to a safe protected destination after login', async () => {
    await completeAuthNavigation('/packages/account/account-addresses/index');
    expect(redirectToMock).toHaveBeenCalledWith({ url: '/packages/account/account-addresses/index' });
    expect(navigateBackMock).not.toHaveBeenCalled();
    expect(switchTabMock).not.toHaveBeenCalled();
  });

  it('uses switchTab when a return URL targets a tabBar page', async () => {
    await completeAuthNavigation('/pages/products/index');
    expect(switchTabMock).toHaveBeenCalledWith({ url: '/pages/products/index' });
    expect(redirectToMock).not.toHaveBeenCalled();
  });

  it('falls back to the Me tab when the login page has no previous page', async () => {
    await completeAuthNavigation();
    expect(navigateBackMock).not.toHaveBeenCalled();
    expect(switchTabMock).toHaveBeenCalledWith({ url: '/pages/me/index' });
  });
});
