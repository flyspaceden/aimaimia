import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SellerLoginDto, SellerSelectCompanyDto, SellerRefreshDto } from './seller-auth.dto';
import { SellerJwtPayload } from './seller-jwt.strategy';
import { sanitizeStringForLog } from '../../../common/logging/log-sanitizer';
import { maskPhone } from '../../../common/security/privacy-mask';
import { RedisCoordinatorService } from '../../../common/infra/redis-coordinator.service';
import { SellerRiskControlService } from '../risk-control/seller-risk-control.service';

@Injectable()
export class SellerAuthService {
  private readonly logger = new Logger(SellerAuthService.name);
  private static readonly OTP_SEND_PER_TARGET_PER_MINUTE = 1;
  private static readonly OTP_SEND_PER_TARGET_PER_DAY = 10;
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private redisCoord: RedisCoordinatorService,
    private sellerRiskControl: SellerRiskControlService,
  ) {
    this.jwtSecret = this.config.getOrThrow<string>('SELLER_JWT_SECRET');
    this.jwtExpiresIn = this.config.get<string>('SELLER_JWT_EXPIRES_IN', '8h');
  }

  /** 发送验证码（复用 SmsOtp 表） */
  async sendSmsCode(phone: string) {
    const smsMock = this.config.get('SMS_MOCK', 'true');
    // 开发模式使用固定验证码 123456
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.createOtpWithRateLimit(phone, codeHash, expiresAt);

    if (smsMock === 'true') {
      this.logger.log(`[SMS Mock][Seller] 固定验证码=${code}（目标=${this.maskContact(phone)}）`);
    }

    return { ok: true };
  }

  /** 手机号 + 验证码登录 */
  async login(dto: SellerLoginDto, ip?: string, userAgent?: string) {
    // 1. 验证码校验
    await this.verifyCode(dto.phone, dto.code);

    // 2. 查找用户
    const identity = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: dto.phone },
    });
    if (!identity) {
      throw new UnauthorizedException('该手机号未注册');
    }

    // 3. 查找关联的企业员工身份（只查 ACTIVE 的）
    const staffRecords = await this.prisma.companyStaff.findMany({
      where: { userId: identity.userId, status: 'ACTIVE' },
      include: {
        company: { select: { id: true, name: true, shortName: true, status: true } },
      },
    });

    if (staffRecords.length === 0) {
      throw new ForbiddenException('您不是任何企业的员工，无法登录卖家后台');
    }

    const normalizedCompanyState = await this.normalizeCompanyStates(
      staffRecords.map((staff) => staff.company.id),
    );

    // 过滤掉已停用的企业
    const activeStaffs = staffRecords.filter(
      (staff) => normalizedCompanyState.get(staff.company.id) === 'ACTIVE',
    );
    if (activeStaffs.length === 0) {
      throw new ForbiddenException('您所属的企业均已停用');
    }

    // 4. 单企业直接签发 Token；多企业返回选择列表
    if (activeStaffs.length === 1) {
      const staff = activeStaffs[0];
      return this.issueTokens(staff, ip, userAgent);
    }

    // 多企业：签发临时 Token，前端用来选择企业
    const tempPayload = { sub: identity.userId, type: 'seller-temp' as const };
    const tempToken = this.jwt.sign(tempPayload as any, {
      secret: this.jwtSecret,
      expiresIn: '5m',
    });

    return {
      needSelectCompany: true,
      tempToken,
      companies: activeStaffs.map((s) => ({
        companyId: s.company.id,
        companyName: s.company.name,
        shortName: s.company.shortName,
        role: s.role,
      })),
    };
  }

  /** 多企业用户选择企业后签发正式 Token */
  async selectCompany(dto: SellerSelectCompanyDto, ip?: string, userAgent?: string) {
    // 验证临时 Token
    let decoded: any;
    try {
      decoded = this.jwt.verify(dto.tempToken, { secret: this.jwtSecret });
    } catch {
      throw new UnauthorizedException('临时令牌已失效，请重新登录');
    }

    if (decoded.type !== 'seller-temp') {
      throw new UnauthorizedException('无效的令牌类型');
    }

    const userId = decoded.sub;

    // 查找该用户在目标企业的员工记录
    const staff = await this.prisma.companyStaff.findUnique({
      where: { userId_companyId: { userId, companyId: dto.companyId } },
      include: {
        company: { select: { id: true, name: true, status: true } },
      },
    });

    if (!staff || staff.status !== 'ACTIVE') {
      throw new ForbiddenException('您不是该企业的有效员工');
    }

    const companyState = await this.sellerRiskControl.normalizeCompanyAccessStatus(
      staff.company.id,
    );
    if (companyState?.status !== 'ACTIVE') {
      throw new ForbiddenException('该企业已停用');
    }

    return this.issueTokens(staff, ip, userAgent);
  }

  /** 刷新 Token */
  async refresh(dto: SellerRefreshDto) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);
    const now = new Date();

    const session = await this.prisma.sellerSession.findFirst({
      where: {
        refreshTokenHash,
        expiresAt: { gt: now },
        // L1修复：检查最大续期上限
        OR: [
          { absoluteExpiresAt: null },
          { absoluteExpiresAt: { gt: now } },
        ],
      },
      include: {
        staff: {
          include: {
            company: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    // 检查员工和企业状态
    if (session.staff.status !== 'ACTIVE') {
      throw new ForbiddenException('员工账号已被禁用');
    }
    const companyState = await this.sellerRiskControl.normalizeCompanyAccessStatus(
      session.staff.company.id,
    );
    if (companyState?.status !== 'ACTIVE') {
      throw new ForbiddenException('企业已停用');
    }

    // S10延伸修复：CAS 原子失效旧 session，防止并发重复刷新
    const cas = await this.prisma.sellerSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });
    if (cas.count === 0) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    // L1修复：继承旧 session 的 absoluteExpiresAt，防止无限续期
    return this.issueTokens(session.staff, session.ip, session.userAgent, session.absoluteExpiresAt);
  }

  /** 登出（失效所有活跃 session） */
  async logout(staffId: string) {
    await this.prisma.sellerSession.updateMany({
      where: { staffId, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    return { ok: true };
  }

  /** 获取当前卖家信息 */
  async getMe(staffId: string) {
    const staff = await this.prisma.companyStaff.findUnique({
      where: { id: staffId },
      include: {
        user: {
          include: {
            profile: true,
            authIdentities: {
              where: { provider: 'PHONE' },
              select: { identifier: true },
              take: 1,
            },
          },
        },
        company: {
          include: { profile: true },
        },
      },
    });

    if (!staff) {
      throw new UnauthorizedException('卖家信息不存在');
    }

    const phone = staff.user.authIdentities?.[0]?.identifier || undefined;
    return {
      staffId: staff.id,
      userId: staff.userId,
      role: staff.role,
      user: {
        nickname: staff.user.profile?.nickname,
        avatarUrl: staff.user.profile?.avatarUrl,
        phone,
        phoneMasked: maskPhone(phone),
      },
      company: {
        id: staff.company.id,
        name: staff.company.name,
        shortName: staff.company.shortName,
        status: staff.company.status,
      },
    };
  }

  // ---- 内部方法 ----

  /** 验证码校验（S07延伸修复：CAS 原子消费） */
  private async verifyCode(phone: string, code: string) {
    const record = await this.prisma.smsOtp.findFirst({
      where: {
        phone,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new BadRequestException('验证码无效或已过期');

    const valid = await bcrypt.compare(code, record.codeHash);
    if (!valid) throw new BadRequestException('验证码错误');

    const cas = await this.prisma.smsOtp.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (cas.count === 0) {
      throw new BadRequestException('验证码已被使用，请重新获取');
    }
  }

  /** 签发 Token 对 */
  private async issueTokens(
    staff: any,
    ip?: string | null,
    userAgent?: string | null,
    inheritedAbsoluteExpiresAt?: Date | null,
  ) {
    const refreshTokenStr = randomBytes(64).toString('hex');
    const refreshTokenHash = this.hashToken(refreshTokenStr);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 天

    // L06修复：限制单个员工最多 5 个活跃会话，超出时踢掉最早的会话
    const MAX_ACTIVE_SESSIONS = 5;
    const activeSessions = await this.prisma.sellerSession.findMany({
      where: { staffId: staff.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
    if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
      // 踢掉最早的会话（将过期时间设为当前时间使其失效）
      await this.prisma.sellerSession.update({
        where: { id: activeSessions[0].id },
        data: { expiresAt: new Date() },
      });
    }

    // L1修复：首次登录设 90 天绝对上限；refresh 时继承旧值，不可重置
    const absoluteExpiresAt = inheritedAbsoluteExpiresAt
      ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const session = await this.prisma.sellerSession.create({
      data: {
        staffId: staff.id,
        refreshTokenHash,
        ip: ip || null,
        userAgent: userAgent || null,
        expiresAt: refreshExpiresAt,
        absoluteExpiresAt,
      },
    });

    const payload: SellerJwtPayload = {
      sub: staff.id,
      userId: staff.userId,
      companyId: staff.companyId,
      role: staff.role,
      type: 'seller',
      sessionId: session.id,
    };

    const accessToken = this.jwt.sign(payload as any, {
      secret: this.jwtSecret,
      expiresIn: this.jwtExpiresIn as any,
    });

    return {
      accessToken,
      refreshToken: refreshTokenStr,
      expiresIn: this.jwtExpiresIn,
      seller: {
        staffId: staff.id,
        companyId: staff.companyId,
        companyName: staff.company?.name,
        role: staff.role,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async normalizeCompanyStates(companyIds: string[]) {
    const uniqueCompanyIds = [...new Set(companyIds)];
    const states = await Promise.all(
      uniqueCompanyIds.map(async (companyId) => {
        const company = await this.sellerRiskControl.normalizeCompanyAccessStatus(
          companyId,
        );
        return [companyId, company?.status] as const;
      }),
    );
    return new Map(states);
  }

  private maskContact(value: string): string {
    return sanitizeStringForLog(value, { maxStringLength: 128 });
  }

  /**
   * M4终态：卖家端验证码发送增加手机号维度限频（Redis 分布式 + DB 事务回退）
   */
  private async createOtpWithRateLimit(target: string, codeHash: string, expiresAt: Date) {
    const targetKey = this.hashRateKey(target);
    const minute = await this.redisCoord.consumeFixedWindow(
      `rl:seller-otp:target:${targetKey}:1m`,
      SellerAuthService.OTP_SEND_PER_TARGET_PER_MINUTE,
      60,
    );
    if (minute && !minute.allowed) {
      throw new HttpException('发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    const day = await this.redisCoord.consumeFixedWindow(
      `rl:seller-otp:target:${targetKey}:1d`,
      SellerAuthService.OTP_SEND_PER_TARGET_PER_DAY,
      24 * 60 * 60,
    );
    if (day && !day.allowed) {
      throw new HttpException('今日验证码发送次数已达上限', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (minute || day) {
      await this.prisma.smsOtp.create({
        data: { phone: target, codeHash, purpose: 'LOGIN', expiresAt },
      });
      return;
    }

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const now = new Date();
          const oneMinuteAgo = new Date(now.getTime() - 60_000);
          const dayStart = new Date(now);
          dayStart.setHours(0, 0, 0, 0);

          const [perMinute, perDay] = await Promise.all([
            tx.smsOtp.count({
              where: {
                phone: target,
                purpose: 'LOGIN',
                createdAt: { gte: oneMinuteAgo },
              },
            }),
            tx.smsOtp.count({
              where: {
                phone: target,
                purpose: 'LOGIN',
                createdAt: { gte: dayStart },
              },
            }),
          ]);

          if (perMinute >= SellerAuthService.OTP_SEND_PER_TARGET_PER_MINUTE) {
            throw new HttpException('发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
          }
          if (perDay >= SellerAuthService.OTP_SEND_PER_TARGET_PER_DAY) {
            throw new HttpException('今日验证码发送次数已达上限', HttpStatus.TOO_MANY_REQUESTS);
          }

          await tx.smsOtp.create({
            data: { phone: target, codeHash, purpose: 'LOGIN', expiresAt },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return;
      } catch (err: any) {
        if (err?.code === 'P2034' && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
          continue;
        }
        throw err;
      }
    }
  }

  private hashRateKey(value: string): string {
    return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex').slice(0, 24);
  }
}
