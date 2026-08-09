import { Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type JwtPayload = {
  sub: string; // userId
  sessionId?: string; // M06修复：会话 ID，用于精确匹配当前 token 对应的 Session
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * 校验通过后，payload 挂载到 request.user；非 ACTIVE 账号一律拒绝
   * M06 修复：检查 Session 是否仍有效，确保注销后 JWT 不再可用
   * 账号注销：DELETED 用户即便持有未过期的旧 JWT 也必须被拒（在 session 校验之前拦截）
   */
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (!user) {
      throw new UnauthorizedException('账号不存在');
    }
    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException('账号已被封禁');
    }
    if (user.status === UserStatus.DELETED) {
      throw new ForbiddenException('账号已注销');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('账号不可用');
    }

    // 所有现行买家 access token 都由 issueTokens/refresh 写入 sessionId，且默认
    // 15 分钟过期。无 sessionId 的历史 token 无法证明所属设备会话；若继续按
    // “该用户任意活跃会话”放行，设备 A 退出后仍可能借设备 B 的会话继续访问。
    // 因此直接要求客户端走现有 refresh 流程换取精确绑定的新 token。
    if (!payload.sessionId) {
      throw new UnauthorizedException('登录凭证版本过旧，请刷新后重试');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: payload.sessionId,
        userId: payload.sub,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });
    if (!session) {
      throw new UnauthorizedException('会话已过期或已注销');
    }
    return {
      sub: payload.sub,
      sessionId: session.id,
      authIdentityId: session.authIdentityId ?? null,
    };
  }
}
