import Taro from '@tarojs/taro';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  loginMethod?: 'wechat-miniapp' | 'phone';
};

export type AuthSessionGuard = {
  accessToken?: string;
  refreshToken?: string;
  revision: number;
  logoutGeneration: number;
};

export type AuthLogoutGuard = AuthSessionGuard & {
  kind: 'logout';
};

type AuthState = {
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  loginMethod?: AuthSession['loginMethod'];
  revision: number;
  logoutGeneration: number;
  hydrated: boolean;
  setSession: (session: AuthSession) => void;
  applyRefreshedSession: (
    guard: AuthSessionGuard,
    tokens: Pick<AuthSession, 'accessToken' | 'refreshToken'> & Pick<AuthSession, 'loginMethod'>,
  ) => boolean;
  beginLogout: (guard: AuthSessionGuard) => AuthLogoutGuard | undefined;
  clearSession: () => void;
  clearSessionIfCurrent: (guard: AuthSessionGuard) => boolean;
  isCurrentSession: (guard: AuthSessionGuard) => boolean;
  isCurrentSessionGeneration: (guard: AuthSessionGuard) => boolean;
  setHydrated: (hydrated: boolean) => void;
};

const taroStorage: StateStorage = {
  getItem: (name) => {
    const raw = Taro.getStorageSync<string>(name) || null;
    if (!raw) return null;
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      // createJSONStorage parses after this adapter returns. Repair malformed
      // bytes here so hydration can complete normally and cannot remain gated.
      Taro.removeStorageSync(name);
      return null;
    }
  },
  setItem: (name, value) => Taro.setStorageSync(name, value),
  removeItem: (name) => Taro.removeStorageSync(name),
};

function matchesGuard(state: AuthState, guard: AuthSessionGuard): boolean {
  return state.revision === guard.revision
    && state.logoutGeneration === guard.logoutGeneration
    && state.accessToken === guard.accessToken
    && state.refreshToken === guard.refreshToken;
}

function matchesLogoutGuard(state: AuthState, guard: AuthSessionGuard): boolean {
  return 'kind' in guard
    && guard.kind === 'logout'
    && state.revision === guard.revision
    && state.logoutGeneration === guard.logoutGeneration;
}

export function captureAuthSession(): AuthSessionGuard {
  const state = useAuthStore.getState();
  return {
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    revision: state.revision,
    logoutGeneration: state.logoutGeneration,
  };
}

const storageEnv = process.env.TARO_APP_ENV || 'development';
export const AUTH_STORAGE_KEY = `aimai-miniapp-auth-v1:${storageEnv}`;

export const useAuthStore = create<AuthState>()(persist(
  (set, get) => ({
    revision: 0,
    logoutGeneration: 0,
    hydrated: false,
    setSession: (session) => set((state) => ({ ...session, revision: state.revision + 1 })),
    applyRefreshedSession: (guard, tokens) => {
      if (!matchesGuard(get(), guard)) return false;
      set({ ...tokens });
      return true;
    },
    beginLogout: (guard) => {
      const state = get();
      if (!matchesGuard(state, guard)) return undefined;
      const logoutGeneration = state.logoutGeneration + 1;
      set({ logoutGeneration });
      return { ...guard, logoutGeneration, kind: 'logout' };
    },
    clearSession: () => set((state) => ({
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
      loginMethod: undefined,
      revision: state.revision + 1,
    })),
    clearSessionIfCurrent: (guard) => {
      const current = get();
      if (!matchesGuard(current, guard) && !matchesLogoutGuard(current, guard)) return false;
      set((state) => ({
        accessToken: undefined,
        refreshToken: undefined,
        userId: undefined,
        loginMethod: undefined,
        revision: state.revision + 1,
      }));
      return true;
    },
    isCurrentSession: (guard) => matchesGuard(get(), guard),
    // Token refresh keeps the same revision. Explicit logout advances its own
    // generation before any await, so an already-running refresh cannot win.
    isCurrentSessionGeneration: (guard) => {
      const state = get();
      return state.revision === guard.revision
        && state.logoutGeneration === guard.logoutGeneration;
    },
    setHydrated: (hydrated) => set({ hydrated }),
  }),
  {
    name: AUTH_STORAGE_KEY,
    storage: createJSONStorage(() => taroStorage),
    partialize: ({ accessToken, refreshToken, userId, loginMethod }) => ({ accessToken, refreshToken, userId, loginMethod }),
    onRehydrateStorage: (initialState) => (state, error) => {
      if (error) {
        // A truncated/legacy JSON value must not brick every account page on
        // the loading screen. Remove it first, then finish hydration after the
        // store initializer has returned so Zustand cannot overwrite the flag.
        try {
          taroStorage.removeItem(AUTH_STORAGE_KEY);
        } catch {
          // setHydrated below rewrites a clean partial state when storage works again.
        }
        setTimeout(() => initialState.setHydrated(true), 0);
        return;
      }
      const hydratedState = state ?? initialState;
      // 小程序已切换为纯微信认证。清理旧版本可能遗留的手机号/未知来源
      // Session，避免受保护页面继续使用无法绑定当前小程序 OpenID 的 Token。
      if (hydratedState.accessToken && hydratedState.loginMethod !== 'wechat-miniapp') {
        hydratedState.clearSession();
      }
      hydratedState.setHydrated(true);
    },
  },
));
