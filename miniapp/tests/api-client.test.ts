import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, isResultEnvelope } from '@/api/client';
import { queryClient } from '@/query/client';
import { logoutAndClearClientState , registerPrivateStateReset } from '@/session/clientState';
import { useAuthStore } from '@/store/auth';
import { useCheckoutSelectionStore } from '@/store/checkout-selection';

const requestMock = vi.hoisted(() => vi.fn());
const uploadFileMock = vi.hoisted(() => vi.fn());

vi.mock('@tarojs/taro', () => ({
  default: {
    request: requestMock,
    uploadFile: uploadFileMock,
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const response = (statusCode: number, data: unknown) => ({ statusCode, data });
const unauthorized = response(401, {
  ok: false,
  error: { code: 'UNAUTHORIZED', message: 'unauthorized' },
});

describe('miniapp ApiClient session isolation', () => {
  beforeEach(() => {
    requestMock.mockReset();
    uploadFileMock.mockReset();
    queryClient.clear();
    useAuthStore.setState({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
      revision: 0,
      logoutGeneration: 0,
      hydrated: true,
    });
  });

  it('does not let an old refresh overwrite a newly logged-in account', async () => {
    const oldRefresh = deferred<ReturnType<typeof response>>();
    requestMock
      .mockResolvedValueOnce(unauthorized)
      .mockReturnValueOnce(oldRefresh.promise);
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });

    const pending = ApiClient.get<{ secret: string }>('/private');
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));

    useAuthStore.getState().setSession({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      userId: 'user-b',
    });
    oldRefresh.resolve(response(200, {
      ok: true,
      data: { accessToken: 'access-a-new', refreshToken: 'refresh-a-new' },
    }));

    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      userId: 'user-b',
    });
  });

  it('does not clear a new account when an old refresh fails', async () => {
    const oldRefresh = deferred<ReturnType<typeof response>>();
    requestMock
      .mockResolvedValueOnce(unauthorized)
      .mockReturnValueOnce(oldRefresh.promise);
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });

    const pending = ApiClient.get('/private');
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    useAuthStore.getState().setSession({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      userId: 'user-b',
    });
    oldRefresh.resolve(response(503, '<html>gateway unavailable</html>'));

    await pending;
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      userId: 'user-b',
    });
  });

  it('revokes the rotated session when refresh completes before logout starts', async () => {
    const oldRefresh = deferred<ReturnType<typeof response>>();
    requestMock
      .mockResolvedValueOnce(unauthorized)
      .mockReturnValueOnce(oldRefresh.promise)
      .mockResolvedValueOnce(response(200, { ok: true, data: { secret: 'fresh' } }))
      .mockResolvedValueOnce(response(200, { ok: true, data: { ok: true } }));
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });

    const protectedRequest = ApiClient.get<{ secret: string }>('/private');
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    oldRefresh.resolve(response(200, {
      ok: true,
      data: { accessToken: 'access-a-new', refreshToken: 'refresh-a-new' },
    }));
    await expect(protectedRequest).resolves.toMatchObject({ ok: true });

    await expect(ApiClient.logoutCurrentSession()).resolves.toMatchObject({ ok: true });

    expect(requestMock).toHaveBeenNthCalledWith(4, expect.objectContaining({
      url: expect.stringContaining('/auth/logout'),
      header: expect.objectContaining({ Authorization: 'Bearer access-a-new' }),
    }));
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
    });
  });

  it('never restores a session when refresh completes after logout starts', async () => {
    const lateRefresh = deferred<ReturnType<typeof response>>();
    requestMock
      .mockResolvedValueOnce(unauthorized)
      .mockReturnValueOnce(lateRefresh.promise)
      .mockResolvedValueOnce(response(200, { ok: true, data: { ok: true } }));
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });
    const revisionBeforeLogout = useAuthStore.getState().revision;
    const logoutGenerationBefore = useAuthStore.getState().logoutGeneration;
    queryClient.setQueryData(['wallet'], { balance: 100 });

    const protectedRequest = ApiClient.get('/private');
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    const logoutRequest = ApiClient.logoutCurrentSession();

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
      revision: revisionBeforeLogout + 1,
      logoutGeneration: logoutGenerationBefore + 1,
    });
    expect(queryClient.getQueryData(['wallet'])).toBeUndefined();
    expect(requestMock).toHaveBeenCalledTimes(2);

    lateRefresh.resolve(response(200, {
      ok: true,
      data: { accessToken: 'access-a-new', refreshToken: 'refresh-a-new' },
    }));

    await expect(logoutRequest).resolves.toMatchObject({ ok: true });
    await expect(protectedRequest).resolves.toMatchObject({ ok: false });
    expect(requestMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      url: expect.stringContaining('/auth/logout'),
      header: expect.objectContaining({ Authorization: 'Bearer access-a-new' }),
    }));
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
      revision: revisionBeforeLogout + 1,
      logoutGeneration: logoutGenerationBefore + 1,
    });
  });

  it('keeps the local session cleared when server revocation fails', async () => {
    requestMock.mockRejectedValueOnce(new Error('offline'));
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });
    queryClient.setQueryData(['orders'], [{ id: 'order-a' }]);

    await expect(ApiClient.logoutCurrentSession()).rejects.toThrow('offline');

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
    });
    expect(queryClient.getQueryData(['orders'])).toBeUndefined();
  });

  it('rejects an authenticated success response from the previous account generation', async () => {
    const oldResponse = deferred<ReturnType<typeof response>>();
    requestMock.mockReturnValueOnce(oldResponse.promise);
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });

    const pending = ApiClient.get<{ id: string }>('/orders');
    useAuthStore.getState().setSession({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      userId: 'user-b',
    });
    oldResponse.resolve(response(200, { ok: true, data: { id: 'order-a' } }));

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTH_SESSION_CHANGED' },
    });
  });

  it('clears the same session and query cache when refresh succeeds but retry is still 401', async () => {
    queryClient.setQueryData(['orders'], [{ id: 'order-a' }]);
    requestMock
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(response(200, {
        ok: true,
        data: { accessToken: 'access-a-new', refreshToken: 'refresh-a-new' },
      }))
      .mockResolvedValueOnce(unauthorized);
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });

    await expect(ApiClient.get('/private')).resolves.toMatchObject({ ok: false });
    expect(useAuthStore.getState().accessToken).toBeUndefined();
    expect(queryClient.getQueryData(['orders'])).toBeUndefined();
  });

  it('preserves the controlled Idempotency-Key across a same-generation token refresh', async () => {
    requestMock
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(response(200, {
        ok: true,
        data: { accessToken: 'access-a-new', refreshToken: 'refresh-a-new' },
      }))
      .mockResolvedValueOnce(response(200, {
        ok: true,
        data: { id: 'cart-1', items: [] },
      }));
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });

    await expect(ApiClient.post('/cart/merge', { items: [] }, {
      idempotencyKey: 'cart-merge-login-1',
    })).resolves.toMatchObject({ ok: true });

    expect(requestMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer access-a',
        'Idempotency-Key': 'cart-merge-login-1',
      },
    }));
    expect(requestMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: expect.stringContaining('/auth/refresh'),
      header: { 'Content-Type': 'application/json' },
    }));
    expect(requestMock).toHaveBeenNthCalledWith(3, expect.objectContaining({
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer access-a-new',
        'Idempotency-Key': 'cart-merge-login-1',
      },
    }));

    await expect(ApiClient.post('/cart/merge', { items: [] }, {
      idempotencyKey: 'unsafe key\nvalue',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_IDEMPOTENCY_KEY' },
    });
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('normalizes gateway HTML and WeChat timeout errors', async () => {
    requestMock.mockResolvedValueOnce(response(502, '<html>bad gateway</html>'));
    await expect(ApiClient.get('/private')).resolves.toMatchObject({
      ok: false,
      error: { code: 'UPSTREAM_ERROR' },
    });

    requestMock.mockRejectedValueOnce({ errMsg: 'request:fail timeout' });
    await expect(ApiClient.get('/private')).resolves.toMatchObject({
      ok: false,
      error: { code: 'NETWORK_TIMEOUT' },
    });
  });

  it('parses upload Result envelopes and injects the current access token', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'upload-access',
      refreshToken: 'upload-refresh',
      userId: 'user-upload',
    });
    uploadFileMock.mockResolvedValue({
      statusCode: 200,
      data: JSON.stringify({ ok: true, data: { key: 'audio/voice.mp3' } }),
    });

    await expect(ApiClient.uploadFile<{ key: string }>('/upload', {
      filePath: 'wxfile://voice.mp3',
      name: 'file',
    })).resolves.toEqual({ ok: true, data: { key: 'audio/voice.mp3' } });
    expect(uploadFileMock).toHaveBeenCalledWith(expect.objectContaining({
      header: { Authorization: 'Bearer upload-access' },
      filePath: 'wxfile://voice.mp3',
      name: 'file',
    }));
  });

  it('rejects an upload success response from the previous account generation', async () => {
    const oldResponse = deferred<{ statusCode: number; data: string }>();
    uploadFileMock.mockReturnValueOnce(oldResponse.promise);
    useAuthStore.getState().setSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
    });

    const pending = ApiClient.uploadFile<{ key: string }>('/upload', {
      filePath: 'wxfile://voice-a.mp3',
      name: 'file',
    });
    useAuthStore.getState().setSession({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      userId: 'user-b',
    });
    oldResponse.resolve({
      statusCode: 200,
      data: JSON.stringify({ ok: true, data: { key: 'audio/user-a.mp3' } }),
    });

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTH_SESSION_CHANGED' },
    });
  });
});

describe('client state cleanup and Result contract', () => {
  beforeEach(() => {
    queryClient.clear();
    useAuthStore.setState({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      userId: 'user-a',
      revision: 1,
      logoutGeneration: 0,
      hydrated: true,
    });
  });

  it('clears private query data on explicit logout', () => {
    queryClient.setQueryData(['wallet'], { balance: 100 });
    logoutAndClearClientState();
    expect(queryClient.getQueryData(['wallet'])).toBeUndefined();
    expect(useAuthStore.getState().userId).toBeUndefined();
  });

  it('clears checkout address and coupon choices on logout', () => {
    useCheckoutSelectionStore.getState().begin({
      ownerRevision: 1,
      addressId: 'address-user-a',
      couponIds: ['coupon-user-a'],
    });

    logoutAndClearClientState();

    expect(useCheckoutSelectionStore.getState()).toMatchObject({
      ownerRevision: -1,
      addressId: '',
      couponIds: [],
    });
  });

  it('continues clearing private stores when one reset callback throws', () => {
    const failedReset = vi.fn(() => { throw new Error('broken store'); });
    const laterReset = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unregisterFailed = registerPrivateStateReset(failedReset);
    const unregisterLater = registerPrivateStateReset(laterReset);

    logoutAndClearClientState();

    expect(failedReset).toHaveBeenCalled();
    expect(laterReset).toHaveBeenCalled();
    unregisterFailed();
    unregisterLater();
    consoleError.mockRestore();
  });

  it('accepts only valid Result envelopes', () => {
    expect(isResultEnvelope({ ok: true, data: [] })).toBe(true);
    expect(isResultEnvelope({ ok: false, error: { code: 'X', message: 'x' } })).toBe(true);
    expect(isResultEnvelope({ ok: true })).toBe(false);
    expect(isResultEnvelope('<html>bad gateway</html>')).toBe(false);
  });
});
