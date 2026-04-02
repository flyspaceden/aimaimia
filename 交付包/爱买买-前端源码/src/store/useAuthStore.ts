/**
 * 认证状态（Store）
 *
 * 用途：
 * - 控制“未登录/已登录”两套 UI（例如“我的”页显示登录/注册入口）
 * - 为后端接入预留 token/session 的统一存取位置
 *
 * 后端接入说明：
 * - 登录成功返回 `accessToken`（以及可选 `refreshToken`）
 * - 前端把 token 存到这里，并在 ApiClient 里统一带上
 *   `Authorization: Bearer <accessToken>`
 */
import { create } from 'zustand';
import { LoginMethod } from '../types';

type AuthState = {
  isLoggedIn: boolean;
  accessToken?: string;
  loginMethod?: LoginMethod;
  setLoggedIn: (payload: { accessToken: string; loginMethod: LoginMethod }) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: false,
  accessToken: undefined,
  loginMethod: undefined,
  setLoggedIn: ({ accessToken, loginMethod }) =>
    set({ isLoggedIn: true, accessToken, loginMethod }),
  logout: () => set({ isLoggedIn: false, accessToken: undefined, loginMethod: undefined }),
}));

