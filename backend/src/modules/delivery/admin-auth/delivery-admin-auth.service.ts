import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';
import {
  DeliveryAdminUserStatus,
  DeliveryOtpPurpose,
  Prisma,
} from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { CaptchaService } from '../../captcha/captcha.service';
import { DeliveryAdminJwtPayload } from '../auth/delivery-admin-jwt.strategy';
import {
  DeliveryAdminBindPhoneSmsCodeDto,
  DeliveryAdminChangePasswordDto,
  DeliveryAdminChangePhoneDto,
  DeliveryAdminLoginByPhoneCodeDto,
  DeliveryAdminLoginDto,
  DeliveryAdminRefreshDto,
  DeliveryAdminSmsCodeDto,
} from './delivery-admin-auth.dto';

const DUMMY_PASSWORD_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const DELIVERY_ADMIN_ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: '超级管理员',
  OPERATIONS: '运营',
  ADMIN: '管理员',
  FINANCE: '财务',
  CUSTOMER_SERVICE: '客服',
};

type DeliveryAuthRequestMeta = {
  ip?: string;
  userAgent?: string;
};

type DeliveryAdminRecord = {
  id: string;
  username: string;
  phone: string | null;
  passwordHash: string;
  realName: string | null;
  roleCodes: string[];
  permissions: Prisma.JsonValue | null;
  status: DeliveryAdminUserStatus;
  lastLoginAt?: Date | null;
  lastLoginIp?: string | null;
};

@Injectable()
export class DeliveryAdminAuthService {
  private readonly logger = new Logger(DeliveryAdminAuthService.name);
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(
    private readonly deliveryPrisma: DeliveryPrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly captchaService: CaptchaService,
    private readonly aliyunSmsService: AliyunSmsService,
  ) {
    this.jwtSecret = this.configService.getOrThrow<string>('DELIVERY_ADMIN_JWT_SECRET');
    this.jwtExpiresIn = this.configService.get<string>('DELIVERY_ADMIN_JWT_EXPIRES_IN', '8h');
  }

  async login(dto: DeliveryAdminLoginDto, ip?: string, userAgent?: string) {
    const captchaOk = await this.captchaService.verify(dto.captchaId, dto.captchaCode);
    if (!captchaOk) {
      throw new UnauthorizedException('验证码错误或已过期');
    }

    const admin = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { username: dto.username },
    });
    if (!admin) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH).catch(() => false);
      throw new UnauthorizedException('用户名或密码错误');
    }
    this.assertAdminActive(admin);

    const passwordOk = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    await this.markLoggedIn(admin.id, ip);
    return this.issueTokens(admin, { ip, userAgent });
  }

  async sendSmsCode(dto: DeliveryAdminSmsCodeDto, _ip?: string) {
    const admin = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { phone: dto.phone },
    });

    if (admin?.status === DeliveryAdminUserStatus.ACTIVE) {
      await this.issueOtp(dto.phone, DeliveryOtpPurpose.LOGIN);
    } else {
      this.logger.warn('[Delivery Admin SMS] 手机号无有效配送管理员账号，忽略发送');
    }

    return { ok: true, message: '验证码已发送' };
  }

  async loginByPhoneCode(
    dto: DeliveryAdminLoginByPhoneCodeDto,
    ip?: string,
    userAgent?: string,
  ) {
    await this.verifyOtpOrThrow({
      phone: dto.phone,
      code: dto.code,
      purpose: DeliveryOtpPurpose.LOGIN,
      consume: true,
    });

    const admin = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { phone: dto.phone },
    });
    if (!admin) {
      throw new UnauthorizedException('手机号未绑定配送管理员账号');
    }
    this.assertAdminActive(admin);

    await this.markLoggedIn(admin.id, ip);
    return this.issueTokens(admin, { ip, userAgent });
  }

  async refresh(dto: DeliveryAdminRefreshDto) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);
    const now = new Date();
    const session = await this.deliveryPrisma.deliveryAdminSession.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        adminUser: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('刷新令牌已失效');
    }
    this.assertAdminActive(session.adminUser);

    const cas = await this.deliveryPrisma.deliveryAdminSession.updateMany({
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

    return this.issueTokens(session.adminUser, {
      ip: session.ip ?? undefined,
      userAgent: session.userAgent ?? undefined,
    });
  }

  async logout(adminUserId: string) {
    await this.deliveryPrisma.deliveryAdminSession.updateMany({
      where: {
        adminUserId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        revokedAt: new Date(),
      },
    });
    return { ok: true };
  }

  async getProfile(adminUserId: string) {
    const admin = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { id: adminUserId },
    });
    if (!admin) {
      throw new UnauthorizedException('配送管理员不存在');
    }

    const roles = this.resolveRoleNames(admin.roleCodes);
    return {
      id: admin.id,
      username: admin.username,
      realName: admin.realName,
      phone: admin.phone,
      roles,
      permissions: this.resolvePermissionCodes(admin.permissions, roles),
      status: admin.status,
      lastLoginAt: admin.lastLoginAt,
      lastLoginIp: admin.lastLoginIp,
    };
  }

  async changePassword(
    adminUserId: string,
    dto: DeliveryAdminChangePasswordDto,
  ) {
    const admin = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { id: adminUserId },
    });
    if (!admin) {
      throw new NotFoundException('配送管理员不存在');
    }

    const passwordOk = await bcrypt.compare(dto.oldPassword, admin.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('原密码错误');
    }
    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException('新密码不能与原密码相同');
    }

    await this.deliveryPrisma.deliveryAdminUser.update({
      where: { id: adminUserId },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, 10),
      },
    });
    await this.revokeAdminSessions(adminUserId);
    return { ok: true };
  }

  async sendBindPhoneSmsCode(
    adminUserId: string,
    dto: DeliveryAdminBindPhoneSmsCodeDto,
  ) {
    const existing = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { phone: dto.phone },
    });
    if (existing && existing.id !== adminUserId) {
      throw new ConflictException('该手机号已被其他配送管理员绑定');
    }

    await this.issueOtp(dto.phone, DeliveryOtpPurpose.BIND);
    return { ok: true, message: '验证码已发送' };
  }

  async changePhone(adminUserId: string, dto: DeliveryAdminChangePhoneDto) {
    const admin = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { id: adminUserId },
    });
    if (!admin || !admin.phone) {
      throw new BadRequestException('当前账号未绑定手机号，暂不支持自助换绑');
    }
    if (admin.phone === dto.newPhone) {
      throw new BadRequestException('新手机号不能与当前手机号相同');
    }

    const existing = await this.deliveryPrisma.deliveryAdminUser.findUnique({
      where: { phone: dto.newPhone },
    });
    if (existing && existing.id !== adminUserId) {
      throw new ConflictException('该手机号已被其他配送管理员绑定');
    }

    await this.verifyOtpOrThrow({
      phone: admin.phone,
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

    await this.deliveryPrisma.deliveryAdminUser.update({
      where: { id: adminUserId },
      data: {
        phone: dto.newPhone,
      },
    });
    await this.revokeAdminSessions(adminUserId);
    return { ok: true };
  }

  private async issueTokens(admin: DeliveryAdminRecord, meta: DeliveryAuthRequestMeta) {
    const roles = this.resolveRoleNames(admin.roleCodes);
    const permissions = this.resolvePermissionCodes(admin.permissions, roles);
    const refreshToken = randomBytes(48).toString('hex');
    const refreshTokenHash = this.hashToken(refreshToken);

    const session = await this.deliveryPrisma.deliveryAdminSession.create({
      data: {
        adminUserId: admin.id,
        refreshTokenHash,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const payload: DeliveryAdminJwtPayload = {
      sub: admin.id,
      sessionId: session.id,
      roles,
      permissions,
      type: 'delivery-admin',
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: this.jwtExpiresIn as any,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.jwtExpiresIn,
      admin: {
        id: admin.id,
        username: admin.username,
        realName: admin.realName,
        roles,
      },
    };
  }

  private assertAdminActive(admin: Pick<DeliveryAdminRecord, 'status'>) {
    if (admin.status !== DeliveryAdminUserStatus.ACTIVE) {
      throw new ForbiddenException('配送管理账号已被禁用');
    }
  }

  private async markLoggedIn(adminUserId: string, ip?: string) {
    await this.deliveryPrisma.deliveryAdminUser.update({
      where: { id: adminUserId },
      data: {
        lastLoginAt: new Date(),
        lastLoginIp: ip ?? null,
      },
    });
  }

  private async revokeAdminSessions(adminUserId: string) {
    await this.deliveryPrisma.deliveryAdminSession.updateMany({
      where: {
        adminUserId,
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
      this.logger.log(`[Delivery Admin SMS Mock] purpose=${purpose} code=${code}`);
      return;
    }

    try {
      await this.aliyunSmsService.sendVerificationCode(phone, code);
    } catch (error) {
      this.logger.error(`[Delivery Admin SMS] 发送失败: ${(error as Error).message}`);
    }
  }

  private async verifyOtpOrThrow(params: {
    phone: string;
    code: string;
    purpose: DeliveryOtpPurpose;
    consume: boolean;
  }) {
    if (this.isMockCodeEnabled() && params.code === '123456') {
      return;
    }

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

    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException('验证码错误或已过期');
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
        consumedAt: new Date(),
      },
    });
    if (consumed.count === 0) {
      throw new BadRequestException('验证码已被使用，请重新获取');
    }
  }

  private resolveRoleNames(roleCodes: string[]) {
    const names = roleCodes.map((role) => DELIVERY_ADMIN_ROLE_NAMES[role] ?? role);
    return [...new Set(names)];
  }

  private resolvePermissionCodes(permissions: Prisma.JsonValue | null, roles: string[]) {
    if (roles.includes('超级管理员')) {
      return ['delivery:*'];
    }
    if (Array.isArray(permissions)) {
      return permissions.filter((item): item is string => typeof item === 'string');
    }
    if (!permissions || typeof permissions !== 'object') {
      return [];
    }

    const record = permissions as Record<string, unknown>;
    if (record.all === true) {
      return ['delivery:*'];
    }
    if (Array.isArray(record.permissions)) {
      return record.permissions.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(record.modules)) {
      return record.modules
        .filter((item): item is string => typeof item === 'string')
        .map((module) => `delivery:${module}:*`);
    }
    return [];
  }

  private isMockCodeEnabled() {
    return this.configService.get('DELIVERY_SMS_MOCK') === 'true';
  }

  private hashCode(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
