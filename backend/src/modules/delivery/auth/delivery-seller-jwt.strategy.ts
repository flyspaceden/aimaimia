import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DeliverySellerStaffRole } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';

export type DeliverySellerJwtPayload = {
  sub: string; // DeliverySellerStaff.id
  sessionId: string; // DeliverySellerSession.id
  merchantId: string; // DeliveryMerchant.id
  role: DeliverySellerStaffRole;
  permissionCodes: string[];
  type: 'delivery-seller';
};

@Injectable()
export class DeliverySellerJwtStrategy extends PassportStrategy(Strategy, 'delivery-seller-jwt') {
  constructor(
    configService: ConfigService,
    private readonly deliveryPrisma: DeliveryPrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('DELIVERY_SELLER_JWT_SECRET'),
    });
  }

  async validate(payload: DeliverySellerJwtPayload) {
    const hasValidShape =
      payload.type === 'delivery-seller' &&
      !!payload.sub &&
      !!payload.sessionId &&
      !!payload.merchantId &&
      !!payload.role &&
      Array.isArray(payload.permissionCodes);
    if (!hasValidShape) {
      throw new UnauthorizedException('无效的令牌类型');
    }

    const validSellerRoles = new Set(Object.values(DeliverySellerStaffRole));
    if (!validSellerRoles.has(payload.role)) {
      throw new UnauthorizedException('无效的卖家角色');
    }

    const session = await this.deliveryPrisma.deliverySellerSession.findFirst({
      where: {
        id: payload.sessionId,
        staffId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!session) {
      throw new UnauthorizedException('登录态已失效，请重新登录');
    }

    const staff = await this.deliveryPrisma.deliverySellerStaff.findUnique({
      where: { id: payload.sub },
      select: { status: true, merchantId: true },
    });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new ForbiddenException('配送中心账号已被禁用');
    }
    if (staff.merchantId !== payload.merchantId) {
      throw new UnauthorizedException('商家信息已变更，请重新登录');
    }

    return {
      sub: payload.sub,
      deliverySellerStaffId: payload.sub,
      sessionId: payload.sessionId,
      merchantId: payload.merchantId,
      role: payload.role,
      permissionCodes: payload.permissionCodes,
      type: payload.type,
    };
  }
}
