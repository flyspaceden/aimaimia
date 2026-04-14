import { Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CompanyStaffRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export type SellerJwtPayload = {
  sub: string;            // CompanyStaff.id
  userId: string;         // User.id
  companyId: string;      // Company.id
  role: CompanyStaffRole; // 员工角色
  type: 'seller';
  sessionId?: string;     // 卖家会话 ID（用于校验 logout/refresh 后立即失效）
};

@Injectable()
export class SellerJwtStrategy extends PassportStrategy(Strategy, 'seller-jwt') {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('SELLER_JWT_SECRET'),
    });
  }

  async validate(payload: SellerJwtPayload) {
    // C07: 令牌类型校验，防止买家/管理员 token 误用
    if (payload.type !== 'seller') {
      throw new UnauthorizedException('无效的令牌类型');
    }

    const now = new Date();

    // 新版 token：带 sessionId，精确校验会话是否仍有效
    if (payload.sessionId) {
      const session = await this.prisma.sellerSession.findFirst({
        where: {
          id: payload.sessionId,
          staffId: payload.sub,
          expiresAt: { gt: now },
        },
      });
      if (!session) {
        throw new UnauthorizedException('会话已过期或已注销');
      }
    } else {
      // 兼容旧版 token（无 sessionId）：降级为员工维度会话检查
      const session = await this.prisma.sellerSession.findFirst({
        where: {
          staffId: payload.sub,
          expiresAt: { gt: now },
        },
      });
      if (!session) {
        throw new UnauthorizedException('会话已过期或已注销');
      }
    }

    // 同步校验员工状态，避免离职/禁用后旧 Access Token 继续使用
    // C08: 同时校验 companyId 是否与令牌一致，防止员工转移企业后旧 token 越权
    const staff = await this.prisma.companyStaff.findUnique({
      where: { id: payload.sub },
      select: { status: true, companyId: true },
    });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new ForbiddenException('员工账号已被禁用');
    }
    if (staff.companyId !== payload.companyId) {
      throw new UnauthorizedException('企业信息已变更，请重新登录');
    }

    return {
      sub: payload.sub,
      userId: payload.userId,
      companyId: payload.companyId,
      role: payload.role,
      type: payload.type,
      sessionId: payload.sessionId,
    };
  }
}
