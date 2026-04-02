import type { ReactNode } from 'react';
import useAuthStore from '@/store/useAuthStore';

interface PermissionGateProps {
  /** 所需权限码，如 'orders:ship' */
  permission: string;
  children: ReactNode;
  /** 无权限时的替代内容 */
  fallback?: ReactNode;
}

/** 按权限条件渲染 UI（按钮/菜单/操作列） */
export default function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  if (hasPermission(permission)) {
    return <>{children}</>;
  }
  return <>{fallback}</>;
}
