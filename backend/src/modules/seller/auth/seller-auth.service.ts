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
import { SellerLoginDto, SellerPasswordLoginDto, SellerSelectCompanyDto, SellerRefreshDto, SellerSmsCodeDto, SellerChangePasswordDto, SellerBindPhoneSmsCodeDto, SellerChangePhoneDto } from './seller-auth.dto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CaptchaService } from '../../captcha/captcha.service';
import { SellerJwtPayload } from './seller-jwt.strategy';
import { sanitizeStringForLog } from '../../../common/logging/log-sanitizer';
import { maskPhone } from '../../../common/security/privacy-mask';
import { RedisCoordinatorService } from '../../../common/infra/redis-coordinator.service';
import { SellerRiskControlService } from '../risk-control/seller-risk-control.service';
import { AliyunSmsService } from '../../../common/sms/aliyun-sms.service';

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
    private aliyunSms: AliyunSmsService,
    private captchaService: CaptchaService,
  ) {
    this.jwtSecret = this.config.getOrThrow<string>('SELLER_JWT_SECRET');
    this.jwtExpiresIn = this.config.get<string>('SELLER_JWT_EXPIRES_IN', '8h');
  }

  /** 发送验证码（复用 SmsOtp 表）
   *
   * 方案 A（2026-04-19）：去除图形验证码依赖，仅靠后端速率限制保护：
   * - 单手机号：1/分钟、10/日（createOtpWithRateLimit 已实现，Redis+DB 双保险）
   * - 单 IP：controller 层 @Throttle 3/分钟
   * - ip 参数保留扩展空间，暂未用于内部限制（与 admin 端签名保持一致）
   */
  async sendSmsCode(dto: SellerSmsCodeDto, _ip?: string) {
    const phone = dto.phone;
    const smsMock = this.config.get('SMS_MOCK', 'true');
    // 开发模式使用固定验证码 123456
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.createOtpWithRateLimit(phone, codeHash, expiresAt);

    if (smsMock === 'true') {
      this.logger.log(`[SMS Mock][Seller] 固定验证码=${code}（目标=${this.maskContact(phone)}）`);
    } else {
      // 真实短信通道：调用阿里云 SMS API
      try {
        await this.aliyunSms.sendVerificationCode(phone, code);
        this.logger.log(`[SMS][Seller] 验证码已发送（目标=${this.maskContact(phone)}）`);
      } catch (err) {
        // 发送失败仅记录日志，不阻塞流程（OTP 已写入数据库，用户可重试）
        this.logger.error(
          `[SMS][Seller] 验证码发送失败: ${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
      }
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

    return this.finalizeLogin(identity.userId, staffRecords, ip, userAgent);
  }

  /** 手机号 + 密码登录 */
  async loginByPassword(dto: SellerPasswordLoginDto, ip?: string, userAgent?: string) {
    // 0. 先校验图形验证码（原子 getdel，防止重放）
    const captchaOk = await this.captchaService.verify(dto.captchaId, dto.captchaCode);
    if (!captchaOk) {
      throw new UnauthorizedException('验证码错误或已过期');
    }

    // 1. 查找用户（通过 AuthIdentity 的 PHONE provider，与 SMS 登录保持一致）
    const identity = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: dto.phone },
    });
    if (!identity) {
      throw new UnauthorizedException('账号或密码错误');
    }

    // 2. 查找该用户所有 ACTIVE 的企业员工记录
    const staffRecords = await this.prisma.companyStaff.findMany({
      where: { userId: identity.userId, status: 'ACTIVE' },
      include: {
        company: { select: { id: true, name: true, shortName: true, status: true } },
      },
    });

    // 3. 挑选所有已设置 passwordHash 的员工记录
    //    注意：下方所有认证失败路径（无 staff / 无密码 / bcrypt 均不匹配）统一返回
    //    "账号或密码错误"，避免手机号枚举攻击；但仍需完整执行 bcrypt.compare 以避免时序侧信道
    const staffsWithPassword = staffRecords.filter((s) => !!s.passwordHash);

    // 4. 对每个已设置密码的员工记录尝试 bcrypt.compare（即使没有 staff 也走一次 dummy compare，统一耗时）
    //    记录命中的具体 staff 记录，避免跨企业越权：
    //    用户 X 若在公司 A 设了密码、在公司 B 未设密码，不能用 A 的密码登进 B
    let matchedStaff: (typeof staffRecords)[number] | null = null;
    if (staffsWithPassword.length === 0) {
      // 使用 dummy hash 做一次 compare，保持与真实路径一致的 CPU 耗时
      const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.N1uVeS6vN9B1sT2mX1qW3eF4gH5i';
      await bcrypt.compare(dto.password, DUMMY_HASH).catch(() => false);
    } else {
      for (const staff of staffsWithPassword) {
        const ok = await bcrypt.compare(dto.password, staff.passwordHash!);
        if (ok) {
          matchedStaff = staff;
          break;
        }
      }
    }
    if (!matchedStaff) {
      throw new UnauthorizedException('账号或密码错误');
    }

    // 5. 仅将命中的单条员工记录传入 finalizeLogin
    //    这保证密码登录只能进入密码所在的那个企业，不会误入其他未设密码的企业
    //    （SMS 登录不受影响，仍然走全部 staffRecords 的多企业选择流程）
    return this.finalizeLogin(identity.userId, [matchedStaff], ip, userAgent);
  }

  /** 认证通过后的统一收尾：过滤企业状态、单/多企业分支签发 Token */
  private async finalizeLogin(
    userId: string,
    staffRecords: Array<any>,
    ip?: string,
    userAgent?: string,
  ) {
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

    // 单企业直接签发 Token；多企业返回选择列表
    if (activeStaffs.length === 1) {
      const staff = activeStaffs[0];
      return this.issueTokens(staff, ip, userAgent);
    }

    // 多企业：签发临时 Token，前端用来选择企业
    const tempPayload = { sub: userId, type: 'seller-temp' as const };
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

  // ===================== C40c7 账号安全：修改密码 / 修改手机号 =====================

  /** 修改密码（仅当前 staff 的 passwordHash，不影响该用户其他企业的 staff 密码） */
  async changePassword(
    staffId: string,
    dto: SellerChangePasswordDto,
  ) {
    const staff = await this.prisma.companyStaff.findUnique({
      where: { id: staffId },
    });
    if (!staff) throw new NotFoundException('员工不存在');
    if (!staff.passwordHash) {
      throw new BadRequestException('当前账号未设密码，无法修改。请联系创始人设置初始密码或改用短信登录');
    }

    const valid = await bcrypt.compare(dto.oldPassword, staff.passwordHash);
    if (!valid) throw new UnauthorizedException('原密码错误');

    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException('新密码不能与原密码相同');
    }

    const newHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.companyStaff.update({
      where: { id: staffId },
      data: { passwordHash: newHash },
    });

    // 改密后该 staff 所有 session 失效
    await this.prisma.sellerSession.updateMany({
      where: { staffId, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    return { ok: true };
  }

  /** 给新手机号发绑定验证码（已登录态，purpose=BIND） */
  async sendBindPhoneSmsCode(
    dto: SellerBindPhoneSmsCodeDto,
    userId: string,
  ) {
    const { phone } = dto;

    // 新手机号不能已被其他 User 绑定
    const existingIdentity = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: phone },
    });
    if (existingIdentity && existingIdentity.userId !== userId) {
      throw new ConflictException('该手机号已被其他用户绑定');
    }

    const smsMock = this.config.get('SMS_MOCK', 'true');
    const code =
      smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Serializable 事务：速率限制 + OTP 插入原子执行
    await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60_000);
        const oneHourAgo = new Date(now.getTime() - 3_600_000);
        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);

        const [perMinute, perHour, perDay] = await Promise.all([
          tx.smsOtp.count({
            where: { phone, purpose: 'BIND', createdAt: { gte: oneMinuteAgo } },
          }),
          tx.smsOtp.count({
            where: { phone, purpose: 'BIND', createdAt: { gte: oneHourAgo } },
          }),
          tx.smsOtp.count({
            where: { phone, purpose: 'BIND', createdAt: { gte: dayStart } },
          }),
        ]);

        if (perMinute >= 1) {
          throw new HttpException('发送过于频繁，请 1 分钟后再试', HttpStatus.TOO_MANY_REQUESTS);
        }
        if (perHour >= 5) {
          throw new HttpException('该手机号 1 小时内发送次数过多', HttpStatus.TOO_MANY_REQUESTS);
        }
        if (perDay >= 10) {
          throw new HttpException('该手机号今日验证码发送次数已达上限', HttpStatus.TOO_MANY_REQUESTS);
        }

        await tx.smsOtp.create({
          data: { phone, codeHash, purpose: 'BIND', expiresAt },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (smsMock === 'true') {
      this.logger.log(`[Seller Bind SMS Mock] 固定验证码=${code}（目标 ${maskPhone(phone)}）`);
    } else {
      try {
        await this.aliyunSms.sendVerificationCode(phone, code);
      } catch (err) {
        this.logger.error(
          `[Seller Bind SMS] 验证码发送失败: ${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
      }
    }

    return { ok: true, message: '验证码已发送' };
  }

  /** 修改手机号：双重 SMS 验证（原手机 LOGIN + 新手机 BIND）
   *
   * 注意：手机号挂在 User 的 AuthIdentity(PHONE) 上，改一次影响该 User 名下所有
   * CompanyStaff 的登录行为。改后该 User 所有 SellerSession 全失效。
   */
  async changePhone(
    staffId: string,
    userId: string,
    dto: SellerChangePhoneDto,
  ) {
    const identity = await this.prisma.authIdentity.findFirst({
      where: { userId, provider: 'PHONE' },
    });
    if (!identity) {
      throw new BadRequestException('当前账号未绑定手机号');
    }
    if (identity.identifier === dto.newPhone) {
      throw new BadRequestException('新手机号与原手机号相同');
    }

    // 原手机验证码（purpose=LOGIN，来自 /seller/auth/sms/code）
    await this.verifyAndConsumeOtpByPurpose(identity.identifier, dto.oldPhoneCode, 'LOGIN');

    // 新手机验证码（purpose=BIND，来自 /seller/auth/bind-phone/sms/code）
    await this.verifyAndConsumeOtpByPurpose(dto.newPhone, dto.newPhoneCode, 'BIND');

    // 再次检查新手机号未被抢占
    const existing = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: dto.newPhone },
    });
    if (existing && existing.userId !== userId) {
      throw new ConflictException('该手机号已被其他用户绑定');
    }

    const oldPhone = identity.identifier;
    await this.prisma.authIdentity.update({
      where: { id: identity.id },
      data: { identifier: dto.newPhone },
    });

    // 该 User 名下所有 staff 的 session 全失效
    await this.prisma.sellerSession.updateMany({
      where: {
        staff: { userId },
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() },
    });

    this.logger.log(
      `[Seller ChangePhone] staffId=${staffId} userId=${userId} ${maskPhone(oldPhone)} → ${maskPhone(dto.newPhone)}`,
    );

    return { ok: true };
  }

  /** 校验并消费指定 purpose 的 OTP（CAS 原子） */
  private async verifyAndConsumeOtpByPurpose(
    phone: string,
    code: string,
    purpose: 'LOGIN' | 'BIND',
  ) {
    const records = await this.prisma.smsOtp.findMany({
      where: {
        phone,
        purpose,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const errLabel = purpose === 'BIND' ? '新手机号' : '原手机号';
    if (records.length === 0) {
      throw new BadRequestException(`${errLabel}验证码无效或已过期`);
    }

    let matched: (typeof records)[number] | null = null;
    for (const r of records) {
      if (await bcrypt.compare(code, r.codeHash)) {
        matched = r;
        break;
      }
    }
    if (!matched) {
      throw new BadRequestException(`${errLabel}验证码错误`);
    }

    const cas = await this.prisma.smsOtp.updateMany({
      where: { id: matched.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (cas.count === 0) {
      throw new BadRequestException('验证码已被使用，请重新获取');
    }
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
