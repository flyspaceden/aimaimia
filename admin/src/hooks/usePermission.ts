import useAuthStore from '@/store/useAuthStore';

/** 权限检查 hook */
export function usePermission() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  return { hasPermission, isSuperAdmin };
}
