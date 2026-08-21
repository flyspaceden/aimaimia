import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  Logger,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, SmsPurpose, UserStatus } from '@prisma/client';
import { LoginDto } from './dto/login.dto';
import { InviteLoginDto } from './dto/invite-login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SendForgotPasswordCodeDto, ResetForgotPasswordDto } from './dto/forgot-password.dto';
import { randomBytes, createHash, randomInt } from 'crypto';
import { sanitizeStringForLog } from '../../common/logging/log-sanitizer';
import { RedisCoordinatorService } from '../../common/infra/redis-coordinator.service';
import { CouponEngineService } from '../coupon/coupon-engine.service';
import { AliyunSmsService } from '../../common/sms/aliyun-sms.service';
import { CaptchaService } from '../captcha/captcha.service';
import { pickUniqueReferralCode } from '../../common/utils/referral-code.util';
import { nextBuyerNo } from '../../common/utils/buyer-no.util';
import { GrowthEventService } from '../growth/growth-event.service';
import { pickUniqueNormalShareCode } from '../normal-share/normal-share-code.util';
import { InviteH5Service } from '../invite-h5/invite-h5.service';
import { H5WechatInviteLoginDto, H5WechatStartQueryDto } from './dto/send-code.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { acquireUserWriteLock } from '../../common/transactions/active-user-write-barrier';

type WechatOAuthSource = 'mobile' | 'h5';

type WechatLoginProfile = {
  openId: string;
  unionId: string;
  appId: string;
  appType: 'MOBILE_APP' | 'H5_SERVICE_ACCOUNT' | 'MINI_PROGRAM';
  accessToken: string | null;
};

type MiniappLoginTicketPurpose = 'WECHAT_MINIAPP_BIND_PHONE' | 'WECHAT_MINIAPP_CREATE_ACCOUNT' | 'WECHAT_MINIAPP_DELETION';

type MiniappLoginTicketPayload = {
  purpose: MiniappLoginTicketPurpose;
  appId: string;
  openId: string;
  unionId: string;
  issuedAt: number;
  expiresAt: number;
};

type H5WechatStatePayload = {
  inviteCode: string;
  landingSessionId?: string;
  nonce: string;
  iat: number;
};

type WechatIdentityLockLease = {
  assertHeld(): Promise<void>;
  stop(): void;
};

const PHONE_AUTH_APP_ID = 'PHONE';
const H5_WECHAT_STATE_TTL_MS = 10 * 60_000;
const H5_WECHAT_STATE_KEY_PREFIX = 'auth:h5-wechat:state';
const WECHAT_UNION_LOCK_TTL_MS = 10_000;
const WECHAT_CODE2SESSION_TIMEOUT_MS = 8_000;
const WECHAT_OAUTH_HTTP_TIMEOUT_MS = 8_000;
const MINIAPP_LOGIN_TICKET_TTL_MS = 5 * 60_000;
const MINIAPP_LOGIN_TICKET_KEY_PREFIX = 'auth:wechat-miniapp:ticket';
const h5WechatStateMemoryStore = new Map<string, { value: string; expiresAt: number }>();
const miniappTicketMemoryStore = new Map<string, { value: string; expiresAt: number }>();

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private static readonly OTP_SEND_PER_TARGET_PER_MINUTE = 1;
  private static readonly OTP_SEND_PER_TARGET_PER_DAY = 10;
  private static readonly LOGIN_ATTEMPT_PER_TARGET_PER_MINUTE = 5;
  private static readonly PASSWORD_LOGIN_MAX_FAILS = 5;
  private static readonly PASSWORD_LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;

  /**
   * 按 SMS purpose 隔离的发送限流配额
   * - 登录/绑定：沿用 1/分钟 + 10/天（成本敏感型，全天量控）
   * - 忘记密码/账号注销（BUYER_RESET/SELLER_RESET/DELETION）：1/分钟 + 5/小时（按 spec 设计，抵御短期爆破）
   */
  private static readonly OTP_RATE_LIMITS: Record<
    SmsPurpose,
    { perMinute: number; windowCount: number; windowSec: number }
  > = {
    LOGIN:        { perMinute: 1, windowCount: 10, windowSec: 86_400 },
    BIND:         { perMinute: 1, windowCount: 10, windowSec: 86_400 },
    RESET:        { perMinute: 1, windowCount: 5,  windowSec: 3_600  }, // 枚举占位，当前无代码使用
    BUYER_RESET:  { perMinute: 1, windowCount: 5,  windowSec: 3_600  },
    SELLER_RESET: { perMinute: 1, windowCount: 5,  windowSec: 3_600  },
    DELETION:     { perMinute: 1, windowCount: 5,  windowSec: 3_600  },
  };

  /**
   * 密码重置事件的 LoginEvent.meta.action 标记
   * 两处 LoginEvent readers（登录限流 / 密码锁）必须排除此 action，避免混淆语义
   */
  private static readonly PASSWORD_RESET_EVENT_ACTION = 'PASSWORD_RESET_VIA_SMS';

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private redisCoord: RedisCoordinatorService,
    private couponEngine: CouponEngineService,
    private aliyunSms: AliyunSmsService,
    private captcha: CaptchaService,
    private growthEvents: GrowthEventService,
    private inviteH5: InviteH5Service,
  ) {}

  /** 发送短信验证码 */
  async sendSmsCode(phone: string) {
    // B02修复：SMS_MOCK 控制是否走真实短信通道
    const smsMock = this.config.get('SMS_MOCK', 'false');
    this.assertProductionMockDisabled('SMS_MOCK', smsMock, '短信验证码服务');
    // 开发模式使用固定验证码 123456
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 分钟有效

    await this.createOtpWithRateLimit(phone, codeHash, expiresAt, SmsPurpose.LOGIN);

    const nodeEnv = this.config.get('NODE_ENV', 'development');
    if (smsMock === 'true') {
      if (nodeEnv === 'production') {
        this.logger.warn(
          '[SMS] 生产环境仍使用 Mock 短信，请设置 SMS_MOCK=false 并配置真实短信服务',
        );
      }
      this.logger.log(`[SMS Mock] 固定验证码=${code}（目标=${this.maskContact(phone)}）`);
    } else {
      // 真实短信通道：调用阿里云 SMS API
      try {
        await this.aliyunSms.sendVerificationCode(phone, code);
        this.logger.log(`[SMS] 验证码已发送（目标=${this.maskContact(phone)}）`);
      } catch (err) {
        // 发送失败仅记录日志，不阻塞流程（OTP 已写入数据库，用户可重试）
        this.logger.error(
          `[SMS] 验证码发送失败: ${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
      }
    }

    return { ok: true };
  }

  /** 登录 */
  async login(dto: LoginDto) {
    await this.enforceLoginAttemptRateLimit('PHONE', dto.phone);
    return this.loginByPhone(dto.phone, dto.mode, dto.code, dto.password);
  }

  async inviteLogin(dto: InviteLoginDto) {
    await this.enforceLoginAttemptRateLimit('PHONE', dto.phone);
    const session = await this.loginByPhoneCode(dto.phone, dto.code, dto.name);
    const inviteBinding = await this.inviteH5.bindAfterAuth({
      userId: session.userId,
      inviteCode: dto.inviteCode,
      landingSessionId: dto.landingSessionId,
    });

    return {
      ...session,
      user: { id: session.userId },
      inviteBinding,
    };
  }

  /** 注册 */
  async register(dto: RegisterDto) {
    // 检查是否已注册（通过 AuthIdentity 查询）
    const existing = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: dto.phone },
    });
    if (existing) throw new BadRequestException('该手机号已注册');

    // 注册必须验证手机号（防止冒领）
    await this.verifyCode(dto.phone, dto.code, SmsPurpose.LOGIN);

    // 创建 User + UserProfile + AuthIdentity + MemberProfile（事务）
    const user = await this.prisma.user.create({
      data: {
        buyerNo: await nextBuyerNo(this.prisma),
        profile: {
          create: { nickname: dto.name || '新用户' },
        },
        memberProfile: {
          create: { referralCode: await pickUniqueReferralCode(this.prisma) },
        },
        growthAccount: {
          create: {
            pointsBalance: 0,
            pointsTotalEarned: 0,
            pointsTotalSpent: 0,
            growthValue: 0,
          },
        },
        normalShareProfile: {
          create: {
            code: await pickUniqueNormalShareCode(this.prisma as any),
            status: 'ACTIVE',
          },
        },
        authIdentities: {
          create: {
            provider: 'PHONE',
            identifier: dto.phone,
            appId: PHONE_AUTH_APP_ID,
            verified: true,
            meta: dto.password
              ? { passwordHash: await bcrypt.hash(dto.password, 10) }
              : undefined,
          },
        },
      },
    });

    const result = await this.issueTokens(user.id, 'phone');

    // Phase F: 注册触发红包发放（fire-and-forget，不阻塞注册流程）
    this.couponEngine.handleTrigger(user.id, 'REGISTER').catch((err: any) => {
      this.logger.warn(`REGISTER 红包触发失败: userId=${user.id}, error=${err?.message}`);
    });
    this.triggerRegisterGrowth(user.id);

    return result;
  }

  /**
   * 忘记密码 — 发送重置验证码
   * 流程：图形验证码 → 查账号存在性 → 限流 → 发送短信（purpose=BUYER_RESET）
   * IP 维度限流由 controller 的 @Throttle 承载，service 层仅处理手机号维度限流
   */
  async sendForgotPasswordCode(dto: SendForgotPasswordCodeDto) {
    const smsMock = this.config.get('SMS_MOCK', 'false');
    this.assertProductionMockDisabled('SMS_MOCK', smsMock, '短信验证码服务');
    // 1. 图形验证码校验（verify 内部原子 getdel，防重放）
    const captchaOk = await this.captcha.verify(dto.captchaId, dto.captchaCode);
    if (!captchaOk) {
      throw new BadRequestException({ code: 'CAPTCHA_INVALID', message: '图形验证码错误或已过期' });
    }

    // 2. 查询账号是否已注册（产品决策：明确返回"未注册"，UX 优先）
    const identity = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: dto.phone },
    });
    if (!identity) {
      throw new NotFoundException({ code: 'PHONE_NOT_REGISTERED', message: '该手机号未注册' });
    }

    // 3. 生成验证码 + 限流 + 写入 OTP（purpose=BUYER_RESET，与登录 scope 隔离）
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 分钟有效

    await this.createOtpWithRateLimit(dto.phone, codeHash, expiresAt, SmsPurpose.BUYER_RESET);

    const nodeEnv = this.config.get('NODE_ENV', 'development');
    if (smsMock === 'true') {
      if (nodeEnv === 'production') {
        this.logger.warn('[SMS] 生产环境仍使用 Mock 短信（忘记密码），请设置 SMS_MOCK=false');
      }
      this.logger.log(`[SMS Mock] 忘记密码验证码=${code}（目标=${this.maskContact(dto.phone)}）`);
    } else {
      try {
        await this.aliyunSms.sendVerificationCode(dto.phone, code);
        this.logger.log(`[SMS] 忘记密码验证码已发送（目标=${this.maskContact(dto.phone)}）`);
      } catch (err) {
        this.logger.error(
          `[SMS] 忘记密码验证码发送失败: ${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
      }
    }

    return { success: true };
  }

  /**
   * 忘记密码 — 提交新密码
   * Serializable 事务内：验证 OTP(CAS 消费) → 写入新密码 → LoginEvent 审计
   */
  async resetForgotPassword(dto: ResetForgotPasswordDto, ip?: string, userAgent?: string) {
    // 密码复杂度二次校验（防 DTO 绕过）
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/.test(dto.newPassword)) {
      throw new BadRequestException({
        code: 'PASSWORD_FORMAT_INVALID',
        message: '密码至少 6 位且必须包含大写字母、小写字母和数字',
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. 验证 OTP（CAS 消费，purpose=BUYER_RESET）
        await this.verifyResetOtpInTx(tx, dto.phone, dto.code, SmsPurpose.BUYER_RESET, 'buyer');

        // 2. 查询买家身份
        const identity = await tx.authIdentity.findFirst({
          where: { provider: 'PHONE', identifier: dto.phone },
        });
        if (!identity) {
          throw new BadRequestException({ code: 'PHONE_NOT_REGISTERED', message: '该手机号未注册' });
        }

        // 3. 更新 passwordHash（保留 meta 其他字段）
        // 防御性处理：meta 理论上是 Prisma.JsonValue，可能为 null / 对象 / 数组 / 原始值
        // 现有代码路径只会写入对象或 null，这里显式守卫避免 spread 非对象值崩溃
        const newHash = await bcrypt.hash(dto.newPassword, 10);
        const rawMeta = identity.meta;
        const prevMeta: Prisma.JsonObject =
          rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
            ? (rawMeta as Prisma.JsonObject)
            : {};
        await tx.authIdentity.update({
          where: { id: identity.id },
          data: { meta: { ...prevMeta, passwordHash: newHash } },
        });

        // A8-H1：忘记密码后立刻失效该用户所有活跃 session（access + refresh）
        // 买家 refresh token TTL 30 天，若被偷需立即踢下线，否则旧设备最长 30 天仍可继续操作
        await tx.session.updateMany({
          where: { userId: identity.userId, status: 'ACTIVE' },
          data: { status: 'REVOKED', expiresAt: new Date() },
        });

        // 4. 审计日志（复用现有 LoginEvent，meta.action 区分）
        // 注意：登录限流 / 密码锁的 readers 会按 meta.action 排除此事件，action 值必须与
        // AuthService.PASSWORD_RESET_EVENT_ACTION 常量一致，防止拼写漂移导致污染重现
        await tx.loginEvent.create({
          data: {
            userId: identity.userId,
            provider: 'PHONE',
            phone: dto.phone,
            success: true,
            ip: ip ?? null,
            userAgent: userAgent ?? null,
            meta: { action: AuthService.PASSWORD_RESET_EVENT_ACTION, scope: 'BUYER' },
          },
        });

        return { success: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * 已登录买家修改密码。
   *
   * 身份活动状态、旧密码校验、密码写入、其他会话撤销和审计在同一个
   * Serializable 事务中完成，避免并发改密或注销竞态把已释放身份复活。
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    currentSessionId?: string,
  ) {
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/.test(dto.newPassword)) {
      throw new BadRequestException({
        code: 'PASSWORD_FORMAT_INVALID',
        message: '新密码至少 6 位且必须包含大写字母、小写字母和数字',
      });
    }
    const newHash = await bcrypt.hash(dto.newPassword, 10);
    return this.prisma.$transaction(async (tx) => {
      await acquireUserWriteLock(tx, userId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true, deletionExecutedAt: true },
      });
      if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
        throw new ForbiddenException('账号已注销，不能修改密码');
      }

      const identity = await tx.authIdentity.findFirst({
        where: { userId, provider: 'PHONE' },
      });
      const rawMeta = identity?.meta;
      const meta: Prisma.JsonObject = rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
        ? rawMeta as Prisma.JsonObject
        : {};
      const passwordHash = typeof meta.passwordHash === 'string' ? meta.passwordHash : null;
      if (!identity || !passwordHash) {
        throw new BadRequestException('该账号尚未设置密码，请使用忘记密码流程设置');
      }
      if (!await bcrypt.compare(dto.oldPassword, passwordHash)) {
        throw new UnauthorizedException('旧密码不正确');
      }
      if (await bcrypt.compare(dto.newPassword, passwordHash)) {
        throw new BadRequestException('新密码不能与旧密码相同');
      }

      await tx.authIdentity.update({
        where: { id: identity.id },
        data: { meta: { ...meta, passwordHash: newHash } },
      });
      await tx.session.updateMany({
        where: {
          userId,
          status: 'ACTIVE',
          ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
        },
        data: { status: 'REVOKED', expiresAt: new Date() },
      });
      await tx.loginEvent.create({
        data: {
          userId,
          provider: 'PHONE',
          phone: identity.identifier,
          success: true,
          meta: { action: 'PASSWORD_CHANGED', otherSessionsRevoked: true },
        },
      });
      return { ok: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * 忘记密码场景下的 OTP 校验（事务内版本）
   * - 按 purpose 过滤，防跨 scope 串用
   * - 失败计数走 Redis（3 次/5 分钟），超限后作废该 scope 下所有未使用 OTP
   * - 成功后 CAS 消费
   */
  private async verifyResetOtpInTx(
    tx: Prisma.TransactionClient,
    phone: string,
    code: string,
    purpose: SmsPurpose,
    scope: 'buyer' | 'seller',
  ) {
    const records = await tx.smsOtp.findMany({
      where: { phone, purpose, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (records.length === 0) {
      throw new BadRequestException({ code: 'OTP_EXPIRED', message: '验证码无效或已过期' });
    }

    let matched: (typeof records)[number] | null = null;
    for (const r of records) {
      if (await bcrypt.compare(code, r.codeHash)) {
        matched = r;
        break;
      }
    }

    if (!matched) {
      // Redis 失败计数（无 Redis 时 result=null，降级到 OTP 自然过期 5 分钟）
      //
      // consumeFixedWindow 语义：每次调用 INCR，首次 EXPIRE；返回值 count 包含当次调用
      //   - 第 1 次错误：count=1（OTP 仍可用，用户可再试）
      //   - 第 2 次错误：count=2（OTP 仍可用）
      //   - 第 3 次错误：count=3 → 触发作废（用户本次收到 OTP_INVALID，此后所有 OTP 均失效）
      //   - 第 4+ 次：count>=3，作废再次执行（updateMany 幂等，cost 可忽略）
      //
      // 实际语义 = "允许输错 2 次，第 3 次错误即锁死"，符合 spec "3 次输错作废"
      const result = await this.redisCoord.consumeFixedWindow(
        `reset:fail:${scope}:${phone}`,
        3,
        300,
      );
      if (result && result.count >= 3) {
        await tx.smsOtp.updateMany({
          where: { phone, purpose, usedAt: null },
          data: { usedAt: new Date() },
        });
      }
      throw new BadRequestException({ code: 'OTP_INVALID', message: '验证码错误' });
    }

    // CAS 原子消费
    const cas = await tx.smsOtp.updateMany({
      where: { id: matched.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (cas.count === 0) {
      throw new BadRequestException({ code: 'OTP_USED', message: '验证码已被使用，请重新获取' });
    }
  }

  /** S10修复：刷新 Token — CAS 原子撤销，防止并发重复刷新 */
  async refresh(dto: RefreshDto) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);

    // S10修复：使用 updateMany CAS 原子操作，确保同一 refreshToken 只能刷新一次
    // L1修复：同时检查 absoluteExpiresAt 最大续期上限
    const now = new Date();
    const cas = await this.prisma.session.updateMany({
      where: {
        refreshTokenHash,
        status: 'ACTIVE',
        expiresAt: { gt: now },
        OR: [
          { absoluteExpiresAt: null },
          { absoluteExpiresAt: { gt: now } },
        ],
      },
      data: { status: 'REVOKED' },
    });

    if (cas.count === 0) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    // CAS 成功，查找被撤销的 session 获取 userId
    const session = await this.prisma.session.findFirst({
      where: {
        refreshTokenHash,
        status: 'REVOKED',
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!session) {
      throw new UnauthorizedException('刷新令牌已失效');
    }

    // 刷新只能继承签发旧 Session 的同一个可信身份，不能重新挑选该用户的任意微信身份。
    // 旧 Session 没有 authIdentityId 时仍可刷新，但新 Session 继续保持 null，不能用于
    // 需要精确 OpenID 的小程序支付。
    const identity = session.authIdentityId
      ? await this.prisma.authIdentity.findFirst({
          where: { id: session.authIdentityId, userId: session.userId, verified: true },
        })
      : null;

    const miniAppId = this.config.get<string>('WECHAT_MINIAPP_APP_ID', '').trim();
    const loginMethod = identity?.provider === 'WECHAT'
      ? identity.appId && identity.appId === miniAppId
        ? 'wechat-miniapp'
        : 'wechat'
      : 'phone';
    // L1修复：继承旧 session 的 absoluteExpiresAt，防止无限续期
    return this.issueTokens(
      session.userId,
      loginMethod,
      session.absoluteExpiresAt,
      session.authIdentityId,
    );
  }

  /** P1-1: 买家登出，撤销当前 Session */
  async logout(userId: string, accessToken?: string) {
    if (accessToken) {
      const accessTokenHash = this.hashToken(accessToken);
      await this.prisma.session.updateMany({
        where: { userId, accessTokenHash, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
    } else {
      // 无 token 时撤销该用户所有活跃 session
      await this.prisma.session.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
    }
    return { ok: true };
  }

  /** 微信登录 */
  // B02修复：增加 WECHAT_MOCK 环境变量控制，生产环境必须关闭
  async loginWithWeChat(code: string) {
    const profile = await this.exchangeWechatOAuthCode(code, 'mobile');
    return this.loginOrCreateWechatUser(profile);
  }

  /**
   * 微信小程序登录。
   *
   * 小程序 code 只能由服务端调用 code2Session。已存在 appId+openid 身份，或可由
   * unionId 安全归并到既有账号时复用同一 User；无法匹配时在微信身份锁和
   * Serializable 事务内直接创建买家账号，不强制收集手机号。
   */
  async loginWithWechatMiniapp(code: string) {
    const profile = await this.exchangeWechatMiniappCode(code);
    const lockKey = this.wechatIdentityLockKey(profile);
    const lockOwner = randomBytes(16).toString('hex');
    const locked = await this.redisCoord.acquireLock(lockKey, lockOwner, WECHAT_UNION_LOCK_TTL_MS);
    if (locked === false) {
      throw new BadRequestException('微信小程序登录处理中，请稍后重试');
    }
    if (locked === null && this.config.get('NODE_ENV', 'development') === 'production') {
      throw new ServiceUnavailableException('微信小程序登录服务繁忙，请稍后重试');
    }
    const lockLease = locked
      ? this.startWechatIdentityLockRenewal(lockKey, lockOwner)
      : this.createNoopWechatIdentityLockLease();

    try {
      await lockLease.assertHeld();
      // exact + 全部 union 候选必须在每次 Serializable 重试内重新裁决。
      // 不能带着事务外的旧 identity 进入补建，否则锁丢失后新 owner
      // 可能先把同一 unionId 绑到其他用户，旧事务再错误回填第二个用户。
      const resolved = await this.withWechatIdentitySerializableRetry(async (tx) => {
        const identity = await this.findWechatMiniappIdentity(profile, tx);
        if (!identity) return null;

        // 身份补建与用户活动状态复核必须在同一 Serializable 事务内，
        // 使并发注销与重新绑定发生可检测冲突，禁止注销后身份复活。
        const user = await tx.user.findUnique({
          where: { id: identity.userId },
          select: { status: true, deletionExecutedAt: true },
        });
        if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
          throw new ForbiddenException('账号不可用');
        }
        await lockLease.assertHeld();
        const authIdentityId = await this.ensureWechatIdentityForProfile(
          identity,
          profile,
          true,
          tx,
        );
        return { userId: identity.userId, authIdentityId };
      });

      // 不能在身份未匹配时先创建第二个账号。客户端必须明确选择“新建”或
      // 持有手机号短信验证码合并到已有账号；ticket 仅保存微信身份且 5 分钟失效。
      if (!resolved) {
        return {
          requiresAccountChoice: true,
          miniLoginTicket: await this.createMiniappLoginTicket(profile, 'WECHAT_MINIAPP_CREATE_ACCOUNT'),
        };
      }
      await this.ensureBuyerNoForBuyer(resolved.userId);
      await lockLease.assertHeld();
      return await this.issueTokens(
        resolved.userId,
        'wechat-miniapp',
        undefined,
        resolved.authIdentityId,
        () => lockLease.assertHeld(),
      );
    } finally {
      lockLease.stop();
      if (locked) {
        await this.redisCoord.releaseLock(lockKey, lockOwner);
      }
    }
  }

  /** 用户明确选择“作为新用户继续”后，使用一次性微信登录凭证创建账号。 */
  async completeWechatMiniappRegistration(miniLoginTicket: string) {
    const initialTicket = await this.readMiniappLoginTicket(
      miniLoginTicket,
      false,
      'WECHAT_MINIAPP_CREATE_ACCOUNT',
    );
    const profile: WechatLoginProfile = {
      openId: initialTicket.openId,
      unionId: initialTicket.unionId,
      appId: initialTicket.appId,
      appType: 'MINI_PROGRAM',
      accessToken: null,
    };
    const lockKey = this.wechatIdentityLockKey(profile);
    const lockOwner = randomBytes(16).toString('hex');
    const locked = await this.redisCoord.acquireLock(lockKey, lockOwner, WECHAT_UNION_LOCK_TTL_MS);
    if (locked === false) throw new BadRequestException('微信账号处理中，请稍后重试');
    if (locked === null && this.config.get('NODE_ENV', 'development') === 'production') {
      throw new ServiceUnavailableException('微信登录服务繁忙，请稍后重试');
    }
    const lockLease = locked ? this.startWechatIdentityLockRenewal(lockKey, lockOwner) : this.createNoopWechatIdentityLockLease();
    try {
      await this.readMiniappLoginTicket(miniLoginTicket, false, 'WECHAT_MINIAPP_CREATE_ACCOUNT');
      await lockLease.assertHeld();
      const ticket = await this.readMiniappLoginTicket(miniLoginTicket, true, 'WECHAT_MINIAPP_CREATE_ACCOUNT');
      const profileData = await this.fetchWechatUserProfile(null, ticket.openId);
      const resolved = await this.withWechatIdentitySerializableRetry(async (tx) => {
        const existing = await this.findWechatMiniappIdentity(profile, tx);
        if (existing) {
          const user = await tx.user.findUnique({ where: { id: existing.userId }, select: { status: true, deletionExecutedAt: true } });
          if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) throw new ForbiddenException('账号不可用');
          return { userId: existing.userId, authIdentityId: await this.ensureWechatIdentityForProfile(existing, profile, true, tx), created: false };
        }
        await lockLease.assertHeld();
        const user = await tx.user.create({
          data: {
            buyerNo: await nextBuyerNo(tx),
            profile: { create: profileData },
            memberProfile: { create: { referralCode: await pickUniqueReferralCode(tx) } },
            growthAccount: { create: { pointsBalance: 0, pointsTotalEarned: 0, pointsTotalSpent: 0, growthValue: 0 } },
            normalShareProfile: { create: { code: await pickUniqueNormalShareCode(tx as any), status: 'ACTIVE' } },
          },
          select: { id: true },
        });
        const identity = await tx.authIdentity.create({
          data: { userId: user.id, provider: 'WECHAT', identifier: profile.openId, unionId: profile.unionId || null, appId: profile.appId, verified: true, meta: this.mergeWechatIdentityMeta(null, profile) },
        });
        return { userId: user.id, authIdentityId: identity.id, created: true };
      });
      await this.ensureBuyerNoForBuyer(resolved.userId);
      if (resolved.created) {
        this.couponEngine.handleTrigger(resolved.userId, 'REGISTER').catch(() => undefined);
        this.triggerRegisterGrowth(resolved.userId);
      }
      await lockLease.assertHeld();
      return this.issueTokens(resolved.userId, 'wechat-miniapp', undefined, resolved.authIdentityId, () => lockLease.assertHeld());
    } finally {
      lockLease.stop();
      if (locked) await this.redisCoord.releaseLock(lockKey, lockOwner);
    }
  }

  /** 为无手机号账号的注销生成一次性微信身份证明，不能以确认文字替代。 */
  async createWechatMiniappDeletionProof(userId: string, code: string) {
    await this.assertActiveUserForIdentityMutation(userId);
    const profile = await this.exchangeWechatMiniappCode(code);
    const identity = await this.prisma.authIdentity.findFirst({
      where: {
        userId,
        provider: 'WECHAT',
        verified: true,
        OR: [
          { identifier: profile.openId, appId: profile.appId },
          ...(profile.unionId ? [{ unionId: profile.unionId }] : []),
        ],
      },
      select: { id: true },
    });
    if (!identity) {
      throw new ForbiddenException('当前微信与登录账号不一致，请重新登录后再试');
    }
    return {
      wechatDeletionProof: await this.createMiniappLoginTicket(profile, 'WECHAT_MINIAPP_DELETION'),
      expiresInSeconds: Math.floor(MINIAPP_LOGIN_TICKET_TTL_MS / 1000),
    };
  }

  /** 原生 App 使用 OAuth code 进行同等的一次性微信注销验证。 */
  async createWechatDeletionProof(userId: string, code: string) {
    await this.assertActiveUserForIdentityMutation(userId);
    const profile = await this.exchangeWechatOAuthCode(code, 'mobile');
    const identity = await this.prisma.authIdentity.findFirst({
      where: { userId, provider: 'WECHAT', verified: true, OR: [{ identifier: profile.openId, appId: profile.appId }, ...(profile.unionId ? [{ unionId: profile.unionId }] : [])] },
      select: { id: true },
    });
    if (!identity) throw new ForbiddenException('当前微信与登录账号不一致，请重新登录后再试');
    return { wechatDeletionProof: await this.createMiniappLoginTicket(profile, 'WECHAT_MINIAPP_DELETION'), expiresInSeconds: Math.floor(MINIAPP_LOGIN_TICKET_TTL_MS / 1000) };
  }

  /** 在注销事务提交前原子消费微信证明并确认其仍归属当前账号。 */
  async consumeWechatMiniappDeletionProof(userId: string, proof: string) {
    const ticket = await this.readMiniappLoginTicket(proof, true, 'WECHAT_MINIAPP_DELETION');
    const identity = await this.prisma.authIdentity.findFirst({
      where: {
        userId,
        provider: 'WECHAT',
        verified: true,
        OR: [
          { identifier: ticket.openId, appId: ticket.appId },
          ...(ticket.unionId ? [{ unionId: ticket.unionId }] : []),
        ],
      },
      select: { id: true },
    });
    if (!identity) throw new ForbiddenException('微信身份已变化，请重新验证后再试');
  }

  /** 为未匹配的小程序身份发送手机号验证短信，不泄露手机号是否已注册。 */
  async sendWechatMiniappBindPhoneCode(miniLoginTicket: string, phone: string) {
    await this.readMiniappLoginTicket(miniLoginTicket, false, ['WECHAT_MINIAPP_BIND_PHONE', 'WECHAT_MINIAPP_CREATE_ACCOUNT']);
    return this.issueBindPhoneOtp(phone, '小程序账号合并');
  }

  /**
   * 用已验证手机号把小程序身份合并到既有账号；手机号不存在时创建同一个买家账号，
   * 并在一次 Serializable 事务内同时写入 PHONE 与小程序 WECHAT 身份。
   */
  async bindWechatMiniappPhone(miniLoginTicket: string, phone: string, code: string) {
    // 先窥视票据并获取与 App/H5 共用的微信统一身份锁，避免跨渠道并发创建两个 User。
    const initialTicket = await this.readMiniappLoginTicket(miniLoginTicket, false, ['WECHAT_MINIAPP_BIND_PHONE', 'WECHAT_MINIAPP_CREATE_ACCOUNT']);
    const profile: WechatLoginProfile = {
      openId: initialTicket.openId,
      unionId: initialTicket.unionId,
      appId: initialTicket.appId,
      appType: 'MINI_PROGRAM',
      accessToken: null,
    };
    const lockKey = this.wechatIdentityLockKey(profile);
    const lockOwner = randomBytes(16).toString('hex');
    const locked = await this.redisCoord.acquireLock(lockKey, lockOwner, WECHAT_UNION_LOCK_TTL_MS);
    if (locked === false) {
      throw new BadRequestException('微信账号绑定处理中，请稍后重试');
    }
    if (locked === null && this.config.get('NODE_ENV', 'development') === 'production') {
      throw new ServiceUnavailableException('微信账号绑定服务繁忙，请稍后重试');
    }
    const lockLease = locked
      ? this.startWechatIdentityLockRenewal(lockKey, lockOwner)
      : this.createNoopWechatIdentityLockLease();

    try {
    // 获锁后再次确认 ticket 尚未消费，再消费 OTP，最后以 GETDEL 原子消费 ticket。
    await this.readMiniappLoginTicket(miniLoginTicket, false, ['WECHAT_MINIAPP_BIND_PHONE', 'WECHAT_MINIAPP_CREATE_ACCOUNT']);
    await this.verifyCode(phone, code, SmsPurpose.BIND);
    const ticket = await this.readMiniappLoginTicket(miniLoginTicket, true, ['WECHAT_MINIAPP_BIND_PHONE', 'WECHAT_MINIAPP_CREATE_ACCOUNT']);
    if (
      ticket.appId !== profile.appId ||
      ticket.openId !== profile.openId ||
      ticket.unionId !== profile.unionId
    ) {
      throw new BadRequestException('小程序登录凭证不一致，请重新登录');
    }
    await lockLease.assertHeld();

    const MAX_RETRIES = 1;
    let result: { userId: string; created: boolean; authIdentityId: string } | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        result = await this.prisma.$transaction(async (tx) => {
          const exactIdentity = await tx.authIdentity.findFirst({
            where: {
              provider: 'WECHAT',
              identifier: profile.openId,
              appId: profile.appId,
            },
          });
          const unionIdentities = profile.unionId
            ? await tx.authIdentity.findMany({
                where: {
                  provider: 'WECHAT',
                  OR: [
                    { unionId: profile.unionId },
                    { meta: { path: ['unionId'], equals: profile.unionId } },
                  ],
                },
              })
            : [];
          const phoneIdentities = await tx.authIdentity.findMany({
            where: { provider: 'PHONE', identifier: phone },
            select: { userId: true },
          });

          const candidateUserIds = new Set<string>([
            ...(exactIdentity ? [exactIdentity.userId] : []),
            ...unionIdentities.map((item) => item.userId),
            ...phoneIdentities.map((item) => item.userId),
          ]);
          if (candidateUserIds.size > 1) {
            throw new BadRequestException('微信身份与手机号所属账号不一致，请联系客服处理');
          }

          const targetUserId = candidateUserIds.values().next().value as string | undefined;
          if (targetUserId) {
            const targetUser = await tx.user.findUnique({
              where: { id: targetUserId },
              select: { status: true, deletionExecutedAt: true },
            });
            if (
              !targetUser ||
              targetUser.status !== UserStatus.ACTIVE ||
              targetUser.deletionExecutedAt
            ) {
              throw new ForbiddenException('账号不可用');
            }

            const ownPhoneIdentity = await tx.authIdentity.findFirst({
              where: { userId: targetUserId, provider: 'PHONE' },
            });
            if (ownPhoneIdentity && ownPhoneIdentity.identifier !== phone) {
              throw new BadRequestException('微信身份已绑定其他手机号，请使用原手机号登录');
            }
            await lockLease.assertHeld();
            if (!ownPhoneIdentity) {
              await tx.authIdentity.create({
                data: {
                  userId: targetUserId,
                  provider: 'PHONE',
                  identifier: phone,
                  appId: PHONE_AUTH_APP_ID,
                  verified: true,
                },
              });
            }

            let authIdentityId = exactIdentity?.id;
            if (!exactIdentity) {
              const createdIdentity = await tx.authIdentity.create({
                data: {
                  userId: targetUserId,
                  provider: 'WECHAT',
                  identifier: profile.openId,
                  unionId: profile.unionId || null,
                  appId: profile.appId,
                  verified: true,
                  meta: this.mergeWechatIdentityMeta(null, profile),
                },
              });
              authIdentityId = createdIdentity.id;
            }
            return { userId: targetUserId, created: false, authIdentityId: authIdentityId! };
          }

          await lockLease.assertHeld();
          const user = await tx.user.create({
            data: {
              buyerNo: await nextBuyerNo(tx),
              profile: { create: { nickname: '微信用户' } },
              memberProfile: {
                create: { referralCode: await pickUniqueReferralCode(tx) },
              },
              growthAccount: {
                create: {
                  pointsBalance: 0,
                  pointsTotalEarned: 0,
                  pointsTotalSpent: 0,
                  growthValue: 0,
                },
              },
              normalShareProfile: {
                create: {
                  code: await pickUniqueNormalShareCode(tx as any),
                  status: 'ACTIVE',
                },
              },
              authIdentities: {
                create: [
                  {
                    provider: 'PHONE',
                    identifier: phone,
                    appId: PHONE_AUTH_APP_ID,
                    verified: true,
                  },
                  {
                    provider: 'WECHAT',
                    identifier: profile.openId,
                    unionId: profile.unionId || null,
                    appId: profile.appId,
                    verified: true,
                    meta: this.mergeWechatIdentityMeta(null, profile),
                  },
                ],
              },
            },
            select: { id: true },
          });
          const createdMiniIdentity = await tx.authIdentity.findFirst({
            where: {
              userId: user.id,
              provider: 'WECHAT',
              identifier: profile.openId,
              appId: profile.appId,
            },
            select: { id: true },
          });
          if (!createdMiniIdentity) {
            throw new ServiceUnavailableException('微信小程序身份创建失败，请重新登录');
          }
          return {
            userId: user.id,
            created: true,
            authIdentityId: createdMiniIdentity.id,
          };
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        break;
      } catch (err: any) {
        const isPrismaError = err instanceof Prisma.PrismaClientKnownRequestError;
        if (
          isPrismaError &&
          (err.code === 'P2002' || err.code === 'P2034') &&
          attempt < MAX_RETRIES
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
          continue;
        }
        if (isPrismaError && err.code === 'P2002') {
          throw new BadRequestException('账号绑定处理中，请重新发起小程序登录');
        }
        throw err;
      }
    }

    if (!result) {
      throw new ServiceUnavailableException('账号绑定服务繁忙，请稍后重试');
    }
    await this.ensureBuyerNoForBuyer(result.userId);
    if (result.created) {
      this.couponEngine.handleTrigger(result.userId, 'REGISTER').catch((err: any) => {
        this.logger.warn(
          `REGISTER 红包触发失败: userId=${result!.userId}, error=${err?.message}`,
        );
      });
      this.triggerRegisterGrowth(result.userId);
    }
    await lockLease.assertHeld();
    return await this.issueTokens(
      result.userId,
      'wechat-miniapp',
      undefined,
      result.authIdentityId,
      () => lockLease.assertHeld(),
    );
    } finally {
      lockLease.stop();
      if (locked) {
        await this.redisCoord.releaseLock(lockKey, lockOwner);
      }
    }
  }

  async buildH5WechatAuthUrl(input: H5WechatStartQueryDto) {
    const inviteCode = this.normalizeH5InviteCode(input.inviteCode);
    await this.assertH5LandingSessionMatchesInviteCode(input.landingSessionId, inviteCode);
    const appId = this.config.getOrThrow<string>('WECHAT_H5_APP_ID');
    const redirectBase = this.config.get<string>(
      'WECHAT_H5_AUTH_REDIRECT_BASE',
      'https://app.ai-maimai.com/invite',
    );
    const redirectUri = `${redirectBase.replace(/\/+$/, '')}/${encodeURIComponent(inviteCode)}`;
    const state = await this.createH5WechatState({
      inviteCode,
      landingSessionId: input.landingSessionId,
    });

    const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
    url.searchParams.set('appid', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_userinfo');
    url.searchParams.set('state', state);
    url.hash = 'wechat_redirect';
    return url.toString();
  }

  async h5WechatInviteLogin(dto: H5WechatInviteLoginDto) {
    const inviteCode = this.normalizeH5InviteCode(dto.inviteCode);
    const state = await this.consumeH5WechatState(dto.state);
    if (state.inviteCode !== inviteCode) {
      throw new BadRequestException('微信授权状态不匹配，请重新扫码');
    }
    const landingSessionId = state.landingSessionId ?? dto.landingSessionId;
    await this.assertH5LandingSessionMatchesInviteCode(landingSessionId, inviteCode);

    const profile = await this.exchangeWechatOAuthCode(dto.wechatCode, 'h5');
    if (!profile.unionId) {
      throw new BadRequestException('微信授权未返回 unionId，请确认公众号已绑定微信开放平台后重新登录');
    }
    const session = await this.loginOrCreateWechatUser(profile);
    const inviteBinding = await this.inviteH5.bindAfterAuth({
      userId: session.userId,
      inviteCode,
      landingSessionId,
    });

    return {
      ...session,
      user: { id: session.userId },
      inviteBinding,
    };
  }

  /**
   * 用 wechat code 换取微信用户公开资料（openId + headimgurl + nickname）
   * 不创建用户、不签 Token。给"绑定微信后回填头像"等已登录态场景用
   *
   * @returns 失败抛 BadRequestException；mock 模式下返回稳定的派生 openId 但 avatarUrl 为 undefined
   */
  async exchangeCodeForWechatProfile(code: string): Promise<{
    openId: string;
    unionId: string;
    nickname: string;
    avatarUrl?: string;
  }> {
    const { openId, unionId, accessToken } = await this.exchangeWechatOAuthCode(code, 'mobile');
    const profile = await this.fetchWechatUserProfile(accessToken, openId);
    return { openId, unionId, nickname: profile.nickname, avatarUrl: profile.avatarUrl };
  }

  private async exchangeWechatOAuthCode(
    code: string,
    source: WechatOAuthSource,
  ): Promise<WechatLoginProfile> {
    const wechatMock = this.config.get('WECHAT_MOCK', 'false');
    const nodeEnv = this.config.get('NODE_ENV', 'development');
    const appId = source === 'h5'
      ? this.config.get<string>('WECHAT_H5_APP_ID', 'mock-h5-service-account')
      : this.config.get<string>('WECHAT_APP_ID', 'mock-mobile-app');
    const appType = source === 'h5' ? 'H5_SERVICE_ACCOUNT' : 'MOBILE_APP';

    if (wechatMock === 'true') {
      if (nodeEnv === 'production') {
        this.logger.error('[WeChat] 生产环境禁止 Mock 微信登录');
        throw new ServiceUnavailableException('微信登录配置不可用');
      }
      const openIdPrefix = source === 'h5' ? 'wx_h5_openid' : 'wx_openid';
      const openId = createHash('sha256').update(`${openIdPrefix}_${code}`).digest('hex').slice(0, 28);
      const unionId = createHash('sha256').update(`wx_unionid_${code}`).digest('hex').slice(0, 28);
      this.logger.log(
        `[WeChat Mock] 已生成测试身份（source=${source}, openId=${this.maskOpaqueId(openId)}, unionId=${this.maskOpaqueId(unionId)}）`,
      );
      return { openId, unionId, appId, appType, accessToken: null };
    } else {
      const realAppId = source === 'h5'
        ? this.config.getOrThrow<string>('WECHAT_H5_APP_ID')
        : this.config.getOrThrow<string>('WECHAT_APP_ID');
      const appSecret = source === 'h5'
        ? this.config.getOrThrow<string>('WECHAT_H5_APP_SECRET')
        : this.config.getOrThrow<string>('WECHAT_APP_SECRET');
      const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${realAppId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`;
      const tokenRes = await fetch(tokenUrl);
      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        openid?: string;
        unionid?: string;
        errcode?: number;
        errmsg?: string;
      };
      if (tokenData.errcode || !tokenData.openid) {
        this.logger.error(`[WeChat] token 换取失败: errcode=${tokenData.errcode}, errmsg=${tokenData.errmsg}`);
        throw new BadRequestException(`微信授权失败：${tokenData.errmsg || '未知错误'}`);
      }
      const openId = tokenData.openid;
      const unionId = tokenData.unionid || '';
      const accessToken = tokenData.access_token || null;
      this.logger.log(
        `[WeChat] 授权成功（source=${source}, openId=${this.maskOpaqueId(openId)}, unionId=${this.maskOpaqueId(unionId)}）`,
      );
      return { openId, unionId, appId: realAppId, appType, accessToken };
    }
  }

  /** 小程序专用 code2Session；session_key 仅在本地响应对象中出现，解析后立即丢弃。 */
  private async exchangeWechatMiniappCode(code: string): Promise<WechatLoginProfile> {
    const wechatMock = this.config.get(
      'WECHAT_MINIAPP_MOCK',
      this.config.get('WECHAT_MOCK', 'false'),
    );
    const nodeEnv = this.config.get('NODE_ENV', 'development');
    const configuredAppId = this.config.get<string>('WECHAT_MINIAPP_APP_ID', '').trim();
    const appId = configuredAppId || 'mock-mini-program';

    if (wechatMock === 'true') {
      if (nodeEnv === 'production') {
        this.logger.error('[WeChat Miniapp] 生产环境禁止 Mock 登录');
        throw new ServiceUnavailableException('微信小程序登录配置不可用');
      }
      return {
        openId: createHash('sha256')
          .update(`wx_miniapp_openid_${appId}_${code}`)
          .digest('hex')
          .slice(0, 28),
        // 与既有 App mock 使用相同派生规则，便于测试跨端 unionId 合并。
        unionId: createHash('sha256').update(`wx_unionid_${code}`).digest('hex').slice(0, 28),
        appId,
        appType: 'MINI_PROGRAM',
        accessToken: null,
      };
    }

    const realAppId = this.config.getOrThrow<string>('WECHAT_MINIAPP_APP_ID').trim();
    const appSecret = this.config.getOrThrow<string>('WECHAT_MINIAPP_APP_SECRET').trim();
    if (!realAppId || !appSecret) {
      throw new ServiceUnavailableException('微信小程序登录配置不可用');
    }
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', realAppId);
    url.searchParams.set('secret', appSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    let data: {
      openid?: string;
      unionid?: string;
      session_key?: string;
      errcode?: number;
      errmsg?: string;
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WECHAT_CODE2SESSION_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        throw new ServiceUnavailableException('微信小程序登录服务暂不可用');
      }
      data = (await response.json()) as typeof data;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('微信小程序登录服务暂不可用');
    } finally {
      clearTimeout(timeout);
    }

    if (data.errcode || !data.openid) {
      this.logger.warn(
        `[WeChat Miniapp] code2Session 失败: errcode=${data.errcode ?? 'unknown'}`,
      );
      throw new BadRequestException('微信小程序登录失败，请重新授权');
    }

    return {
      openId: data.openid,
      unionId: data.unionid || '',
      appId: realAppId,
      appType: 'MINI_PROGRAM',
      accessToken: null,
    };
  }

  private async findWechatMiniappIdentity(
    profile: WechatLoginProfile,
    client: Pick<Prisma.TransactionClient, 'authIdentity'> = this.prisma,
  ) {
    const exactIdentity = await client.authIdentity.findFirst({
      where: {
        provider: 'WECHAT',
        identifier: profile.openId,
        appId: profile.appId,
      },
      include: { user: { select: { status: true, deletionExecutedAt: true } } },
    });

    const unionIdentities = profile.unionId
      ? await client.authIdentity.findMany({
          where: {
            provider: 'WECHAT',
            OR: [
              { unionId: profile.unionId },
              { meta: { path: ['unionId'], equals: profile.unionId } },
            ],
          },
          include: { user: { select: { status: true, deletionExecutedAt: true } } },
        })
      : [];
    const unionUserIds = new Set(unionIdentities.map((item) => item.userId));
    if (unionUserIds.size > 1) {
      throw new BadRequestException('微信统一身份关联多个账号，请联系客服处理');
    }
    const unionIdentity = unionIdentities[0] ?? null;
    if (exactIdentity && unionIdentity && exactIdentity.userId !== unionIdentity.userId) {
      throw new BadRequestException('微信小程序身份与统一身份冲突，请联系客服处理');
    }
    return exactIdentity ?? unionIdentity;
  }

  private async createMiniappLoginTicket(
    profile: WechatLoginProfile,
    purpose: MiniappLoginTicketPurpose = 'WECHAT_MINIAPP_BIND_PHONE',
  ): Promise<string> {
    const ticket = randomBytes(32).toString('hex');
    const now = Date.now();
    const payload: MiniappLoginTicketPayload = {
      purpose,
      appId: profile.appId,
      openId: profile.openId,
      unionId: profile.unionId,
      issuedAt: now,
      expiresAt: now + MINIAPP_LOGIN_TICKET_TTL_MS,
    };
    const value = JSON.stringify(payload);
    const key = this.miniappLoginTicketKey(ticket);
    const stored = await this.redisCoord.set(key, value, MINIAPP_LOGIN_TICKET_TTL_MS);
    if (!stored) {
      if (this.config.get('NODE_ENV', 'development') === 'production') {
        throw new ServiceUnavailableException('微信小程序登录服务繁忙，请稍后重试');
      }
      miniappTicketMemoryStore.set(key, { value, expiresAt: payload.expiresAt });
    }
    return ticket;
  }

  private async readMiniappLoginTicket(
    ticket: string,
    consume: boolean,
    expectedPurpose: MiniappLoginTicketPurpose | MiniappLoginTicketPurpose[] = 'WECHAT_MINIAPP_BIND_PHONE',
  ): Promise<MiniappLoginTicketPayload> {
    if (!/^[a-f0-9]{64}$/.test(ticket)) {
      throw new BadRequestException('小程序登录凭证无效，请重新登录');
    }
    const key = this.miniappLoginTicketKey(ticket);
    let value = consume
      ? await this.redisCoord.getdel(key)
      : await this.redisCoord.get(key);

    if (!value) {
      const memoryValue = miniappTicketMemoryStore.get(key);
      if (memoryValue?.expiresAt && memoryValue.expiresAt > Date.now()) {
        value = memoryValue.value;
      }
      if (consume || (memoryValue && memoryValue.expiresAt <= Date.now())) {
        miniappTicketMemoryStore.delete(key);
      }
    }
    if (!value) {
      throw new BadRequestException('小程序登录凭证无效或已过期，请重新登录');
    }

    let payload: MiniappLoginTicketPayload;
    try {
      payload = JSON.parse(value) as MiniappLoginTicketPayload;
    } catch {
      throw new BadRequestException('小程序登录凭证无效，请重新登录');
    }
    const now = Date.now();
    if (
      !(Array.isArray(expectedPurpose) ? expectedPurpose : [expectedPurpose]).includes(payload.purpose) ||
      typeof payload.appId !== 'string' ||
      !payload.appId ||
      typeof payload.openId !== 'string' ||
      !payload.openId ||
      typeof payload.unionId !== 'string' ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      payload.issuedAt > now + 30_000 ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt > MINIAPP_LOGIN_TICKET_TTL_MS
    ) {
      if (!consume) {
        await this.redisCoord.del(key);
        miniappTicketMemoryStore.delete(key);
      }
      throw new BadRequestException('小程序登录凭证无效或已过期，请重新登录');
    }
    return payload;
  }

  private miniappLoginTicketKey(ticket: string): string {
    return `${MINIAPP_LOGIN_TICKET_KEY_PREFIX}:${this.hashKey(ticket)}`;
  }

  private async loginOrCreateWechatUser(profile: WechatLoginProfile) {
    const lockKey = this.wechatIdentityLockKey(profile);
    const lockOwner = randomBytes(16).toString('hex');
    const locked = await this.redisCoord.acquireLock(lockKey, lockOwner, WECHAT_UNION_LOCK_TTL_MS);
    if (locked === false) {
      throw new BadRequestException('微信登录处理中，请稍后重试');
    }
    if (locked === null && this.config.get('NODE_ENV', 'development') === 'production') {
      throw new BadRequestException('微信登录服务繁忙，请稍后重试');
    }
    const lockLease = locked
      ? this.startWechatIdentityLockRenewal(lockKey, lockOwner)
      : this.createNoopWechatIdentityLockLease();

    try {
      return await this.loginOrCreateWechatUserUnlocked(profile, lockLease);
    } finally {
      lockLease.stop();
      if (locked) {
        await this.redisCoord.releaseLock(lockKey, lockOwner);
      }
    }
  }

  private async loginOrCreateWechatUserUnlocked(
    profile: WechatLoginProfile,
    lockLease: WechatIdentityLockLease,
  ) {
    // 外部微信资料请求不放进数据库事务；归属首查、活动状态复核以及
    // 身份/用户写入则全部在同一个 Serializable 事务内完成。
    const profileData = await this.fetchWechatUserProfile(profile.accessToken, profile.openId);

    await lockLease.assertHeld();
    const resolved = await this.withWechatIdentitySerializableRetry(async (tx) => {
      const identity = await this.findWechatIdentity(profile, tx);
      if (identity) {
        const user = await tx.user.findUnique({
          where: { id: identity.userId },
          select: { status: true, deletionExecutedAt: true },
        });
        if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
          throw new ForbiddenException('账号不可用');
        }
        await lockLease.assertHeld();
        await this.ensureWechatIdentityForProfile(identity, profile, false, tx);
        return { userId: identity.userId, created: false };
      }

      await lockLease.assertHeld();
      const user = await tx.user.create({
        data: {
          buyerNo: await nextBuyerNo(tx),
          profile: {
            create: profileData,
          },
          memberProfile: {
            create: { referralCode: await pickUniqueReferralCode(tx) },
          },
          growthAccount: {
            create: {
              pointsBalance: 0,
              pointsTotalEarned: 0,
              pointsTotalSpent: 0,
              growthValue: 0,
            },
          },
          normalShareProfile: {
            create: {
              code: await pickUniqueNormalShareCode(tx as any),
              status: 'ACTIVE',
            },
          },
          authIdentities: {
            create: {
              provider: 'WECHAT',
              identifier: profile.openId,
              unionId: profile.unionId || null,
              appId: profile.appId,
              verified: true,
              meta: {
                unionId: profile.unionId,
                appId: profile.appId,
                appType: profile.appType,
                nickname: profileData.nickname,
                avatarUrl: profileData.avatarUrl,
              },
            },
          },
        },
        select: { id: true },
      });
      return { userId: user.id, created: true };
    });

    await this.ensureBuyerNoForBuyer(resolved.userId);
    if (resolved.created) {
      this.couponEngine.handleTrigger(resolved.userId, 'REGISTER').catch((err: any) => {
        this.logger.warn(
          `REGISTER 红包触发失败: userId=${resolved.userId}, error=${err?.message}`,
        );
      });
      this.triggerRegisterGrowth(resolved.userId);
    }

    await lockLease.assertHeld();
    return this.issueTokens(
      resolved.userId,
      'wechat',
      undefined,
      undefined,
      () => lockLease.assertHeld(),
    );
  }

  private async assertH5LandingSessionMatchesInviteCode(
    landingSessionId: string | undefined,
    inviteCode: string,
  ) {
    if (!landingSessionId) return;
    const landing = await this.prisma.inviteH5LandingEvent.findUnique({
      where: { landingSessionId },
      select: { inviteCode: true },
    });
    if (!landing) {
      throw new BadRequestException('邀请会话已失效，请重新扫码');
    }
    if (this.normalizeH5InviteCode(landing.inviteCode) !== inviteCode) {
      throw new BadRequestException('微信授权状态不匹配，请重新扫码');
    }
  }

  private async findWechatIdentity(
    profile: WechatLoginProfile,
    client: Pick<Prisma.TransactionClient, 'authIdentity'> = this.prisma,
  ) {
    // App/H5 同样先查当前 appId+openid（含 legacy null appId），再收集全部
    // unionId 列与 legacy meta 候选。两类候选不可以短路返回，否则会漏掉跨端归属冲突。
    const openIdIdentities = await client.authIdentity.findMany({
      where: {
        provider: 'WECHAT',
        identifier: profile.openId,
        OR: [
          { appId: profile.appId },
          { appId: null },
        ],
      },
      include: { user: { select: { status: true, deletionExecutedAt: true } } },
    });
    const exactIdentity = openIdIdentities.find(
      (identity) => identity.appId === profile.appId,
    ) ?? null;
    const legacyOpenIdIdentity = openIdIdentities.find(
      (identity) => identity.appId === null,
    ) ?? null;

    const unionIdentities = profile.unionId
      ? await client.authIdentity.findMany({
          where: {
            provider: 'WECHAT',
            OR: [
              { unionId: profile.unionId },
              { meta: { path: ['unionId'], equals: profile.unionId } },
            ],
          },
          include: { user: { select: { status: true, deletionExecutedAt: true } } },
        })
      : [];
    const candidateUserIds = new Set<string>([
      ...openIdIdentities.map((identity) => identity.userId),
      ...unionIdentities.map((identity) => identity.userId),
    ]);
    if (candidateUserIds.size > 1) {
      throw new BadRequestException('微信身份与统一身份冲突，请联系客服处理');
    }
    return exactIdentity ?? legacyOpenIdIdentity ?? unionIdentities[0] ?? null;
  }

  private async ensureWechatIdentityForProfile(
    identity: {
      id: string;
      userId: string;
      identifier: string;
      unionId?: string | null;
      appId?: string | null;
      meta?: Prisma.JsonValue | null;
    },
    profile: WechatLoginProfile,
    exactAppIdOnly = false,
    client: Pick<Prisma.TransactionClient, 'authIdentity'> = this.prisma,
  ): Promise<string> {
    const sameOpenId = identity.identifier === profile.openId;
    const updateData: Prisma.AuthIdentityUpdateInput = {};
    if (!identity.unionId && profile.unionId) {
      updateData.unionId = profile.unionId;
    }
    if (sameOpenId && !identity.appId) {
      updateData.appId = profile.appId;
    }
    if (Object.keys(updateData).length > 0) {
      updateData.meta = this.mergeWechatIdentityMeta(identity.meta, profile);
      await client.authIdentity.update({
        where: { id: identity.id },
        data: updateData,
      });
    }

    if (sameOpenId && (!exactAppIdOnly || identity.appId === profile.appId)) {
      return identity.id;
    }

    const currentOpenIdIdentity = await client.authIdentity.findFirst({
      where: {
        provider: 'WECHAT',
        identifier: profile.openId,
        ...(exactAppIdOnly
          ? { appId: profile.appId }
          : {
              OR: [
                { appId: profile.appId },
                { appId: null },
              ],
            }),
      },
    });
    if (currentOpenIdIdentity) {
      if (currentOpenIdIdentity.userId !== identity.userId) {
        throw new BadRequestException('微信身份已绑定其他账号');
      }

      const currentUpdate: Prisma.AuthIdentityUpdateInput = {};
      if (!currentOpenIdIdentity.unionId && profile.unionId) {
        currentUpdate.unionId = profile.unionId;
      }
      if (!currentOpenIdIdentity.appId) {
        currentUpdate.appId = profile.appId;
      }
      if (Object.keys(currentUpdate).length > 0) {
        currentUpdate.meta = this.mergeWechatIdentityMeta(currentOpenIdIdentity.meta, profile);
        await client.authIdentity.update({
          where: { id: currentOpenIdIdentity.id },
          data: currentUpdate,
        });
      }
      return currentOpenIdIdentity.id;
    }

    const createdIdentity = await client.authIdentity.create({
      data: {
        userId: identity.userId,
        provider: 'WECHAT',
        identifier: profile.openId,
        unionId: profile.unionId || null,
        appId: profile.appId,
        verified: true,
        meta: this.mergeWechatIdentityMeta(null, profile),
      },
    });
    return createdIdentity.id;
  }

  /**
   * App/H5 首登与小程序自动补建身份都使用 Serializable 有限重试。
   * 最终仍冲突必须 fail-closed，避免锁过期/多实例并发时签发没有可信身份的 Session。
   */
  private async withWechatIdentitySerializableRetry<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: any) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError
          && (error.code === 'P2034' || error.code === 'P2002');
        if (retryable && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
          continue;
        }
        if (retryable) {
          throw new ServiceUnavailableException('微信登录服务繁忙，请稍后重试');
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException('微信登录服务繁忙，请稍后重试');
  }

  private mergeWechatIdentityMeta(
    meta: Prisma.JsonValue | null | undefined,
    profile: WechatLoginProfile,
  ): Prisma.JsonObject {
    const existing = meta && typeof meta === 'object' && !Array.isArray(meta)
      ? meta as Prisma.JsonObject
      : {};
    return {
      ...existing,
      unionId: profile.unionId,
      appId: profile.appId,
      appType: profile.appType,
    };
  }

  private async createH5WechatState(input: {
    inviteCode: string;
    landingSessionId?: string;
  }): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const payload: H5WechatStatePayload = {
      inviteCode: this.normalizeH5InviteCode(input.inviteCode),
      landingSessionId: input.landingSessionId,
      nonce,
      iat: Date.now(),
    };
    const value = JSON.stringify(payload);
    const stored = await this.redisCoord.set(
      this.h5WechatStateKey(nonce),
      value,
      H5_WECHAT_STATE_TTL_MS,
    );

    if (!stored) {
      if (this.config.get('NODE_ENV', 'development') === 'production') {
        throw new BadRequestException('微信授权状态暂不可用，请稍后重试');
      }
      h5WechatStateMemoryStore.set(nonce, {
        value,
        expiresAt: Date.now() + H5_WECHAT_STATE_TTL_MS,
      });
    }

    return nonce;
  }

  private async consumeH5WechatState(state: string | null | undefined): Promise<H5WechatStatePayload> {
    if (!state || !/^[a-f0-9]{32}$/i.test(state)) {
      throw new BadRequestException('微信授权状态无效，请重新扫码');
    }
    const nonce = state.toLowerCase();
    let value = await this.redisCoord.getdel(this.h5WechatStateKey(nonce));

    if (!value) {
      const memoryValue = h5WechatStateMemoryStore.get(nonce);
      if (memoryValue && memoryValue.expiresAt > Date.now()) {
        value = memoryValue.value;
      }
      h5WechatStateMemoryStore.delete(nonce);
    }

    if (!value) {
      throw new BadRequestException('微信授权状态无效，请重新扫码');
    }

    let payload: H5WechatStatePayload;
    try {
      payload = JSON.parse(value);
    } catch {
      throw new BadRequestException('微信授权状态无效，请重新扫码');
    }

    if (
      !payload ||
      typeof payload.inviteCode !== 'string' ||
      typeof payload.iat !== 'number' ||
      payload.nonce !== nonce
    ) {
      throw new BadRequestException('微信授权状态无效，请重新扫码');
    }
    if (Date.now() - payload.iat > 10 * 60_000) {
      throw new BadRequestException('微信授权已过期，请重新扫码');
    }

    return {
      inviteCode: this.normalizeH5InviteCode(payload.inviteCode),
      landingSessionId: payload.landingSessionId,
      nonce: payload.nonce,
      iat: payload.iat,
    };
  }

  private h5WechatStateKey(nonce: string): string {
    return `${H5_WECHAT_STATE_KEY_PREFIX}:${nonce}`;
  }

  private normalizeH5InviteCode(code: string): string {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalized)) {
      throw new BadRequestException('邀请链接不可用');
    }
    return normalized;
  }

  /** Apple 登录（占位） */
  async loginWithApple() {
    throw new BadRequestException('Apple 登录暂未开放');
  }

  /**
   * 用 access_token + openId 调 /sns/userinfo 拿微信用户资料。
   * 拿不到就用 "微信" + openId 尾段 6 位做 fallback 昵称，保证有辨识度。
   * 任何失败都不抛异常（不阻塞登录）。
   */
  private async fetchWechatUserProfile(
    accessToken: string | null,
    openId: string,
  ): Promise<{
    nickname: string;
    avatarUrl?: string;
    gender?: 'UNKNOWN' | 'MALE' | 'FEMALE';
    city?: string;
  }> {
    const fallbackNickname = `微信${openId.slice(-6)}`;

    if (!accessToken) {
      // Mock 模式或 token 缺失，直接用 fallback（至少有辨识度）
      return { nickname: fallbackNickname };
    }

    try {
      const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(accessToken)}&openid=${encodeURIComponent(openId)}&lang=zh_CN`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), WECHAT_OAUTH_HTTP_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal, redirect: 'error' });
      } finally {
        clearTimeout(timeout);
      }
      const data = (await res.json()) as {
        nickname?: string;
        headimgurl?: string;
        sex?: 0 | 1 | 2;
        city?: string;
        errcode?: number;
        errmsg?: string;
      };

      if (data.errcode || !data.nickname) {
        this.logger.warn(
          `[WeChat] userinfo 拉取失败或昵称为空: errcode=${data.errcode}, errmsg=${data.errmsg}`,
        );
        return { nickname: fallbackNickname };
      }

      const genderMap: Record<number, 'UNKNOWN' | 'MALE' | 'FEMALE'> = {
        0: 'UNKNOWN',
        1: 'MALE',
        2: 'FEMALE',
      };

      return {
        nickname: data.nickname,
        avatarUrl: data.headimgurl || undefined,
        gender: data.sex != null ? genderMap[data.sex] : undefined,
        city: data.city || undefined,
      };
    } catch (err: any) {
      this.logger.warn(`[WeChat] userinfo 拉取异常: ${err?.message}`);
      return { nickname: fallbackNickname };
    }
  }

  // ---- 内部方法 ----

  private async ensureBuyerNoForBuyer(userId: string): Promise<string | null> {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { buyerNo: true },
    });
    if (existing?.buyerNo) return existing.buyerNo;

    const buyerNo = await nextBuyerNo(this.prisma);
    const updated = await this.prisma.user.updateMany({
      where: { id: userId, buyerNo: null },
      data: { buyerNo },
    });
    if (updated.count > 0) return buyerNo;

    const raced = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { buyerNo: true },
    });
    return raced?.buyerNo ?? null;
  }

  private async loginByPhone(phone: string, mode: string, code?: string, password?: string) {
    const identity = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: phone },
      include: { user: { select: { status: true } } },
    });

    // 账号注销护栏：通过身份找到用户后，非 ACTIVE（含 DELETED/BANNED）一律不签发 Session。
    // 正常情况下注销会把 identifier 改写成 tombstone，此处不会命中；本守卫为防御性兜底
    // （注销执行与 tombstone 写入之间的并发窗口、或异常态用户复用真实号登录）。
    if (identity && identity.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('账号不可用');
    }

    if (mode === 'code') {
      return this.loginByPhoneCode(phone, code);
    } else {
      // 密码模式
      await this.enforcePasswordLoginLock('PHONE', phone);
      if (!identity) {
        await this.recordLoginAttempt('PHONE', phone, 'password', false);
        throw new UnauthorizedException('手机号未注册');
      }
      const meta = identity.meta as any;
      if (!meta?.passwordHash) throw new BadRequestException('该账号未设置密码，请使用验证码登录');
      const valid = await bcrypt.compare(password || '', meta.passwordHash);
      if (!valid) {
        await this.recordLoginAttempt('PHONE', phone, 'password', false, identity.userId);
        throw new UnauthorizedException('密码错误');
      }
      await this.recordLoginAttempt('PHONE', phone, 'password', true, identity.userId);
      await this.ensureBuyerNoForBuyer(identity.userId);
      return this.issueTokens(identity.userId, 'phone');
    }
  }

  private async loginByPhoneCode(phone: string, code?: string, nickname?: string) {
    const identity = await this.prisma.authIdentity.findFirst({
      where: { provider: 'PHONE', identifier: phone },
      include: { user: { select: { status: true } } },
    });

    if (identity && identity.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('账号不可用');
    }

    try {
      await this.verifyCode(phone, code, SmsPurpose.LOGIN);
    } catch (err) {
      await this.recordLoginAttempt('PHONE', phone, 'code', false, identity?.userId);
      throw err;
    }

    if (!identity) {
      try {
        const newUser = await this.prisma.user.create({
          data: {
            buyerNo: await nextBuyerNo(this.prisma),
            profile: { create: { nickname: nickname?.trim() || '新用户' } },
            memberProfile: { create: { referralCode: await pickUniqueReferralCode(this.prisma) } },
            growthAccount: {
              create: {
                pointsBalance: 0,
                pointsTotalEarned: 0,
                pointsTotalSpent: 0,
                growthValue: 0,
              },
            },
            normalShareProfile: {
              create: {
                code: await pickUniqueNormalShareCode(this.prisma as any),
                status: 'ACTIVE',
              },
            },
            authIdentities: {
              create: {
                provider: 'PHONE',
                identifier: phone,
                appId: PHONE_AUTH_APP_ID,
                verified: true,
              },
            },
          },
        });
        await this.recordLoginAttempt('PHONE', phone, 'code', true, newUser.id);
        // Phase F: 验证码登录自动注册也触发 REGISTER 红包
        this.couponEngine.handleTrigger(newUser.id, 'REGISTER').catch((err: any) => {
          this.logger.warn(`REGISTER 红包触发失败: userId=${newUser.id}, error=${err?.message}`);
        });
        this.triggerRegisterGrowth(newUser.id);
        return this.issueTokens(newUser.id, 'phone');
      } catch (err: any) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const racedIdentity = await this.prisma.authIdentity.findFirst({
            where: { provider: 'PHONE', identifier: phone },
            include: { user: { select: { status: true } } },
          });
          if (racedIdentity) {
            if (racedIdentity.user.status !== UserStatus.ACTIVE) {
              throw new ForbiddenException('账号不可用');
            }
            await this.recordLoginAttempt('PHONE', phone, 'code', true, racedIdentity.userId);
            await this.ensureBuyerNoForBuyer(racedIdentity.userId);
            return this.issueTokens(racedIdentity.userId, 'phone');
          }
        }
        throw err;
      }
    }

    await this.recordLoginAttempt('PHONE', phone, 'code', true, identity.userId);
    await this.ensureBuyerNoForBuyer(identity.userId);
    return this.issueTokens(identity.userId, 'phone');
  }

  private triggerRegisterGrowth(userId: string) {
    this.growthEvents.receive({
      userId,
      behaviorCode: 'REGISTER',
      idempotencyKey: `REGISTER:${userId}`,
      refType: 'USER',
      refId: userId,
    }).catch((err: any) => {
      this.logger.warn(`REGISTER 成长奖励触发失败: userId=${userId}, error=${err?.message}`);
    });
  }

  /**
   * S07修复：验证码校验 — 原子 CAS 消费，防止并发重复使用
   * purpose 改为必填参数（2026-04-23 忘记密码功能），强制调用方显式声明 scope，
   * 防止跨 purpose 串用（例如 RESET 验证码被误用于 LOGIN）。
   */
  private async verifyCode(target: string, code: string | undefined, purpose: SmsPurpose) {
    this.assertProductionMockDisabled(
      'SMS_MOCK',
      this.config.get('SMS_MOCK', 'false'),
      '短信验证码服务',
    );
    if (!code) throw new BadRequestException('请输入验证码');

    // 查找最近一条未使用且未过期的验证码（强过滤 purpose）
    const records = await this.prisma.smsOtp.findMany({
      where: {
        phone: target,
        purpose,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 5, // 最多检查最近5条
    });

    if (records.length === 0) throw new BadRequestException('验证码无效或已过期');

    // 逐条比较验证码（bcrypt 无法在 where 中直接比较）
    let matchedRecord: typeof records[0] | null = null;
    for (const record of records) {
      const valid = await bcrypt.compare(code, record.codeHash);
      if (valid) {
        matchedRecord = record;
        break;
      }
    }

    if (!matchedRecord) throw new BadRequestException('验证码错误');

    // S07修复：CAS 原子消费 — 仅当 usedAt 仍为 null 时才标记已使用
    const cas = await this.prisma.smsOtp.updateMany({
      where: { id: matchedRecord.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (cas.count === 0) {
      // 验证码已被另一个并发请求消费
      throw new BadRequestException('验证码已被使用，请重新获取');
    }
  }

  /** 签发 Token 对（JWT + Session） */
  private async issueTokens(
    userId: string,
    loginMethod: string,
    inheritedAbsoluteExpiresAt?: Date | null,
    authIdentityId?: string | null,
    beforeTokenSign?: () => Promise<void>,
  ) {
    await this.assertActiveUserForSessionIssue(userId);

    if (authIdentityId) {
      const trustedIdentity = await this.prisma.authIdentity.findFirst({
        where: { id: authIdentityId, userId, verified: true },
        select: { id: true },
      });
      if (!trustedIdentity) {
        throw new UnauthorizedException('登录身份已失效，请重新登录');
      }
    }

    const expiresIn = this.config.get('JWT_EXPIRES_IN', '15m');

    // 生成 refresh token 并存储哈希
    const refreshTokenStr = randomBytes(64).toString('hex');
    const refreshTokenHash = this.hashToken(refreshTokenStr);
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 天

    // M06修复：先创建 Session 获取 sessionId，再将 sessionId 写入 JWT payload
    // 这样 validate() 可以精确校验当前 token 对应的会话，而非用户的任意活跃会话
    // L1修复：首次登录设 90 天绝对上限；refresh 时继承旧值，不可重置
    const absoluteExpiresAt = inheritedAbsoluteExpiresAt
      ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const session = await this.prisma.session.create({
      data: {
        userId,
        authIdentityId: authIdentityId ?? null,
        accessTokenHash: '', // 占位，下面更新
        refreshTokenHash,
        status: 'ACTIVE',
        expiresAt: refreshExpiresAt,
        absoluteExpiresAt,
      },
    });

    if (beforeTokenSign) {
      try {
        await beforeTokenSign();
      } catch (error) {
        // 锁已失效时不得签发 JWT；同时撤销尚未对客户端暴露的孤立 Session。
        await this.prisma.session.updateMany({
          where: { id: session.id, status: 'ACTIVE' },
          data: { status: 'REVOKED' },
        });
        throw error;
      }
    }

    // JWT payload 包含 sessionId，用于 validate() 精确匹配会话
    const payload = { sub: userId, sessionId: session.id };
    const accessToken = this.jwt.sign(payload, { expiresIn });

    // 回填 accessTokenHash（logout 时用于精确撤销）
    const accessTokenHash = this.hashToken(accessToken);
    await this.prisma.session.update({
      where: { id: session.id },
      data: { accessTokenHash },
    });

    return {
      accessToken,
      refreshToken: refreshTokenStr,
      expiresAt: new Date(Date.now() + this.parseExpiry(expiresIn)).toISOString(),
      userId,
      loginMethod,
    };
  }

  /** SHA-256 哈希（用于 token 存储） */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async assertActiveUserForSessionIssue(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, deletionExecutedAt: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
      throw new ForbiddenException('账号已注销或不可用，不能签发新的登录会话');
    }
  }

  private parseExpiry(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 15 * 60 * 1000; // 默认 15 分钟
    const [, num, unit] = match;
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return parseInt(num) * (multipliers[unit] || multipliers.d);
  }

  private maskContact(value: string): string {
    return sanitizeStringForLog(value, { maxStringLength: 128 });
  }

  private maskOpaqueId(value: string): string {
    if (!value) return '[EMPTY]';
    if (value.length <= 8) return '[REDACTED]';
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
  }

  /**
   * M4终态：验证码发送增加目标维度限频（手机号/邮箱）
   * - 优先使用 Redis 固定窗口限流（支持多实例）
   * - 无 Redis 时回退到数据库 Serializable 事务（计数 + 写入验证码原子化）
   */
  private async createOtpWithRateLimit(
    target: string,
    codeHash: string,
    expiresAt: Date,
    purpose: SmsPurpose,
  ) {
    const normalized = this.normalizeIdentifier(target);
    const targetKey = this.hashKey(`${purpose}:${normalized}`);
    const limits = AuthService.OTP_RATE_LIMITS[purpose];

    const minute = await this.redisCoord.consumeFixedWindow(
      `rl:otp:target:${targetKey}:1m`,
      limits.perMinute,
      60,
    );
    if (minute && !minute.allowed) {
      throw new HttpException('发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    // 窗口 key 用 purpose + 窗口长度双重隔离，避免不同 purpose 切换窗口长度后 key 冲突
    const window = await this.redisCoord.consumeFixedWindow(
      `rl:otp:target:${targetKey}:${limits.windowSec}s`,
      limits.windowCount,
      limits.windowSec,
    );
    if (window && !window.allowed) {
      throw new HttpException('验证码发送次数已达上限，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Redis 已接管限流时，直接写验证码记录
    if (minute || window) {
      await this.prisma.smsOtp.create({
        data: { phone: target, codeHash, purpose, expiresAt },
      });
      return;
    }

    // 无 Redis：使用 DB 事务保证“检查 + 写入验证码”原子化，避免并发绕过
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const now = new Date();
          const oneMinuteAgo = new Date(now.getTime() - 60_000);
          const windowStart = new Date(now.getTime() - limits.windowSec * 1000);

          const [perMinute, perWindow] = await Promise.all([
            tx.smsOtp.count({
              where: {
                phone: target,
                purpose,
                createdAt: { gte: oneMinuteAgo },
              },
            }),
            tx.smsOtp.count({
              where: {
                phone: target,
                purpose,
                createdAt: { gte: windowStart },
              },
            }),
          ]);

          if (perMinute >= limits.perMinute) {
            throw new HttpException('发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
          }
          if (perWindow >= limits.windowCount) {
            throw new HttpException('验证码发送次数已达上限，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
          }

          await tx.smsOtp.create({
            data: { phone: target, codeHash, purpose, expiresAt },
          });
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
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

  /**
   * M5终态（登录频控）：买家登录按手机号限流
   * - 优先 Redis 分布式限流（多实例一致）
   * - 无 Redis 时回退到 LoginEvent 近窗统计
   */
  private async enforceLoginAttemptRateLimit(provider: 'PHONE', identifier: string) {
    const normalized = this.normalizeIdentifier(identifier);
    const idKey = this.hashKey(`${provider}:${normalized}`);
    const redis = await this.redisCoord.consumeFixedWindow(
      `rl:buyer-login:target:${idKey}:1m`,
      AuthService.LOGIN_ATTEMPT_PER_TARGET_PER_MINUTE,
      60,
    );

    if (redis) {
      if (!redis.allowed) {
        throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
      }
      return;
    }

    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const count = await this.prisma.loginEvent.count({
      where: {
        provider,
        phone: identifier,
        createdAt: { gte: oneMinuteAgo },
        // 排除密码重置事件：LoginEvent 被复用为审计 sink，但登录限流只算真实登录尝试
        NOT: { meta: { path: ['action'], equals: AuthService.PASSWORD_RESET_EVENT_ACTION } },
      },
    });
    if (count >= AuthService.LOGIN_ATTEMPT_PER_TARGET_PER_MINUTE) {
      throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * M5终态：买家密码登录失败锁定（账号维度）
   * - 优先 Redis 锁定（多实例即时生效）
   * - 无 Redis 时回退到 LoginEvent 时间窗统计
   */
  private async enforcePasswordLoginLock(provider: 'PHONE', identifier: string) {
    const lockPttl = await this.redisCoord.getPttl(
      this.passwordLockKey(provider, identifier),
    );
    if (lockPttl && lockPttl > 0) {
      const minutes = Math.max(1, Math.ceil(lockPttl / 60_000));
      throw new UnauthorizedException(`密码错误次数过多，请${minutes}分钟后再试`);
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - AuthService.PASSWORD_LOGIN_LOCK_WINDOW_MS);

    const lastSuccess = await this.prisma.loginEvent.findFirst({
      where: {
        provider,
        phone: identifier,
        success: true,
        createdAt: { gte: windowStart },
        // 排除密码重置事件：SMS 重置不是"成功登录"，不该重置密码失败锁窗口
        NOT: { meta: { path: ['action'], equals: AuthService.PASSWORD_RESET_EVENT_ACTION } },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const failQueryStart = lastSuccess?.createdAt && lastSuccess.createdAt > windowStart
      ? lastSuccess.createdAt
      : windowStart;

    const failures = await this.prisma.loginEvent.findMany({
      where: {
        provider,
        phone: identifier,
        success: false,
        createdAt: { gt: failQueryStart },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: AuthService.PASSWORD_LOGIN_MAX_FAILS,
    });

    if (failures.length < AuthService.PASSWORD_LOGIN_MAX_FAILS) return;

    const thresholdFailureAt = failures[failures.length - 1]?.createdAt;
    if (!thresholdFailureAt) return;
    const lockedUntil = new Date(
      thresholdFailureAt.getTime() + AuthService.PASSWORD_LOGIN_LOCK_WINDOW_MS,
    );

    if (lockedUntil > now) {
      throw new UnauthorizedException('密码错误次数过多，请15分钟后再试');
    }
  }

  private async recordLoginAttempt(
    provider: 'PHONE',
    identifier: string,
    mode: 'password' | 'code',
    success: boolean,
    userId?: string,
  ) {
    await this.prisma.loginEvent.create({
      data: {
        userId,
        provider,
        phone: identifier,
        success,
        meta: { mode },
      },
    });

    if (mode === 'password') {
      await this.syncPasswordLockState(provider, identifier, success);
    }
  }

  private async syncPasswordLockState(
    provider: 'PHONE',
    identifier: string,
    success: boolean,
  ) {
    const lockKey = this.passwordLockKey(provider, identifier);
    const failKey = this.passwordFailKey(provider, identifier);

    if (success) {
      await this.redisCoord.del(lockKey, failKey);
      return;
    }

    const redis = await this.redisCoord.consumeFixedWindow(
      failKey,
      AuthService.PASSWORD_LOGIN_MAX_FAILS,
      Math.ceil(AuthService.PASSWORD_LOGIN_LOCK_WINDOW_MS / 1000),
    );
    if (!redis) return; // 无 Redis 时由 LoginEvent 回退逻辑生效

    if (redis.count >= AuthService.PASSWORD_LOGIN_MAX_FAILS) {
      await this.redisCoord.set(
        lockKey,
        '1',
        AuthService.PASSWORD_LOGIN_LOCK_WINDOW_MS,
      );
    }
  }

  private passwordLockKey(provider: 'PHONE', identifier: string) {
    return `auth:pwd-lock:${this.hashKey(`${provider}:${this.normalizeIdentifier(identifier)}`)}`;
  }

  private passwordFailKey(provider: 'PHONE', identifier: string) {
    return `auth:pwd-fail:${this.hashKey(`${provider}:${this.normalizeIdentifier(identifier)}`)}`;
  }

  private normalizeIdentifier(value: string) {
    const text = String(value || '').trim();
    return text.includes('@') ? text.toLowerCase() : text;
  }

  private hashKey(value: string) {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
  }

  private assertProductionMockDisabled(
    key: 'SMS_MOCK' | 'WECHAT_MOCK',
    value: string | undefined,
    serviceName: string,
  ): void {
    if (
      this.config.get('NODE_ENV', 'development') === 'production'
      && value === 'true'
    ) {
      this.logger.error(`[Auth] 生产环境禁止 ${key}=true`);
      throw new ServiceUnavailableException(`${serviceName}配置不可用`);
    }
  }

  /** App、H5 与小程序必须共用同一微信身份锁命名空间。 */
  private wechatIdentityLockKey(profile: WechatLoginProfile) {
    const subject = profile.unionId
      ? `union:${profile.unionId}`
      : `openid:${profile.appId}:${profile.openId}`;
    return `auth:wechat-identity:${this.hashKey(subject)}`;
  }

  private createNoopWechatIdentityLockLease(): WechatIdentityLockLease {
    return {
      assertHeld: async () => undefined,
      stop: () => undefined,
    };
  }

  private startWechatIdentityLockRenewal(
    lockKey: string,
    lockOwner: string,
  ): WechatIdentityLockLease {
    let lost = false;
    let stopped = false;
    let warned = false;
    const markLost = () => {
      lost = true;
      if (!warned) {
        warned = true;
        this.logger.warn(`[WeChat] 身份锁已失效，lock=${this.hashKey(lockKey)}`);
      }
    };
    const renew = async () => {
      if (stopped || lost) return;
      const renewed = await this.redisCoord.renewLock(
        lockKey,
        lockOwner,
        WECHAT_UNION_LOCK_TTL_MS,
      );
      // false 表示 owner 不匹配/null 表示 Redis 不可用，两者都不能继续依赖该锁。
      if (renewed !== true) markLost();
    };
    const interval = setInterval(() => {
      void renew().catch(() => markLost());
    }, Math.floor(WECHAT_UNION_LOCK_TTL_MS / 3));
    interval.unref?.();
    return {
      assertHeld: async () => {
        if (stopped || lost) {
          throw new ServiceUnavailableException('微信身份锁已失效，请稍后重试');
        }
        // 不仅依赖后台心跳日志：每个身份写事务/签 token 前主动向 Redis
        // 验证当前 owner，无法确认时立即 fail-closed。
        await renew().catch(() => markLost());
        if (lost) {
          throw new ServiceUnavailableException('微信身份锁已失效，请稍后重试');
        }
      },
      stop: () => {
        stopped = true;
        clearInterval(interval);
      },
    };
  }

  /**
   * 账号注销护栏：任何登录态身份变更（绑定手机号/微信、未来的解绑/改密等）写操作前必须先断言账号仍 ACTIVE。
   * 已注销用户在 30 天冷静期内可能仍持有未失效的旧 JWT（或撤销前抢发的请求），
   * 必须在此拒绝其修改登录身份，防止"复活"已释放的手机号/微信归属。
   */
  private async assertActiveUserForIdentityMutation(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, deletionExecutedAt: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE || user.deletionExecutedAt) {
      throw new ForbiddenException('账号已注销，不能修改登录身份');
    }
  }

  // ============ 账号身份绑定（买家 App "账号与安全" 页用） ============
  //
  // 设计：方案 A — 只允许"空位绑定"，不允许换绑/解绑。
  // - 当前账号已绑过该 provider → 拒绝
  // - 该 identifier 已被其他账号占用 → 拒绝（提示文案不暴露被占账号信息）
  // - 否则原子 create AuthIdentity；P2002 兜底防并发抢占

  /** 发送"绑定手机号"验证码（purpose=BIND，需登录态）
   *
   * 安全口径：本端点不预检"目标号是否已被占用"，因为发码结果会泄露"号码是否已注册"，
   * 攻击者可通过批量发码探测用户名单。占用检查统一放到 bindPhone（OTP 消费后做），
   * 失败文案"该手机号已被其他账号绑定"只在用户主动尝试绑定时才暴露。
   */
  async sendBindPhoneCode(userId: string, phone: string) {
    // 账号注销护栏：已注销账号不得进入任何身份绑定流程（含发码）
    await this.assertActiveUserForIdentityMutation(userId);

    // 当前账号若已绑手机号，直接拒（不允许换绑，前端按钮在已绑状态下也不应允许进入此流程）
    const own = await this.prisma.authIdentity.findFirst({
      where: { userId, provider: 'PHONE' },
    });
    if (own) {
      throw new BadRequestException('当前账号已绑定手机号');
    }

    return this.issueBindPhoneOtp(phone, '绑定手机号');
  }

  private async issueBindPhoneOtp(phone: string, context: string) {
    const smsMock = this.config.get('SMS_MOCK', 'false');
    this.assertProductionMockDisabled('SMS_MOCK', smsMock, '短信验证码服务');
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.createOtpWithRateLimit(phone, codeHash, expiresAt, SmsPurpose.BIND);

    const nodeEnv = this.config.get('NODE_ENV', 'development');
    if (smsMock === 'true') {
      if (nodeEnv === 'production') {
        this.logger.warn(`[SMS] 生产环境仍使用 Mock 短信（${context}），请设置 SMS_MOCK=false`);
      }
      this.logger.log(`[SMS Mock] ${context}验证码=${code}（目标=${this.maskContact(phone)}）`);
    } else {
      try {
        await this.aliyunSms.sendVerificationCode(phone, code);
        this.logger.log(`[SMS] ${context}验证码已发送（目标=${this.maskContact(phone)}）`);
      } catch (err) {
        this.logger.error(
          `[SMS] ${context}验证码发送失败: ${(err as Error)?.message}`,
          (err as Error)?.stack,
        );
      }
    }
    return { ok: true };
  }

  /** 提交"绑定手机号"：校验 OTP + 防占用 + 写 AuthIdentity
   *
   * 注：本次新增身份不影响当前 session（不同于 changePhone 是修改现有身份）。
   */
  async bindPhone(userId: string, phone: string, code: string) {
    // 账号注销护栏：已注销账号不得绑定/修改登录身份
    await this.assertActiveUserForIdentityMutation(userId);

    // 1. 校验 OTP（事务外，purpose=BIND，CAS 原子消费）。失败抛错，不消耗后续事务资源。
    //    OTP 一旦消费成功就标记 usedAt，下面事务若 P2034 重试不会重复消费。
    await this.verifyCode(phone, code, SmsPurpose.BIND);

    // 2. 写入用 Serializable 事务包裹 findFirst+create，闭合并发抢占窗口。
    //    背景：schema `@@unique([provider, identifier, appId])` 在 appId=null 时 PG
    //    NULLS DISTINCT 会让 P2002 不触发，所以应用层必须用事务隔离兜底。
    //    P2034（Serializable 冲突）允许 1 次退避重试，与 bonus-allocation 同模式。
    const MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await acquireUserWriteLock(tx, userId);
          const currentUser = await tx.user.findUnique({
            where: { id: userId },
            select: { status: true, deletionExecutedAt: true },
          });
          if (!currentUser || currentUser.status !== UserStatus.ACTIVE || currentUser.deletionExecutedAt) {
            throw new ForbiddenException('账号已注销，不能修改登录身份');
          }
          const own = await tx.authIdentity.findFirst({
            where: { userId, provider: 'PHONE' },
          });
          if (own) {
            throw new BadRequestException('当前账号已绑定手机号');
          }
          const taken = await tx.authIdentity.findFirst({
            where: { provider: 'PHONE', identifier: phone },
          });
          if (taken) {
            throw new BadRequestException('该手机号已被其他账号绑定，请使用该手机号直接登录');
          }
          await tx.authIdentity.create({
            data: {
              userId,
              provider: 'PHONE',
              identifier: phone,
              appId: PHONE_AUTH_APP_ID,
              verified: true,
            },
          });
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        break;
      } catch (err: any) {
        const isPrismaError = err instanceof Prisma.PrismaClientKnownRequestError;
        if (isPrismaError && err.code === 'P2002') {
          throw new BadRequestException('该手机号已被其他账号绑定，请使用该手机号直接登录');
        }
        if (isPrismaError && err.code === 'P2034' && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
          continue;
        }
        throw err;
      }
    }

    this.logger.log(`[BindPhone] userId=${userId} 已绑定手机号 ${this.maskContact(phone)}`);
    return { ok: true };
  }

  /** 提交"绑定微信"：code 换 openId + 防占用 + 写 AuthIdentity
   *
   * 注：本次新增身份不影响当前 session（不同于 changePhone 是修改现有身份）。
   * 微信 code 由微信侧保证一次性，重复 code 会被 exchangeCodeForWechatProfile 抛错；
   * 因此 P2034 重试只重跑事务体（findFirst+create），不重复调微信换 openId 接口。
   */
  async bindWechat(userId: string, code: string) {
    // 账号注销护栏：已注销账号不得绑定/修改登录身份
    await this.assertActiveUserForIdentityMutation(userId);

    // 1. 先 code 换 openId（事务外，外部 HTTP 调用不进事务）
    const wechatProfile = await this.exchangeWechatOAuthCode(code, 'mobile');
    const { openId, unionId, appId } = wechatProfile;
    const lockKey = this.wechatIdentityLockKey(wechatProfile);
    const lockOwner = randomBytes(16).toString('hex');
    const locked = await this.redisCoord.acquireLock(lockKey, lockOwner, WECHAT_UNION_LOCK_TTL_MS);
    if (locked === false) {
      throw new BadRequestException('微信账号绑定处理中，请稍后重试');
    }
    if (locked === null && this.config.get('NODE_ENV', 'development') === 'production') {
      throw new ServiceUnavailableException('微信账号绑定服务繁忙，请稍后重试');
    }
    const lockLease = locked
      ? this.startWechatIdentityLockRenewal(lockKey, lockOwner)
      : this.createNoopWechatIdentityLockLease();

    try {
      await lockLease.assertHeld();
      // 2. Serializable 事务：精确 OpenID 与全部 unionId 候选一并裁决。
      const MAX_RETRIES = 1;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await acquireUserWriteLock(tx, userId);
            const currentUser = await tx.user.findUnique({
              where: { id: userId },
              select: { status: true, deletionExecutedAt: true },
            });
            if (!currentUser || currentUser.status !== UserStatus.ACTIVE || currentUser.deletionExecutedAt) {
              throw new ForbiddenException('账号已注销，不能修改登录身份');
            }

            const own = await tx.authIdentity.findFirst({
              where: { userId, provider: 'WECHAT' },
            });
            if (own) {
              throw new BadRequestException('当前账号已绑定微信');
            }

            const candidates = await tx.authIdentity.findMany({
              where: {
                provider: 'WECHAT',
                OR: [
                  {
                    identifier: openId,
                    OR: [{ appId }, { appId: null }],
                  },
                  ...(unionId
                    ? [
                        { unionId },
                        { meta: { path: ['unionId'], equals: unionId } },
                      ]
                    : []),
                ],
              },
              select: { userId: true },
            });
            if (candidates.some((candidate) => candidate.userId !== userId)) {
              throw new BadRequestException('该微信已被其他账号绑定，请使用该微信直接登录');
            }

            await lockLease.assertHeld();
            await tx.authIdentity.create({
              data: {
                userId,
                provider: 'WECHAT',
                identifier: openId,
                unionId: unionId || null,
                appId,
                verified: true,
                meta: this.mergeWechatIdentityMeta(null, wechatProfile),
              },
            });
          }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          });
          break;
        } catch (err: any) {
          const isPrismaError = err instanceof Prisma.PrismaClientKnownRequestError;
          if (isPrismaError && err.code === 'P2002') {
            throw new BadRequestException('该微信已被其他账号绑定，请使用该微信直接登录');
          }
          if (isPrismaError && err.code === 'P2034' && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
            continue;
          }
          throw err;
        }
      }

      this.logger.log(`[BindWechat] userId=${userId} 已绑定微信 openId=${this.maskOpaqueId(openId)}`);
      return { ok: true };
    } finally {
      lockLease.stop();
      if (locked) {
        await this.redisCoord.releaseLock(lockKey, lockOwner);
      }
    }
  }
}
