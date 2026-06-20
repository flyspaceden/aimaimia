import { SetMetadata } from '@nestjs/common';

export const DELIVERY_ADMIN_PERMISSIONS_KEY = 'delivery_admin_permissions';

export const RequireDeliveryAdminPermission = (...permissions: string[]) =>
  SetMetadata(DELIVERY_ADMIN_PERMISSIONS_KEY, permissions);
