import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';

export type DeliveryUserJwtPayload = {
  sub: string; // DeliveryUser.id
  type: 'delivery-user';
  sessionId?: string;
};

@Injectable()
export class DeliveryUserJwtStrategy extends PassportStrategy(Strategy, 'delivery-user-jwt') {
  constructor(
    configService: ConfigService,
    private readonly deliveryPrisma: DeliveryPrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('DELIVERY_USER_JWT_SECRET'),
    });
  }

  async validate(payload: DeliveryUserJwtPayload) {
    if (payload.type !== 'delivery-user' || !payload.sub) {
      throw new UnauthorizedException('无效的令牌类型');
    }

    const now = new Date();
    if (payload.sessionId) {
      const session = await this.deliveryPrisma.deliveryUserSession.findFirst({
        where: {
          id: payload.sessionId,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      });
      if (!session) {
        throw new UnauthorizedException('会话已过期或已注销');
      }
    }

    const deliveryUser = await this.deliveryPrisma.deliveryUser.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (!deliveryUser || deliveryUser.status !== 'ACTIVE') {
      throw new ForbiddenException('配送用户账号已被禁用');
    }

    return {
      sub: payload.sub,
      deliveryUserId: payload.sub,
      type: payload.type,
      sessionId: payload.sessionId,
    };
  }
}
