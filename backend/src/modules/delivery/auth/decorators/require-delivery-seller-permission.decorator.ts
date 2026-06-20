import { SetMetadata } from '@nestjs/common';

export const DELIVERY_SELLER_PERMISSIONS_KEY = 'delivery_seller_permissions';

export const RequireDeliverySellerPermission = (...permissions: string[]) =>
  SetMetadata(DELIVERY_SELLER_PERMISSIONS_KEY, permissions);
