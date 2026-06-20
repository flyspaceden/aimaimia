import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SellerProfile } from '@/types';

type StaffRole = 'OWNER' | 'MANAGER' | 'OPERATOR';

/** 解码 JWT payload 并检查是否已过期 */
function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false; // 无 exp 字段则视为不过期
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  seller: SellerProfile | null;
  /** 设置认证信息 */
  setAuth: (token: string, refreshToken: string, seller: SellerProfile) => void;
  /** 清除认证信息 */
  clearAuth: () => void;
  /** 更新当前登录 staff 的昵称（自助改昵称后同步本地，UI 立即刷新） */
  setSellerNickname: (nickname: string) => void;
  /** 检查角色权限 */
  hasRole: (...roles: StaffRole[]) => boolean;
  /** 检查配送中心权限码 */
  hasPermission: (permission: string) => boolean;
  /** 是否企业主 */
  isOwner: () => boolean;
}

const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      seller: null,

      setAuth: (token, refreshToken, seller) => {
        localStorage.setItem('delivery_seller_token', token);
        localStorage.setItem('delivery_seller_refresh_token', refreshToken);
        set({ token, refreshToken, seller });
      },

      clearAuth: () => {
        localStorage.removeItem('delivery_seller_token');
        localStorage.removeItem('delivery_seller_refresh_token');
        set({ token: null, refreshToken: null, seller: null });
      },

      setSellerNickname: (nickname) => {
        const { seller } = get();
        if (!seller) return;
        set({ seller: { ...seller, user: { ...seller.user, nickname } } });
      },

      hasRole: (...roles) => {
        const { seller } = get();
        if (!seller) return false;
        return roles.includes(seller.role);
      },

      hasPermission: (permission) => {
        const { seller } = get();
        if (!seller) return false;
        if (seller.role === 'OWNER') return true;

        const permissions = seller.permissionCodes ?? [];
        const unprefixed = permission.replace(/^delivery:/, '');
        const [moduleName, action] = unprefixed.split(':');
        const candidates = new Set([permission, unprefixed, `delivery:${unprefixed}`]);
        if (action === 'read') {
          candidates.add(`${moduleName}:write`);
          candidates.add(`${moduleName}:manage`);
          candidates.add(`delivery:${moduleName}:write`);
          candidates.add(`delivery:${moduleName}:manage`);
        }
        if (action === 'write') {
          candidates.add(`${moduleName}:manage`);
          candidates.add(`delivery:${moduleName}:manage`);
        }

        for (const candidate of candidates) {
          if (permissions.includes(candidate)) return true;
        }
        return (
          permissions.includes(`${moduleName}:*`) ||
          permissions.includes(`delivery:${moduleName}:*`) ||
          permissions.includes('delivery:*') ||
          permissions.includes('*')
        );
      },

      isOwner: () => {
        const { seller } = get();
        return seller?.role === 'OWNER';
      },
    }),
    {
      name: 'nongmai-delivery-seller-auth',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        seller: state.seller,
      }),
      onRehydrateStorage: () => (state) => {
        // hydrate 后检查 token 是否已过期，过期则清除
        if (state?.token && isTokenExpired(state.token)) {
          state.clearAuth();
        }
      },
    },
  ),
);

export default useAuthStore;
