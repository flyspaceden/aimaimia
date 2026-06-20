import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { maskPhone } from '../../../common/security/privacy-mask';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';
import {
  DeliveryOtpPurpose,
  DeliverySellerStaffRole,
  DeliverySellerStaffStatus,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySellerJwtPayload } from '../auth/delivery-seller-jwt.strategy';
import {
  DeliverySellerBindPhoneSmsCodeDto,
  DeliverySellerChangeNicknameDto,
  DeliverySellerChangePasswordDto,
  DeliverySellerChangePhoneDto,
  DeliverySellerLoginDto,
  DeliverySellerPasswordLoginDto,
  DeliverySellerRefreshDto,
  DeliverySellerSelectCompanyDto,
  DeliverySellerSmsCodeDto,
} from './delivery-seller-auth.dto';
import {
  DeliverySellerListCompaniesForResetDto,
  DeliverySellerResetForgotPasswordDto,
  DeliverySellerSendForgotPasswordCodeDto,
} from './dto/delivery-seller-forgot-password.dto';

const DUMMY_PASSWORD_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

type DeliveryAuthRequestMeta = {
  ip?: string;
  userAgent?: string;
};

type DeliverySellerStaffWithMerchant = {
  id: string;
  merchantId: string;
  phone: string | null;
  passwordHash: string | null;
  realName: string | null;
  role: DeliverySellerStaffRole;
  permissionCodes: string[];
  status: DeliverySellerStaffStatus;
  merchant: {
    id: string;
    name: string;
    shortName: string | null;
    status: string;
  };
};

type DeliverySellerTempTokenPayload = {
  sub: string;
  type: 'delivery-seller-temp';
  staffIds: string[];
};

@Injectable()
export class DeliverySellerAuthService {
  private readonly logger = new Logger(DeliverySellerAuthService.name);
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly aliyunSmsService: AliyunSmsService,
  ) {
    this.jwtSecret = this.configService.getOrThrow<string>('DELIVERY_SELLER_JWT_SECRET');
    this.jwtExpiresIn = this.configService.get<string>('DELIVERY_SELLER_JWT_EXPIRES_IN', '8h');
  }

  async sendSmsCode(dto: DeliverySellerSmsCodeDto, _ip?: string) {
    await this.issueOtp(dto.phone, DeliveryOtpPurpose.LOGIN);
    return { ok: true };
  }

  async login(dto: DeliverySellerLoginDto, ip?: string, userAgent?: string) {
    await this.verifyOtpOrThrow({
      phone: dto.phone,
      code: dto.code,
      purpose: DeliveryOtpPurpose.LOGIN,
      consume: true,
    });

    const staffs = await this.listActiveStaffsByPhone(dto.phone);
    if (staffs.length === 0) {
      throw new UnauthorizedException('账号或验证码错误');
    }

    if (staffs.length === 1) {
      return this.issueTokens(staffs[0], { ip, userAgent });
    }

    return this.buildCompanySelection(staffs);
  }

  async loginByPassword(dto: DeliverySellerPasswordLoginDto, ip?: string, userAgent?: string) {
    const staffs = await this.listActiveStaffsByPhone(dto.phone);
    if (staffs.length === 0) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH).catch(() => false);
      throw new UnauthorizedException('账号或密码错误');
    }

    let matchedStaff: DeliverySellerStaffWithMerchant | null = null;
    for (const staff of staffs) {
      if (!staff.passwordHash) {
        continue;
      }
      if (await bcrypt.compare(dto.password, staff.passwordHash)) {
        matchedStaff = staff;
        break;
      }
    }

    if (!matchedStaff) {
      if (!staffs.some((staff) => !!staff.passwordHash)) {
        await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH).catch(() => false);
      }
      throw new UnauthorizedException('账号或密码错误');
    }

    return this.issueTokens(matchedStaff, { ip, userAgent });
  }

  async selectCompany(dto: DeliverySellerSelectCompanyDto, ip?: string, userAgent?: string) {
    let decoded: DeliverySellerTempTokenPayload;
    try {
      decoded = this.jwtService.verify(dto.tempToken, {
        secret: this.jwtSecret,
      }) as DeliverySellerTempTokenPayload;
    } catch {
      throw new UnauthorizedException('临时令牌已失效，请重新登录');
    }

    if (
      decoded.type !== 'delivery-seller-temp' ||
      !Array.isArray(decoded.staffIds) ||
      decoded.staffIds.length === 0
    ) {
      throw new UnauthorizedException('无效的临时令牌');
    }

    const staff = await this.deliveryPrisma.deliverySellerStaff.findFirst({
      where: {
        AND: [{ id: dto.staffId }, { id: { in: decoded.staffIds } }],
        merchantId: dto.companyId,
        status: DeliverySellerStaffStatus.ACTIVE,
        merchant: {
          is: {
            status: 'ACTIVE',
          },
        },
      },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            shortName: true,
            status: true,
          },
        },
      },
    });

    if (!staff) {
      throw new ForbiddenException('您不是该商家的有效员工');
    }

    return this.issueTokens(staff as DeliverySellerStaffWithMerchant, { ip, userAgent });
  }

  async refresh(dto: DeliverySellerRefreshDto) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);
    const now = new Date();
    const session = await this.deliveryPrisma.deliverySellerSession.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        staff: {
          include: {
            merchant: {
              select: {
                id: true,
                name: true,
                shortName: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('刷新令牌已失效');
    }
    if (session.staff.status !== DeliverySellerStaffStatus.ACTIVE) {
      throw new ForbiddenException('配送中心账号已被禁用');
    }
    if (session.staff.merchant.status !== 'ACTIVE') {
      throw new ForbiddenException('配送中心商家已停用，请联系平台管理员');
    }

    const cas = await this.deliveryPrisma.deliverySellerSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        revokedAt: now,
      },
    });
    if (cas.count === 0) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    return this.issueTokens(session.staff as DeliverySellerStaffWithMerchant, {
      ip: session.ip ?? undefined,
      userAgent: session.userAgent ?? undefined,
    });
  }

  async logout(sessionId: string) {
    await this.deliveryPrisma.deliverySellerSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        revokedAt: new Date(),
      },
    });
    return { ok: true };
  }

  async getMe(staffId: string) {
    const staff = await this.deliveryPrisma.deliverySellerStaff.findUnique({
      where: { id: staffId },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            shortName: true,
            status: true,
          },
        },
      },
    });

    if (!staff) {
      throw new UnauthorizedException('配送中心账号不存在');
    }

    return this.mapProfile(staff as DeliverySellerStaffWithMerchant);
  }

  async changePassword(staffId: string, dto: DeliverySellerChangePasswordDto) {
    const staff = await this.deliveryPrisma.deliverySellerStaff.findUnique({
      where: { id: staffId },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            shortName: true,
            status: true,
          },
        },
      },
    });

    if (!staff || !staff.passwordHash) {
      throw new UnauthorizedException('原密码错误');
    }

    const ok = await bcrypt.compare(dto.oldPassword, staff.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('原密码错误');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.deliveryPrisma.deliverySellerStaff.update({
      where: { id: staffId },
      data: {
        passwordHash: newPasswordHash,
      },
    });
    await this.revokeStaffSessions([staffId]);
    return { ok: true };
  }

  async sendBindPhoneSmsCode(staffId: string, dto: DeliverySellerBindPhoneSmsCodeDto) {
    const staff = await this.deliveryPrisma.deliverySellerStaff.findUnique({
      where: { id: staffId },
      select: { id: true, phone: true },
    });
    if (!staff || !staff.phone) {
      throw new BadRequestException('当前账号未绑定手机号，暂不支持自助换绑');
    }
    if (staff.phone === dto.phone) {
      throw new BadRequestException('新手机号不能与当前手机号相同');
    }

    await this.issueOtp(dto.phone, DeliveryOtpPurpose.BIND);
    return { ok: true };
  }

  async changePhone(staffId: string, dto: DeliverySellerChangePhoneDto) {
    const currentStaff = await this.deliveryPrisma.deliverySellerStaff.findUnique({
      where: { id: staffId },
      select: { id: true, phone: true },
    });
    if (!currentStaff || !currentStaff.phone) {
      throw new BadRequestException('当前账号未绑定手机号，暂不支持自助换绑');
    }
    if (dto.newPhone === currentStaff.phone) {
      throw new BadRequestException('新手机号不能与当前手机号相同');
    }

    await this.verifyOtpOrThrow({
      phone: currentStaff.phone,
      code: dto.oldPhoneCode,
      purpose: DeliveryOtpPurpose.LOGIN,
      consume: true,
    });
    await this.verifyOtpOrThrow({
      phone: dto.newPhone,
      code: dto.newPhoneCode,
      purpose: DeliveryOtpPurpose.BIND,
      consume: true,
    });

    await this.deliveryPrisma.deliverySellerStaff.update({
      where: { id: staffId },
      data: {
        phone: dto.newPhone,
      },
    });
    await this.revokeStaffSessions([staffId]);
    return { ok: true };
  }

  async changeNickname(staffId: string, dto: DeliverySellerChangeNicknameDto) {
    const nickname = dto.nickname.trim();
    await this.deliveryPrisma.deliverySellerStaff.update({
      where: { id: staffId },
      data: {
        realName: nickname,
      },
    });

    return {
      ok: true,
      nickname,
    };
  }

  async sendForgotPasswordCode(dto: DeliverySellerSendForgotPasswordCodeDto) {
    await this.issueOtp(dto.phone, DeliveryOtpPurpose.RESET);
    return { success: true };
  }

  async listCompaniesForReset(dto: DeliverySellerListCompaniesForResetDto) {
    await this.verifyOtpOrThrow({
      phone: dto.phone,
      code: dto.code,
      purpose: DeliveryOtpPurpose.RESET,
      consume: false,
      detailedErrors: true,
    });

    const staffs = await this.listActiveStaffsByPhone(dto.phone);
    return {
      success: true,
      companies: staffs.map((staff) => ({
        staffId: staff.id,
        companyId: staff.merchant.id,
        companyName: staff.merchant.name,
        role: staff.role,
      })),
    };
  }

  async resetForgotPassword(dto: DeliverySellerResetForgotPasswordDto) {
    const staffs = await this.listActiveStaffsByPhone(dto.phone);
    const targetStaff = staffs.find((staff) => staff.id === dto.staffId);
    if (!targetStaff) {
      throw new BadRequestException({
        code: 'STAFF_NOT_FOUND',
        message: '请选择有效的企业账号',
      });
    }
    if (targetStaff.phone !== dto.phone) {
      throw new BadRequestException({
        code: 'STAFF_PHONE_MISMATCH',
        message: '该账号与当前手机号不匹配，请重新选择',
      });
    }

    await this.verifyOtpOrThrow({
      phone: dto.phone,
      code: dto.code,
      purpose: DeliveryOtpPurpose.RESET,
      consume: true,
      detailedErrors: true,
    });

    await this.deliveryPrisma.deliverySellerStaff.update({
      where: { id: targetStaff.id },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 10),
      },
    });
    await this.revokeStaffSessions([targetStaff.id]);

    return {
      success: true,
      companyName: targetStaff.merchant.name,
    };
  }

  hashTokenForTest(token: string) {
    return this.hashToken(token);
  }

  private async listActiveStaffsByPhone(phone: string): Promise<DeliverySellerStaffWithMerchant[]> {
    return (await this.deliveryPrisma.deliverySellerStaff.findMany({
      where: {
        phone,
        status: DeliverySellerStaffStatus.ACTIVE,
        merchant: {
          is: {
            status: 'ACTIVE',
          },
        },
      },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            shortName: true,
            status: true,
          },
        },
      },
      orderBy: [{ merchantId: 'asc' }, { createdAt: 'asc' }],
    })) as DeliverySellerStaffWithMerchant[];
  }

  private buildCompanySelection(staffs: DeliverySellerStaffWithMerchant[]) {
    const tempToken = this.jwtService.sign(
      {
        sub: staffs[0].phone ?? staffs[0].id,
        type: 'delivery-seller-temp',
        staffIds: staffs.map((staff) => staff.id),
      } satisfies DeliverySellerTempTokenPayload,
      {
        secret: this.jwtSecret,
        expiresIn: '5m',
      },
    );

    return {
      needSelectCompany: true as const,
      tempToken,
      companies: staffs.map((staff) => ({
        staffId: staff.id,
        companyId: staff.merchant.id,
        companyName: staff.merchant.name,
        shortName: staff.merchant.shortName ?? undefined,
        realName: staff.realName ?? undefined,
        role: staff.role,
        status: staff.merchant.status,
      })),
    };
  }

  private async issueTokens(staff: DeliverySellerStaffWithMerchant, meta: DeliveryAuthRequestMeta) {
    const refreshToken = randomBytes(48).toString('hex');
    const refreshTokenHash = this.hashToken(refreshToken);
    const session = await this.deliveryPrisma.deliverySellerSession.create({
      data: {
        staffId: staff.id,
        refreshTokenHash,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const payload: DeliverySellerJwtPayload = {
      sub: staff.id,
      sessionId: session.id,
      merchantId: staff.merchant.id,
      role: staff.role,
      permissionCodes: staff.permissionCodes ?? [],
      type: 'delivery-seller',
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: this.jwtExpiresIn as any,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwtExpiresIn,
      seller: {
        staffId: staff.id,
        companyId: staff.merchant.id,
        companyName: staff.merchant.name,
        role: staff.role,
      },
    };
  }

  private mapProfile(staff: DeliverySellerStaffWithMerchant) {
    return {
      staffId: staff.id,
      userId: staff.id,
      role: staff.role,
      permissionCodes: staff.permissionCodes ?? [],
      user: {
        nickname: staff.realName ?? undefined,
        phone: staff.phone ?? undefined,
        phoneMasked: maskPhone(staff.phone) ?? undefined,
      },
      company: {
        id: staff.merchant.id,
        name: staff.merchant.name,
        shortName: staff.merchant.shortName ?? undefined,
        status: staff.merchant.status,
      },
    };
  }

  private async revokeStaffSessions(staffIds: string[]) {
    if (staffIds.length === 0) {
      return;
    }
    await this.deliveryPrisma.deliverySellerSession.updateMany({
      where: {
        staffId: { in: staffIds },
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private async issueOtp(phone: string, purpose: DeliveryOtpPurpose) {
    const recentCount = await this.deliveryPrisma.deliveryPhoneOtp.count({
      where: {
        phone,
        purpose,
        createdAt: {
          gte: new Date(Date.now() - 60_000),
        },
      },
    });
    if (recentCount > 0) {
      throw new BadRequestException('请勿频繁获取验证码');
    }

    const code = this.isMockCodeEnabled()
      ? '123456'
      : randomInt(100000, 1000000).toString();
    await this.deliveryPrisma.deliveryPhoneOtp.create({
      data: {
        phone,
        purpose,
        codeHash: this.hashCode(code),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    if (this.isMockCodeEnabled()) {
      this.logger.log(
        `[Delivery Seller SMS Mock] purpose=${purpose} code=${code} target=${maskPhone(phone)}`,
      );
      return;
    }

    try {
      await this.aliyunSmsService.sendVerificationCode(phone, code);
    } catch (error) {
      this.logger.error(
        `[Delivery Seller SMS] 发送失败 target=${maskPhone(phone)}: ${(error as Error).message}`,
      );
    }
  }

  private async verifyOtpOrThrow(params: {
    phone: string;
    code: string;
    purpose: DeliveryOtpPurpose;
    consume: boolean;
    detailedErrors?: boolean;
  }) {
    if (this.isMockCodeEnabled() && params.code === '123456') {
      return;
    }

    const now = new Date();
    const record = await this.deliveryPrisma.deliveryPhoneOtp.findFirst({
      where: {
        phone: params.phone,
        purpose: params.purpose,
        codeHash: this.hashCode(params.code),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!record) {
      this.throwOtpError('OTP_INVALID', params.detailedErrors);
    }
    if (record.consumedAt) {
      this.throwOtpError('OTP_USED', params.detailedErrors);
    }
    if (record.expiresAt <= now) {
      this.throwOtpError('OTP_EXPIRED', params.detailedErrors);
    }

    if (!params.consume) {
      return;
    }

    const consumed = await this.deliveryPrisma.deliveryPhoneOtp.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
      },
      data: {
        consumedAt: now,
      },
    });
    if (consumed.count === 0) {
      this.throwOtpError('OTP_USED', params.detailedErrors);
    }
  }

  private throwOtpError(
    code: 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_USED',
    detailedErrors = false,
  ): never {
    if (!detailedErrors) {
      throw new BadRequestException('验证码错误或已过期');
    }

    if (code === 'OTP_INVALID') {
      throw new BadRequestException({
        code,
        message: '验证码错误，请重新输入',
      });
    }
    if (code === 'OTP_EXPIRED') {
      throw new BadRequestException({
        code,
        message: '验证码已过期，请重新获取',
      });
    }
    throw new BadRequestException({
      code,
      message: '验证码已被使用，请重新获取',
    });
  }

  private hashCode(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private isMockCodeEnabled() {
    return this.configService.get('DELIVERY_SMS_MOCK') === 'true';
  }
}
