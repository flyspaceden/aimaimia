import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DeliverySellerStaffRole } from '../../../../generated/delivery-client';
import { DELIVERY_SELLER_PERMISSIONS_KEY } from '../decorators/require-delivery-seller-permission.decorator';

@Injectable()
export class DeliverySellerPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = this.reflector.getAllAndOverride<string[] | string>(DELIVERY_SELLER_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const required = Array.isArray(metadata) ? metadata : metadata ? [metadata] : [];
    if (!required.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (user?.type !== 'delivery-seller') {
      throw new ForbiddenException('无配送中心权限');
    }
    if (user.role === DeliverySellerStaffRole.OWNER || user.role === 'OWNER') {
      return true;
    }

    const permissions = Array.isArray(user.permissionCodes) ? user.permissionCodes : [];
    const allowed = required.every((permission) => this.hasPermission(permissions, permission));
    if (!allowed) {
      throw new ForbiddenException('无配送中心权限');
    }
    return true;
  }

  private hasPermission(permissions: string[], required: string): boolean {
    const requiredCandidates = new Set<string>();
    for (const candidate of this.expandPermissionCandidates(required)) {
      requiredCandidates.add(candidate);
      if (!candidate.startsWith('delivery:')) {
        requiredCandidates.add(`delivery:${candidate}`);
      }
    }

    for (const candidate of requiredCandidates) {
      if (permissions.includes(candidate)) {
        return true;
      }
      const parts = candidate.split(':');
      if (parts.length >= 2 && permissions.includes(`${parts[0]}:${parts[1]}:*`)) {
        return true;
      }
    }

    const unprefixed = required.startsWith('delivery:') ? required.replace(/^delivery:/, '') : required;
    const moduleName = unprefixed.split(':')[0];
    return permissions.includes(`${moduleName}:*`) || permissions.includes('delivery:*') || permissions.includes('*');
  }

  private expandPermissionCandidates(required: string): string[] {
    const unprefixed = required.startsWith('delivery:') ? required.replace(/^delivery:/, '') : required;
    const parts = unprefixed.split(':');
    if (parts.length < 2) {
      return [required, unprefixed];
    }

    const [moduleName, action] = parts;
    const candidates = new Set([required, unprefixed]);
    if (action === 'read') {
      candidates.add(`${moduleName}:write`);
      candidates.add(`${moduleName}:manage`);
    }
    if (action === 'write') {
      candidates.add(`${moduleName}:manage`);
    }
    return Array.from(candidates);
  }
}
