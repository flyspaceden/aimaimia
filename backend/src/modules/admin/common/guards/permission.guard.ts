import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission';
import { SUPER_ADMIN_ROLE } from '../constants';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 无权限要求则放行
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const admin = request.user;

    if (!admin || admin.type !== 'admin') {
      throw new ForbiddenException('需要管理员身份');
    }

    const adminUser = await this.prisma.adminUser.findUnique({
      where: { id: admin.sub },
      select: {
        status: true,
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!adminUser || adminUser.status !== 'ACTIVE') {
      throw new ForbiddenException('管理员账号已被禁用');
    }

    const roles = adminUser.userRoles.map((ur) => ur.role.name);
    const permissionCodes = [
      ...new Set(
        adminUser.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    ];

    // M6修复：使用数据库实时角色/权限覆盖 JWT 中的缓存权限，角色变更后立即生效
    request.user = {
      ...admin,
      roles,
      permissions: permissionCodes,
    };

    // 超级管理员直接放行（实时角色）
    if (roles.includes(SUPER_ADMIN_ROLE)) {
      return true;
    }

    if (!permissionCodes.includes(requiredPermission)) {
      throw new ForbiddenException('暂无该操作权限');
    }

    return true;
  }
}
