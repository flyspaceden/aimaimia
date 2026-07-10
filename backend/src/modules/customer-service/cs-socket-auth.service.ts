import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { SUPER_ADMIN_ROLE } from '../admin/common/constants';

export type CsSocketIdentity =
  | { userId: string }
  | { adminId: string; canRead: boolean; canManage: boolean };

@Injectable()
export class CsSocketAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async authenticate(token: string): Promise<CsSocketIdentity> {
    let buyerPayload: { sub: string; sessionId?: string } | null = null;
    try {
      buyerPayload = this.jwtService.verify<{ sub: string; sessionId?: string }>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      // Admin tokens use an independent secret and are checked below.
    }

    if (buyerPayload) {
      const [user, buyerSession] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: buyerPayload.sub },
          select: { status: true },
        }),
        this.prisma.session.findFirst({
          where: {
            ...(buyerPayload.sessionId ? { id: buyerPayload.sessionId } : {}),
            userId: buyerPayload.sub,
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        }),
      ]);
      if (!user || user.status !== 'ACTIVE') {
        throw new ForbiddenException('买家账号不可用');
      }
      if (!buyerSession) throw new UnauthorizedException('会话已过期或已注销');
      return { userId: buyerPayload.sub };
    }

    let adminPayload: { sub: string; sessionId?: string };
    try {
      adminPayload = this.jwtService.verify<{ sub: string; sessionId?: string }>(token, {
        secret: this.configService.getOrThrow<string>('ADMIN_JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('登录凭证无效');
    }

    const [adminSession, admin] = await Promise.all([
      this.prisma.adminSession.findFirst({
        where: {
          ...(adminPayload.sessionId ? { id: adminPayload.sessionId } : {}),
          adminUserId: adminPayload.sub,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      }),
      this.prisma.adminUser.findUnique({
        where: { id: adminPayload.sub },
        select: {
          status: true,
          userRoles: {
            select: {
              role: {
                select: {
                  name: true,
                  rolePermissions: {
                    select: { permission: { select: { code: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    ]);
    if (!adminSession) throw new UnauthorizedException('会话已过期或已注销');
    if (!admin || admin.status !== 'ACTIVE') {
      throw new ForbiddenException('管理员账号已被禁用');
    }

    const roles = admin.userRoles.map(({ role }) => role.name);
    const permissions = new Set(
      admin.userRoles.flatMap(({ role }) => (
        role.rolePermissions.map(({ permission }) => permission.code)
      )),
    );
    const isSuperAdmin = roles.includes(SUPER_ADMIN_ROLE);
    const canRead = isSuperAdmin || permissions.has('cs:read');
    if (!canRead) throw new ForbiddenException('暂无客服中心访问权限');

    return {
      adminId: adminPayload.sub,
      canRead,
      canManage: isSuperAdmin || permissions.has('cs:manage'),
    };
  }
}
