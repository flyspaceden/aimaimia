import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DeliverySellerStaffRole } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';

export type DeliverySellerJwtPayload = {
  sub: string; // DeliverySellerStaff.id
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
      !!payload.merchantId &&
      Array.isArray(payload.permissionCodes);
    if (!hasValidShape) {
      throw new UnauthorizedException('无效的令牌类型');
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
      merchantId: payload.merchantId,
      role: payload.role,
      permissionCodes: payload.permissionCodes,
      type: payload.type,
    };
  }
}
