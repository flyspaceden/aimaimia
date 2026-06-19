import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { DeliveryUserStatus, Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryUserJwtPayload } from '../auth/delivery-user-jwt.strategy';
import { DeliveryIdService } from '../common/delivery-id.service';
import { PhoneLoginDto } from './dto/phone-login.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';
import { DeliveryPhoneOtpService } from './delivery-phone-otp.service';

const deliveryUserProfileSelect = {
  id: true,
  phone: true,
  nickname: true,
  avatarUrl: true,
  status: true,
  currentUnitId: true,
  units: {
    select: {
      id: true,
    },
  },
  currentUnit: {
    select: {
      id: true,
      name: true,
      contactName: true,
      contactPhone: true,
      provinceCode: true,
      provinceName: true,
      cityCode: true,
      cityName: true,
      districtCode: true,
      districtName: true,
      detailAddress: true,
      extraFields: true,
      status: true,
    },
  },
} satisfies Prisma.DeliveryUserSelect;

type DeliveryUserProfile = Prisma.DeliveryUserGetPayload<{
  select: typeof deliveryUserProfileSelect;
}>;

type DeliveryLoginMethod = 'PHONE' | 'WECHAT';
type DeliveryAuthRequestMeta = {
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class DeliveryBuyerAuthService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly deliveryIdService: DeliveryIdService,
    private readonly deliveryPhoneOtpService: DeliveryPhoneOtpService,
  ) {}

  async phoneLogin(dto: PhoneLoginDto, ip?: string, userAgent?: string) {
    await this.deliveryPhoneOtpService.verifyPhoneLoginCode(dto.phone, dto.code, {
      ip,
      userAgent,
    });

    const user = await this.deliveryPrisma.$transaction(
      async (tx) => {
        const now = new Date();
        const identity = await tx.deliveryAuthIdentity.findUnique({
          where: {
            provider_providerSubject: {
              provider: 'PHONE',
              providerSubject: dto.phone,
            },
          },
        });

        let deliveryUserId = identity?.userId;
        if (!deliveryUserId) {
          deliveryUserId = await this.deliveryIdService.next('PSYH');
          await tx.deliveryUser.create({
            data: {
              id: deliveryUserId,
              phone: dto.phone,
              nickname: dto.nickname?.trim() || null,
              avatarUrl: dto.avatarUrl?.trim() || null,
              lastLoginAt: now,
            },
          });
          await tx.deliveryAuthIdentity.create({
            data: {
              userId: deliveryUserId,
              provider: 'PHONE',
              providerSubject: dto.phone,
              phone: dto.phone,
            },
          });
        } else {
          await this.assertUserActive(tx, deliveryUserId);
          await tx.deliveryUser.update({
            where: { id: deliveryUserId },
            data: {
              phone: dto.phone,
              nickname: dto.nickname?.trim() || undefined,
              avatarUrl: dto.avatarUrl?.trim() || undefined,
              lastLoginAt: now,
            },
          });
        }

        return tx.deliveryUser.findUnique({
          where: { id: deliveryUserId },
          select: deliveryUserProfileSelect,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return this.issueLoginResult(user, 'PHONE', { ip, userAgent });
  }

  async wechatLogin(dto: WechatLoginDto, ip?: string, userAgent?: string) {
    const { openId: providerSubject } = await this.resolveWechatIdentity(dto.code);

    const user = await this.deliveryPrisma.$transaction(
      async (tx) => {
        const now = new Date();
        const existingWechatIdentity = await tx.deliveryAuthIdentity.findUnique({
          where: {
            provider_providerSubject: {
              provider: 'WECHAT',
              providerSubject,
            },
          },
        });

        let deliveryUserId = existingWechatIdentity?.userId;
        if (!deliveryUserId) {
          deliveryUserId = await this.deliveryIdService.next('PSYH');
          await tx.deliveryUser.create({
            data: {
              id: deliveryUserId,
              phone: null,
              nickname: dto.nickname?.trim() || null,
              avatarUrl: dto.avatarUrl?.trim() || null,
              lastLoginAt: now,
            },
          });
        } else {
          await this.assertUserActive(tx, deliveryUserId);
          await tx.deliveryUser.update({
            where: { id: deliveryUserId },
            data: {
              nickname: dto.nickname?.trim() || undefined,
              avatarUrl: dto.avatarUrl?.trim() || undefined,
              lastLoginAt: now,
            },
          });
        }

        if (!existingWechatIdentity) {
          await tx.deliveryAuthIdentity.create({
            data: {
              userId: deliveryUserId,
              provider: 'WECHAT',
              providerSubject,
              phone: null,
            },
          });
        }

        return tx.deliveryUser.findUnique({
          where: { id: deliveryUserId },
          select: deliveryUserProfileSelect,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return this.issueLoginResult(user, 'WECHAT', { ip, userAgent });
  }

  async getMe(deliveryUserId: string) {
    const user = await this.deliveryPrisma.deliveryUser.findUnique({
      where: { id: deliveryUserId },
      select: deliveryUserProfileSelect,
    });

    if (!user) {
      throw new NotFoundException('配送用户不存在');
    }

    return this.mapProfile(user);
  }

  private async issueLoginResult(
    user: DeliveryUserProfile | null,
    loginMethod: DeliveryLoginMethod,
    meta: DeliveryAuthRequestMeta,
  ) {
    if (!user) {
      throw new NotFoundException('配送用户不存在');
    }

    const session = await this.deliveryPrisma.deliveryUserSession.create({
      data: {
        userId: user.id,
        loginMethod,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt: this.resolveSessionExpiresAt(),
      },
    });

    const payload: DeliveryUserJwtPayload = {
      sub: user.id,
      type: 'delivery-user',
      sessionId: session.id,
    };
    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      ...this.mapProfile(user),
    };
  }

  private mapProfile(user: DeliveryUserProfile) {
    const requiresUnit = user.units.length === 0;

    return {
      requiresUnit,
      currentUnitId: user.currentUnitId,
      currentUnit: user.currentUnit ? this.mapUnit(user.currentUnit) : null,
      user: {
        id: user.id,
        phone: user.phone,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        status: user.status,
      },
    };
  }

  private mapUnit(unit: {
    id: string;
    name: string;
    contactName: string;
    contactPhone: string;
    provinceCode: string;
    provinceName: string;
    cityCode: string;
    cityName: string;
    districtCode: string;
    districtName: string;
    detailAddress: string;
    extraFields: Prisma.JsonValue | null;
    status: string;
  }) {
    return {
      id: unit.id,
      name: unit.name,
      contactName: unit.contactName,
      contactPhone: unit.contactPhone,
      provinceCode: unit.provinceCode,
      provinceName: unit.provinceName,
      cityCode: unit.cityCode,
      cityName: unit.cityName,
      districtCode: unit.districtCode,
      districtName: unit.districtName,
      detailAddress: unit.detailAddress,
      extraFields: unit.extraFields,
      status: unit.status,
    };
  }

  private async assertUserActive(tx: Prisma.TransactionClient, deliveryUserId: string) {
    const user = await tx.deliveryUser.findUnique({
      where: { id: deliveryUserId },
      select: { status: true },
    });

    if (!user) {
      throw new NotFoundException('配送用户不存在');
    }

    if (user.status !== DeliveryUserStatus.ACTIVE) {
      throw new ForbiddenException('配送用户账号已被禁用');
    }
  }

  private async resolveWechatIdentity(code: string): Promise<{ openId: string; unionId: string }> {
    if (this.isWechatMockEnabled()) {
      return {
        openId: createHash('sha256').update(`wx_openid_${code}`).digest('hex').slice(0, 28),
        unionId: createHash('sha256').update(`wx_unionid_${code}`).digest('hex').slice(0, 28),
      };
    }

    const appId = this.configService.getOrThrow<string>('WECHAT_APP_ID');
    const appSecret = this.configService.getOrThrow<string>('WECHAT_APP_SECRET');
    const tokenUrl =
      `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(appSecret)}` +
      `&code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';

    let tokenData: {
      access_token?: string;
      openid?: string;
      unionid?: string;
      errcode?: number;
      errmsg?: string;
    };

    try {
      const tokenRes = await fetch(tokenUrl);
      tokenData = (await tokenRes.json()) as typeof tokenData;
    } catch {
      throw new BadRequestException('微信授权失败');
    }

    if (tokenData.errcode || !tokenData.openid) {
      throw new BadRequestException(`微信授权失败：${tokenData.errmsg || '未知错误'}`);
    }

    return {
      openId: tokenData.openid,
      unionId: tokenData.unionid || '',
    };
  }

  private isWechatMockEnabled() {
    return this.configService.get('DELIVERY_WECHAT_MOCK') === 'true';
  }

  private resolveSessionExpiresAt() {
    const rawExpiresIn = this.configService.get<string>('DELIVERY_USER_JWT_EXPIRES_IN', '8h');
    const match = /^(\d+)([smhd]?)$/i.exec(rawExpiresIn.trim());
    if (!match) {
      return new Date(Date.now() + 8 * 60 * 60 * 1000);
    }

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier =
      unit === 'd'
        ? 24 * 60 * 60 * 1000
        : unit === 'h'
          ? 60 * 60 * 1000
          : unit === 'm'
            ? 60 * 1000
            : 1000;

    return new Date(Date.now() + value * multiplier);
  }

}
