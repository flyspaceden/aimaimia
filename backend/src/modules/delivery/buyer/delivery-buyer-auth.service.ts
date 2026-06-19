import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '../../../generated/delivery-client';
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

@Injectable()
export class DeliveryBuyerAuthService {
  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly jwtService: JwtService,
    private readonly deliveryIdService: DeliveryIdService,
    private readonly deliveryPhoneOtpService: DeliveryPhoneOtpService,
  ) {}

  async phoneLogin(dto: PhoneLoginDto, _ip?: string, _userAgent?: string) {
    await this.deliveryPhoneOtpService.verifyPhoneLoginCode(dto.phone, dto.code);

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

    return this.issueLoginResult(user);
  }

  async wechatLogin(dto: WechatLoginDto, _ip?: string, _userAgent?: string) {
    const providerSubject = dto.openid;

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

    return this.issueLoginResult(user);
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

  private async issueLoginResult(user: DeliveryUserProfile | null) {
    if (!user) {
      throw new NotFoundException('配送用户不存在');
    }

    const payload: DeliveryUserJwtPayload = {
      sub: user.id,
      type: 'delivery-user',
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

}
