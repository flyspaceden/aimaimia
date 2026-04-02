import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

/** 标记端点所需权限，如 @RequirePermission('orders:read') */
export const RequirePermission = (permission: string) =>
  SetMetadata(PERMISSION_KEY, permission);
