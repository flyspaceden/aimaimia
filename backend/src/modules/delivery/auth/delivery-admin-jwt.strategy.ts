import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';

export type DeliveryAdminJwtPayload = {
  sub: string; // DeliveryAdminUser.id
  roles: string[];
  permissions: string[];
  type: 'delivery-admin';
};

@Injectable()
export class DeliveryAdminJwtStrategy extends PassportStrategy(Strategy, 'delivery-admin-jwt') {
  constructor(
    configService: ConfigService,
    private readonly deliveryPrisma: DeliveryPrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('DELIVERY_ADMIN_JWT_SECRET'),
    });
  }

  async validate(payload: DeliveryAdminJwtPayload) {
    const hasValidShape =
      payload.type === 'delivery-admin' &&
      !!payload.sub &&
      Array.isArray(payload.roles) &&
      Array.isArray(payload.permissions);
    if (!hasValidShape) {
      throw new UnauthorizedException('无效的令牌类型');
    }

    const deliveryAdmin = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { id: payload.sub },
      select: { status: true },
    });
    if (!deliveryAdmin || deliveryAdmin.status !== 'ACTIVE') {
      throw new ForbiddenException('配送管理账号已被禁用');
    }

    return {
      sub: payload.sub,
      deliveryAdminUserId: payload.sub,
      roles: payload.roles,
      permissions: payload.permissions,
      type: payload.type,
    };
  }
}
