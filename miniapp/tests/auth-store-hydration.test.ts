import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_STORAGE_KEY, useAuthStore } from '@/store/auth';

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(() => '{truncated-json'),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: storageMocks.get,
    setStorageSync: storageMocks.set,
    removeStorageSync: storageMocks.remove,
  },
}));

describe('auth store hydration recovery', () => {
  beforeEach(() => {
    storageMocks.get.mockReset().mockReturnValue('{truncated-json');
    storageMocks.set.mockReset();
    storageMocks.remove.mockReset();
    useAuthStore.setState({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
      loginMethod: undefined,
      revision: 0,
      logoutGeneration: 0,
      hydrated: false,
    });
  });

  it('removes corrupt persisted JSON and always releases the loading gate', async () => {
    // Vitest clears initialization-time spy calls before each test, so replay
    // the exact hydration path explicitly with the corrupt value still active.
    await useAuthStore.persist.rehydrate();
    await vi.waitFor(() => expect(useAuthStore.getState().hydrated).toBe(true));

    expect(storageMocks.get).toHaveBeenCalledWith(AUTH_STORAGE_KEY);
    expect(storageMocks.remove).toHaveBeenCalledWith(AUTH_STORAGE_KEY);
    expect(useAuthStore.getState().accessToken).toBeUndefined();
    expect(useAuthStore.getState().userId).toBeUndefined();
  });

  it('removes a phone session persisted by an older miniapp version', async () => {
    storageMocks.get.mockReturnValueOnce(JSON.stringify({
      state: {
        accessToken: 'legacy-phone-access',
        refreshToken: 'legacy-phone-refresh',
        userId: 'legacy-phone-user',
        loginMethod: 'phone',
      },
      version: 0,
    }));

    await useAuthStore.persist.rehydrate();
    await vi.waitFor(() => expect(useAuthStore.getState().hydrated).toBe(true));

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
      loginMethod: undefined,
    });
  });
});
