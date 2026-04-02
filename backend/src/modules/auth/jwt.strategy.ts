import { Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
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
   * 校验通过后，payload 挂载到 request.user；封禁用户拦截
   * M06 修复：检查 Session 是否仍有效，确保注销后 JWT 不再可用
   */
  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (!user || user.status === 'BANNED') {
      throw new ForbiddenException('账号已被封禁');
    }

    // M06修复：精确校验当前 token 对应的 Session，而非用户的任意活跃会话
    // 使用 JWT payload 中的 sessionId 精确匹配，确保设备 1 注销后 token 立即失效，
    // 不会因为设备 2 存在活跃会话而被放行
    if (payload.sessionId) {
      // 新版 token：包含 sessionId，精确匹配
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
    } else {
      // 兼容旧版 token（无 sessionId）：回退到用户级别检查
      const session = await this.prisma.session.findFirst({
        where: {
          userId: payload.sub,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
      });
      if (!session) {
        throw new UnauthorizedException('会话已过期或已注销');
      }
    }

    return { sub: payload.sub };
  }
}
