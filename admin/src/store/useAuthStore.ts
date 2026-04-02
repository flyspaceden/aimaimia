import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminProfile } from '@/types';

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  admin: AdminProfile | null;
  /** 设置认证信息（登录成功后调用） */
  setAuth: (token: string, refreshToken: string, admin: AdminProfile) => void;
  /** 清除认证信息（登出时调用） */
  clearAuth: () => void;
  /** 检查是否拥有指定权限 */
  hasPermission: (permission: string) => boolean;
  /** 检查是否为超级管理员 */
  isSuperAdmin: () => boolean;
}

const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      admin: null,

      setAuth: (token, refreshToken, admin) => {
        localStorage.setItem('admin_token', token);
        localStorage.setItem('admin_refresh_token', refreshToken);
        set({ token, refreshToken, admin });
      },

      clearAuth: () => {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_refresh_token');
        set({ token: null, refreshToken: null, admin: null });
      },

      hasPermission: (permission: string) => {
        const { admin } = get();
        if (!admin) return false;
        // 超级管理员拥有所有权限
        if (admin.roles.includes('超级管理员')) return true;
        return admin.permissions.includes(permission);
      },

      isSuperAdmin: () => {
        const { admin } = get();
        if (!admin) return false;
        // 后端 getProfile 返回 roles: string[]（角色名数组）
        return admin.roles.includes('超级管理员');
      },
    }),
    {
      name: 'nongmai-admin-auth',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        admin: state.admin,
      }),
    },
  ),
);

export default useAuthStore;
