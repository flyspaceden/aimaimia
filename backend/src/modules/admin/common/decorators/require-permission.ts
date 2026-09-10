import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';
export const PERMISSION_ANY_KEY = 'requiredPermissionsAny';

/** 标记端点所需权限，如 @RequirePermission('orders:read') */
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);

/** 标记端点所需权限中的任意一个，如 @RequireAnyPermission(['a:read', 'b:read']) */
export const RequireAnyPermission = (permissions: string[]) =>
  SetMetadata(PERMISSION_ANY_KEY, permissions);
