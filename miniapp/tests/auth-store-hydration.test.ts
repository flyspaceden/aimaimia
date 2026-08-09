import { describe, expect, it, vi } from 'vitest';

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
});
