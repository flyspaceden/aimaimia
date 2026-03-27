/**
 * 认证状态（Store）
 *
 * 用途：
 * - 控制"未登录/已登录"两套 UI（例如"我的"页显示登录/注册入口）
 * - 存储 token/session 供 ApiClient 统一带上 Authorization header
 *
 * 持久化说明：
 * - 使用 zustand/middleware persist + expo-secure-store 安全存储 Token
 * - SecureStore 在 iOS 使用 Keychain，Android 使用 EncryptedSharedPreferences
 */
import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { LoginMethod } from '../types';

/**
 * SecureStore 适配器（实现 Zustand StateStorage 接口）
 * Web 平台回退到 localStorage（SecureStore 仅支持 iOS/Android）
 */
const secureStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(name);
    }
    return SecureStore.getItemAsync(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.setItem(name, value);
      return;
    }
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(name);
      return;
    }
    await SecureStore.deleteItemAsync(name);
  },
};

type AuthState = {
  isLoggedIn: boolean;
  accessToken?: string;
  refreshToken?: string;
  userId?: string;
  loginMethod?: LoginMethod;
  setLoggedIn: (payload: {
    accessToken: string;
    refreshToken?: string;
    userId?: string;
    loginMethod: LoginMethod;
  }) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isLoggedIn: false,
      accessToken: undefined,
      refreshToken: undefined,
      userId: undefined,
      loginMethod: undefined,
      setLoggedIn: ({ accessToken, refreshToken, userId, loginMethod }) => {
        set({ isLoggedIn: true, accessToken, refreshToken, userId, loginMethod });
        // 注册/登录成功后，自动绑定暂存的推荐码
        import('../services/deferredLink').then(({ getPendingReferralCode, clearPendingReferralCode }) => {
          getPendingReferralCode().then((code) => {
            if (!code) return;
            import('../repos').then(({ BonusRepo }) => {
              BonusRepo.useReferralCode(code)
                .then(() => {
                  // 成功或业务错误（推荐码无效等），清除 pending
                  clearPendingReferralCode();
                })
                .catch(() => {
                  // 网络故障等临时错误，保留 pending code 供下次重试
                });
            });
          });
        }).catch(() => {});
      },
      logout: () => {
        const wasLoggedIn = get().isLoggedIn;
        set({
          isLoggedIn: false,
          accessToken: undefined,
          refreshToken: undefined,
          userId: undefined,
          loginMethod: undefined,
        });
        // 仅在“已登录 -> 退出登录”时清空当前购物车视图。
        // 若本就处于匿名态，再次触发 logout（例如迟到的 401）不应误删匿名购物车。
        if (!wasLoggedIn) return;
        try {
          const { useCartStore } = require('./useCartStore');
          useCartStore.setState({ items: [], selectedIds: new Set<string>() });
        } catch { /* 忽略 */ }
      },
    }),
    {
      name: 'nongmai-auth',
      storage: createJSONStorage(() => secureStorage),
      // 只持久化数据字段，不持久化方法
      partialize: (state) => ({
        isLoggedIn: state.isLoggedIn,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        userId: state.userId,
        loginMethod: state.loginMethod,
      }),
    },
  ),
);
