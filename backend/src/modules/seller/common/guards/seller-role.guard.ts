import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const SELLER_ROLES_KEY = 'sellerRoles';

/**
 * 标记端点允许的卖家角色
 * 用法：@SellerRoles('OWNER', 'MANAGER')
 */
import { SetMetadata } from '@nestjs/common';
import { CompanyStaffRole } from '@prisma/client';

export const SellerRoles = (...roles: CompanyStaffRole[]) =>
  SetMetadata(SELLER_ROLES_KEY, roles);

@Injectable()
export class SellerRoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<CompanyStaffRole[]>(
      SELLER_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 无角色要求则放行（只要通过 SellerAuthGuard 即可）
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const seller = request.user;

    if (!seller || seller.type !== 'seller') {
      throw new ForbiddenException('需要卖家身份');
    }

    if (!requiredRoles.includes(seller.role)) {
      throw new ForbiddenException('暂无该操作权限');
    }

    return true;
  }
}
