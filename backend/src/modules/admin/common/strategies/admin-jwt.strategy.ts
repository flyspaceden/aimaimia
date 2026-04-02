import { Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../../prisma/prisma.service';

export type AdminJwtPayload = {
  sub: string; // adminUserId
  type: 'admin';
  roles: string[]; // 角色名称列表
  permissions: string[]; // 权限码列表
  sessionId?: string; // 管理员会话 ID（用于校验 logout/refresh 后立即失效）
};

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('ADMIN_JWT_SECRET'),
    });
  }

  async validate(payload: AdminJwtPayload) {
    const now = new Date();

    if (payload.sessionId) {
      const session = await this.prisma.adminSession.findFirst({
        where: {
          id: payload.sessionId,
          adminUserId: payload.sub,
          expiresAt: { gt: now },
        },
      });
      if (!session) {
        throw new UnauthorizedException('会话已过期或已注销');
      }
    } else {
      // 兼容旧版 token（无 sessionId）
      const session = await this.prisma.adminSession.findFirst({
        where: {
          adminUserId: payload.sub,
          expiresAt: { gt: now },
        },
      });
      if (!session) {
        throw new UnauthorizedException('会话已过期或已注销');
      }
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (!admin || admin.status !== 'ACTIVE') {
      throw new ForbiddenException('管理员账号已被禁用');
    }

    return {
      sub: payload.sub,
      type: payload.type,
      roles: payload.roles,
      permissions: payload.permissions,
      sessionId: payload.sessionId,
    };
  }
}
