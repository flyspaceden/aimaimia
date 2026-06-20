import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DELIVERY_ADMIN_PERMISSIONS_KEY } from '../decorators/require-delivery-admin-permission.decorator';

@Injectable()
export class DeliveryAdminPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = this.reflector.getAllAndOverride<string[] | string>(DELIVERY_ADMIN_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const required = Array.isArray(metadata) ? metadata : metadata ? [metadata] : [];
    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (user?.type !== 'delivery-admin') {
      throw new ForbiddenException('无配送管理后台权限');
    }

    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    const allowed = required.every((permission) => this.hasPermission(permissions, permission));
    if (!allowed) {
      throw new ForbiddenException('无配送管理后台权限');
    }
    return true;
  }

  private hasPermission(permissions: string[], required: string): boolean {
    if (permissions.includes(required) || permissions.includes('delivery:*')) {
      return true;
    }
    const parts = required.split(':');
    if (parts.length >= 2) {
      const moduleWildcard = `${parts[0]}:${parts[1]}:*`;
      if (permissions.includes(moduleWildcard)) {
        return true;
      }
    }
    return false;
  }
}
