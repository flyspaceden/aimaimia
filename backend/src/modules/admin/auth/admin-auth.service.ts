import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminRefreshDto } from './dto/admin-refresh.dto';
import { maskIp } from '../../../common/security/privacy-mask';

@Injectable()
export class AdminAuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {
    this.jwtSecret = this.config.getOrThrow<string>('ADMIN_JWT_SECRET');
    this.jwtExpiresIn = this.config.get<string>(
      'ADMIN_JWT_EXPIRES_IN',
      '8h',
    );
  }

  /** 管理员登录 */
  async login(dto: AdminLoginDto, ip?: string, userAgent?: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { username: dto.username },
      include: {
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!admin) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 账号锁定检查
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const minutes = Math.ceil(
        (admin.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(`账号已锁定，请${minutes}分钟后重试`);
    }

    // 账号状态检查
    if (admin.status === 'DISABLED') {
      throw new ForbiddenException('账号已被禁用');
    }

    // 密码验证
    const valid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!valid) {
      // L12修复：原子递增 loginFailCount，防止并发登录尝试绕过锁定
      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: { loginFailCount: { increment: 1 } },
      });
      // 原子判断是否达到锁定阈值：仅当 loginFailCount >= 5 时执行锁定
      const locked = await this.prisma.adminUser.updateMany({
        where: { id: admin.id, loginFailCount: { gte: 5 } },
        data: {
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000),
          loginFailCount: 0,
        },
      });
      if (locked.count > 0) {
        throw new ForbiddenException('登录失败次数过多，账号已锁定30分钟');
      }
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 重置登录失败计数
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        loginFailCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      },
    });

    // 记录审计日志
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId: admin.id,
        action: 'LOGIN',
        module: 'auth',
        summary: `管理员 ${admin.username} 登录`,
        ip,
        userAgent,
        isReversible: false,
      },
    });

    return this.issueTokens(admin, ip, userAgent);
  }

  /** 刷新 Token */
  async refresh(dto: AdminRefreshDto) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);
    const now = new Date();

    const session = await this.prisma.adminSession.findFirst({
      where: {
        refreshTokenHash,
        expiresAt: { gt: now },
        // L1修复：检查最大续期上限
        OR: [
          { absoluteExpiresAt: null },
          { absoluteExpiresAt: { gt: now } },
        ],
      },
      include: {
        adminUser: {
          include: {
            userRoles: { include: { role: true } },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    // S10延伸修复：CAS 原子失效旧 session，防止并发重复刷新
    const cas = await this.prisma.adminSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });
    if (cas.count === 0) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    // L1修复：继承旧 session 的 absoluteExpiresAt，防止无限续期
    return this.issueTokens(
      session.adminUser,
      session.ip,
      session.userAgent,
      session.absoluteExpiresAt,
    );
  }

  /** 登出 */
  async logout(adminUserId: string, ip?: string, userAgent?: string) {
    // 失效该管理员所有活跃 session（保留记录供审计追溯）
    await this.prisma.adminSession.updateMany({
      where: { adminUserId, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    // 记录审计日志
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'LOGOUT',
        module: 'auth',
        summary: '管理员登出',
        ip,
        userAgent,
        isReversible: false,
      },
    });

    return { ok: true };
  }

  /** 获取当前管理员信息 */
  async getProfile(adminUserId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      include: {
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

    if (!admin) {
      throw new UnauthorizedException('管理员不存在');
    }

    const roles = admin.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        admin.userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    ];

    return {
      id: admin.id,
      username: admin.username,
      realName: admin.realName,
      status: admin.status,
      roles,
      permissions,
      lastLoginAt: admin.lastLoginAt,
      lastLoginIp: admin.lastLoginIp,
      lastLoginIpMasked: maskIp(admin.lastLoginIp),
    };
  }

  // ---- 内部方法 ----

  private async issueTokens(
    admin: any,
    ip?: string | null,
    userAgent?: string | null,
    inheritedAbsoluteExpiresAt?: Date | null,
  ) {
    const roles = admin.userRoles.map((ur: any) => ur.role.name);

    // 查询权限码写入 JWT（用于前端展示/兼容；服务端权限判定以 PermissionGuard 实时查库为准）
    const rolePermissions = await this.prisma.adminRolePermission.findMany({
      where: {
        role: {
          userRoles: { some: { adminUserId: admin.id } },
        },
      },
      include: { permission: true },
    });
    const permissions = [...new Set(rolePermissions.map((rp) => rp.permission.code))];

    const refreshTokenStr = randomBytes(64).toString('hex');
    const refreshTokenHash = this.hashToken(refreshTokenStr);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 天

    // L1修复：首次登录设 90 天绝对上限；refresh 时继承旧值，不可重置
    const absoluteExpiresAt = inheritedAbsoluteExpiresAt
      ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const session = await this.prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        refreshTokenHash,
        ip: ip || null,
        userAgent: userAgent || null,
        expiresAt: refreshExpiresAt,
        absoluteExpiresAt,
      },
    });

    const payload = {
      sub: admin.id,
      type: 'admin' as const,
      roles,
      permissions,
      sessionId: session.id,
    };

    const accessToken = this.jwt.sign(payload as any, {
      secret: this.jwtSecret,
      expiresIn: this.jwtExpiresIn as any,
    });

    return {
      accessToken,
      refreshToken: refreshTokenStr,
      expiresIn: this.jwtExpiresIn,
      admin: {
        id: admin.id,
        username: admin.username,
        realName: admin.realName,
        roles,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
