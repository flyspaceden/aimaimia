import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  Logger,
  HttpException,
  HttpStatus,
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

type WechatOAuthSource = 'mobile' | 'h5';

type WechatLoginProfile = {
  openId: string;
  unionId: string;
  appId: string;
  appType: 'MOBILE_APP' | 'H5_SERVICE_ACCOUNT';
  accessToken: string | null;
};

type H5WechatStatePayload = {
  inviteCode: string;
  landingSessionId?: string;
  nonce: string;
  iat: number;
};

const PHONE_AUTH_APP_ID = 'PHONE';
const H5_WECHAT_STATE_TTL_MS = 10 * 60_000;
const H5_WECHAT_STATE_KEY_PREFIX = 'auth:h5-wechat:state';
const WECHAT_UNION_LOCK_TTL_MS = 10_000;
const h5WechatStateMemoryStore = new Map<string, { value: string; expiresAt: number }>();

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
    const smsMock = this.config.get('SMS_MOCK', 'true');
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
    const smsMock = this.config.get('SMS_MOCK', 'true');
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

    // 查找用户的登录方式
    const identity = await this.prisma.authIdentity.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
    });

    const loginMethod = identity?.provider === 'WECHAT' ? 'wechat' : 'phone';
    // L1修复：继承旧 session 的 absoluteExpiresAt，防止无限续期
    return this.issueTokens(session.userId, loginMethod, session.absoluteExpiresAt);
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
    const wechatMock = this.config.get('WECHAT_MOCK', 'true');
    const nodeEnv = this.config.get('NODE_ENV', 'development');
    const appId = source === 'h5'
      ? this.config.get<string>('WECHAT_H5_APP_ID', 'mock-h5-service-account')
      : this.config.get<string>('WECHAT_APP_ID', 'mock-mobile-app');
    const appType = source === 'h5' ? 'H5_SERVICE_ACCOUNT' : 'MOBILE_APP';

    if (wechatMock === 'true') {
      if (nodeEnv === 'production') {
        this.logger.warn(
          '[WeChat] 生产环境仍使用 Mock 微信登录，请设置 WECHAT_MOCK=false 并配置微信开放平台',
        );
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

  private async loginOrCreateWechatUser(profile: WechatLoginProfile) {
    if (!profile.unionId) {
      return this.loginOrCreateWechatUserUnlocked(profile);
    }

    const lockKey = `auth:wechat-union:${this.hashKey(profile.unionId)}`;
    const lockOwner = randomBytes(16).toString('hex');
    const locked = await this.redisCoord.acquireLock(lockKey, lockOwner, WECHAT_UNION_LOCK_TTL_MS);
    if (locked === false) {
      throw new BadRequestException('微信登录处理中，请稍后重试');
    }
    if (locked === null && this.config.get('NODE_ENV', 'development') === 'production') {
      throw new BadRequestException('微信登录服务繁忙，请稍后重试');
    }

    try {
      return await this.loginOrCreateWechatUserUnlocked(profile);
    } finally {
      if (locked) {
        await this.redisCoord.releaseLock(lockKey, lockOwner);
      }
    }
  }

  private async loginOrCreateWechatUserUnlocked(profile: WechatLoginProfile) {
    const identity = await this.findWechatIdentity(profile);

    if (identity) {
      if (identity.user.status !== UserStatus.ACTIVE) {
        throw new ForbiddenException('账号不可用');
      }
      await this.ensureBuyerNoForBuyer(identity.userId);
      await this.ensureWechatIdentityForProfile(identity, profile);
      return this.issueTokens(identity.userId, 'wechat');
    }

    const profileData = await this.fetchWechatUserProfile(profile.accessToken, profile.openId);
    const user = await this.prisma.user.create({
      data: {
        buyerNo: await nextBuyerNo(this.prisma),
        profile: {
          create: profileData,
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
    });

    this.couponEngine.handleTrigger(user.id, 'REGISTER').catch((err: any) => {
      this.logger.warn(`REGISTER 红包触发失败: userId=${user.id}, error=${err?.message}`);
    });
    this.triggerRegisterGrowth(user.id);

    return this.issueTokens(user.id, 'wechat');
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

  private async findWechatIdentity(profile: WechatLoginProfile) {
    if (profile.unionId) {
      const byUnion = await this.prisma.authIdentity.findFirst({
        where: { provider: 'WECHAT', unionId: profile.unionId },
        include: { user: { select: { status: true } } },
      });
      if (byUnion) return byUnion;

      const byLegacyMetaUnion = await this.prisma.authIdentity.findFirst({
        where: {
          provider: 'WECHAT',
          meta: { path: ['unionId'], equals: profile.unionId },
        },
        include: { user: { select: { status: true } } },
      });
      if (byLegacyMetaUnion) return byLegacyMetaUnion;
    }

    return this.prisma.authIdentity.findFirst({
      where: {
        provider: 'WECHAT',
        identifier: profile.openId,
        OR: [
          { appId: profile.appId },
          { appId: null },
        ],
      },
      include: { user: { select: { status: true } } },
    });
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
  ) {
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
      await this.prisma.authIdentity.update({
        where: { id: identity.id },
        data: updateData,
      });
    }

    if (sameOpenId) return;

    const currentOpenIdIdentity = await this.prisma.authIdentity.findFirst({
      where: {
        provider: 'WECHAT',
        identifier: profile.openId,
        OR: [
          { appId: profile.appId },
          { appId: null },
        ],
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
        await this.prisma.authIdentity.update({
          where: { id: currentOpenIdIdentity.id },
          data: currentUpdate,
        });
      }
      return;
    }

    await this.prisma.authIdentity.create({
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
      const res = await fetch(url);
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
  ) {
    await this.assertActiveUserForSessionIssue(userId);

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
        accessTokenHash: '', // 占位，下面更新
        refreshTokenHash,
        status: 'ACTIVE',
        expiresAt: refreshExpiresAt,
        absoluteExpiresAt,
      },
    });

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

    const smsMock = this.config.get('SMS_MOCK', 'true');
    const code = smsMock === 'true' ? '123456' : randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.createOtpWithRateLimit(phone, codeHash, expiresAt, SmsPurpose.BIND);

    const nodeEnv = this.config.get('NODE_ENV', 'development');
    if (smsMock === 'true') {
      if (nodeEnv === 'production') {
        this.logger.warn('[SMS] 生产环境仍使用 Mock 短信（绑定手机号），请设置 SMS_MOCK=false');
      }
      this.logger.log(`[SMS Mock] 绑定手机号验证码=${code}（目标=${this.maskContact(phone)}）`);
    } else {
      try {
        await this.aliyunSms.sendVerificationCode(phone, code);
        this.logger.log(`[SMS] 绑定手机号验证码已发送（目标=${this.maskContact(phone)}）`);
      } catch (err) {
        this.logger.error(
          `[SMS] 绑定手机号验证码发送失败: ${(err as Error)?.message}`,
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
    const wechatProfile = await this.exchangeCodeForWechatProfile(code);
    const { openId, unionId } = wechatProfile;

    // 2. Serializable 事务：findFirst+create 原子化；P2034 退避重试 1 次（同 bindPhone）
    const MAX_RETRIES = 1;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const own = await tx.authIdentity.findFirst({
            where: { userId, provider: 'WECHAT' },
          });
          if (own) {
            throw new BadRequestException('当前账号已绑定微信');
          }
          const taken = await tx.authIdentity.findFirst({
            where: { provider: 'WECHAT', identifier: openId },
          });
          if (taken) {
            throw new BadRequestException('该微信已被其他账号绑定，请使用该微信直接登录');
          }
          await tx.authIdentity.create({
            data: { userId, provider: 'WECHAT', identifier: openId, verified: true, meta: { unionId } },
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
  }
}
