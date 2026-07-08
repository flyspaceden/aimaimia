import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { createHash } from 'crypto';

// CaptchaService 顶层 import 了 ESM-only 的 @paralleldrive/cuid2 / svg-captcha，
// ts-jest（commonjs）无法转译。本单测只手工注入 captcha mock，不需要真实实现，
// 故在 import AuthService 之前 stub 掉该模块，切断 ESM 依赖链。
jest.mock('../captcha/captcha.service', () => ({ CaptchaService: class {} }));

// eslint-disable-next-line import/first
import { AuthService } from './auth.service';

// ============================================================
// 账号注销 Task 3 — auth.service 身份变更 / 登录 / 注册护栏单测
// 风格对齐 deletion.service.spec.ts：手写 mock，逐依赖注入
// ============================================================

const PHONE = '13800001234';
const OPENID = 'wx-openid-1234567890';

function mockWechatOpenId(prefix: string, code: string) {
  return createHash('sha256').update(`${prefix}_${code}`).digest('hex').slice(0, 28);
}

/** 构造一个可链式调用的 prisma mock，默认行为可被各用例覆写 */
function makePrisma(overrides: Record<string, any> = {}) {
  const base: any = {
    user: {
      // 默认 ACTIVE 用户（绑定护栏断言读取）
      findUnique: jest
        .fn()
        .mockResolvedValue({ status: UserStatus.ACTIVE, deletionExecutedAt: null }),
      create: jest.fn().mockResolvedValue({ id: 'new-user' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    authIdentity: {
      // 默认无任何身份命中（注册/登录的"号码未占用"基线）
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'identity-new' }),
      update: jest.fn().mockResolvedValue({ id: 'identity-updated' }),
    },
    inviteH5LandingEvent: {
      findUnique: jest.fn().mockResolvedValue({ inviteCode: 'SABC1234' }),
    },
    // pickUniqueReferralCode 预查空闲推荐码：默认无冲突
    memberProfile: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    normalShareProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    smsOtp: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    loginEvent: {
      create: jest.fn().mockResolvedValue({ id: 'login-event-new' }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    session: {
      create: jest.fn().mockResolvedValue({ id: 'session-new' }),
      update: jest.fn().mockResolvedValue({ id: 'session-new' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1) }]),
    $transaction: jest.fn(async (cb: any) => cb(base)),
  };
  Object.assign(base, overrides);
  return base;
}

function makeService(prisma: any) {
  const h5WechatStateStore = new Map<string, string>();
  const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as any;
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'SMS_MOCK') return 'true';
      if (key === 'WECHAT_MOCK') return 'true';
      if (key === 'NODE_ENV') return 'test';
      if (key === 'JWT_EXPIRES_IN') return '15m';
      return fallback;
    }),
    getOrThrow: jest.fn((key: string) => `stub-${key}`),
  } as any;
  const redisCoord = {
    consumeFixedWindow: jest.fn().mockResolvedValue({ allowed: true, count: 1 }),
    set: jest.fn(async (key: string, value: string) => {
      h5WechatStateStore.set(key, value);
      return true;
    }),
    getdel: jest.fn(async (key: string) => {
      const value = h5WechatStateStore.get(key) ?? null;
      h5WechatStateStore.delete(key);
      return value;
    }),
    del: jest.fn().mockResolvedValue(undefined),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  } as any;
  const couponEngine = { handleTrigger: jest.fn().mockResolvedValue(undefined) } as any;
  const growthEvents = { receive: jest.fn().mockResolvedValue({ granted: true }) } as any;
  const aliyunSms = { sendVerificationCode: jest.fn().mockResolvedValue(undefined) } as any;
  const captcha = { verify: jest.fn().mockResolvedValue(true) } as any;
  const inviteH5 = {
    bindAfterAuth: jest.fn().mockResolvedValue({
      status: 'BOUND',
      type: 'NORMAL_SHARE',
      message: '推荐关系已记录',
    }),
  } as any;

  const service = new AuthService(
    prisma,
    jwt,
    config,
    redisCoord,
    couponEngine,
    aliyunSms,
    captcha,
    growthEvents,
    inviteH5,
  );
  return { service, jwt, couponEngine, growthEvents, inviteH5, redisCoord };
}

describe('AuthService — 账号注销护栏（身份变更）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('已注销用户（DELETED）不能绑定手机号', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.DELETED,
      deletionExecutedAt: new Date(),
    });
    const { service } = makeService(prisma);

    await expect(service.bindPhone('deleted-user', PHONE, '123456')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // 护栏在 OTP 校验 / 写库之前拦截
    expect(prisma.smsOtp.findMany).not.toHaveBeenCalled();
    expect(prisma.authIdentity.create).not.toHaveBeenCalled();
  });

  it('deletionExecutedAt 非空但 status 仍未翻转的用户也不能绑定手机号', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.ACTIVE,
      deletionExecutedAt: new Date(),
    });
    const { service } = makeService(prisma);

    await expect(service.bindPhone('pending-deletion', PHONE, '123456')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('已注销用户（DELETED）不能绑定微信', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.DELETED,
      deletionExecutedAt: new Date(),
    });
    const { service } = makeService(prisma);

    await expect(service.bindWechat('deleted-user', 'wx-code')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.authIdentity.create).not.toHaveBeenCalled();
  });

  it('已注销用户（DELETED）不能进入"发送绑定手机号验证码"流程', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.DELETED,
      deletionExecutedAt: new Date(),
    });
    const { service } = makeService(prisma);

    await expect(service.sendBindPhoneCode('deleted-user', PHONE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('ACTIVE 用户绑定手机号正常放行（护栏不误伤）', async () => {
    const prisma = makePrisma();
    // OTP 命中一条有效验证码（bcrypt.compare 走真实库，code 与 hash 需匹配）
    const bcrypt = require('bcrypt');
    const codeHash = bcrypt.hashSync('123456', 4);
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash, usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service } = makeService(prisma);

    const res = await service.bindPhone('active-user', PHONE, '123456');

    expect(res).toEqual({ ok: true });
    expect(prisma.authIdentity.create).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService — 释放出的手机号/微信可被新账号复用（tombstone 不冲突）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('释放出的手机号可注册新账号（旧 tombstone identifier 不命中 findFirst）', async () => {
    const prisma = makePrisma();
    // 关键：注销已把旧记录 identifier 改写为 deleted:PHONE:...，
    // 按真实手机号 lookup 不会命中 → 注册可继续
    prisma.authIdentity.findFirst.mockResolvedValue(null);
    const bcrypt = require('bcrypt');
    const codeHash = bcrypt.hashSync('123456', 4);
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash, usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service, growthEvents } = makeService(prisma);

    const res = await service.register({ phone: PHONE, code: '123456', name: '新用户' } as any);

    expect(res.userId).toBe('new-user');
    expect(growthEvents.receive).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'new-user',
      behaviorCode: 'REGISTER',
      idempotencyKey: 'REGISTER:new-user',
      refType: 'USER',
      refId: 'new-user',
    }));
    // 用真实手机号查占用，未命中 tombstone
    expect(prisma.authIdentity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: 'PHONE', identifier: PHONE } }),
    );
    // 新身份创建在 user.create 内联，确认 user.create 携带真实手机号身份
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  it('释放出的微信身份可被新用户注册（旧 tombstone openId 不命中）', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockResolvedValue(null); // 真实 openId 未占用
    const { service, redisCoord } = makeService(prisma);

    const res = await service.loginWithWeChat('wx-fresh-code');

    expect(res.userId).toBe('new-user');
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    const unionId = mockWechatOpenId('wx_unionid', 'wx-fresh-code');
    const unionKey = createHash('sha256').update(unionId).digest('hex').slice(0, 24);
    expect(redisCoord.acquireLock).toHaveBeenCalledWith(
      `auth:wechat-union:${unionKey}`,
      expect.any(String),
      10000,
    );
    expect(redisCoord.releaseLock).toHaveBeenCalledWith(
      `auth:wechat-union:${unionKey}`,
      expect.any(String),
    );
  });
});

describe('AuthService — 登录路径拒绝非 ACTIVE 用户（防御性兜底）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('手机号密码登录：身份所属用户为 DELETED → ForbiddenException，不签发 Session', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'identity-phone',
      userId: 'deleted-user',
      provider: 'PHONE',
      identifier: PHONE,
      meta: { passwordHash: 'whatever' },
      user: { status: UserStatus.DELETED },
    });
    const { service } = makeService(prisma);

    await expect(
      service.login({ phone: PHONE, mode: 'password', password: 'Aa123456' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('微信登录：已绑定身份所属用户为 DELETED → ForbiddenException，不签发 Session', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'identity-wx',
      userId: 'deleted-user',
      provider: 'WECHAT',
      identifier: OPENID,
      user: { status: UserStatus.DELETED },
    });
    const { service } = makeService(prisma);

    await expect(service.loginWithWeChat('wx-code')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('手机号验证码登录：身份所属用户 BANNED → ForbiddenException', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'identity-phone',
      userId: 'banned-user',
      provider: 'PHONE',
      identifier: PHONE,
      user: { status: UserStatus.BANNED },
    });
    const { service } = makeService(prisma);

    await expect(
      service.login({ phone: PHONE, mode: 'code', code: '123456' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});

describe('AuthService — refresh 路径拒绝已注销用户', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refresh token 对应用户已注销时不能签发新 Session', async () => {
    const prisma = makePrisma();
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    prisma.session.findFirst.mockResolvedValue({
      id: 'session-old',
      userId: 'deleted-user',
      absoluteExpiresAt: null,
    });
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.DELETED,
      deletionExecutedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    const { service } = makeService(prisma);

    await expect(service.refresh({ refreshToken: 'refresh-token' } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.session.create).not.toHaveBeenCalled();
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});

describe('AuthService — buyerNo generation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generates buyerNo during phone registration', async () => {
    const prisma = makePrisma({
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1) }]),
    });
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service } = makeService(prisma);

    await service.register({ phone: PHONE, code: '123456', name: '新用户' } as any);

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ buyerNo: 'AIMM00000000000001' }),
    }));
  });

  it('creates empty normal growth account and normal share profile during phone registration', async () => {
    const prisma = makePrisma({
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(4) }]),
    });
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service } = makeService(prisma);

    await service.register({ phone: PHONE, code: '123456', name: '新用户' } as any);

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        growthAccount: {
          create: {
            pointsBalance: 0,
            pointsTotalEarned: 0,
            pointsTotalSpent: 0,
            growthValue: 0,
          },
        },
        normalShareProfile: {
          create: expect.objectContaining({
            status: 'ACTIVE',
          }),
        },
      }),
    }));
  });

  it('generates buyerNo during SMS auto-registration', async () => {
    const prisma = makePrisma({
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(2) }]),
    });
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service } = makeService(prisma);

    await service.login({ phone: PHONE, mode: 'code', code: '123456' } as any);

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ buyerNo: 'AIMM00000000000002' }),
    }));
  });

  it('backfills buyerNo when an existing seller-created user logs into buyer app', async () => {
    const prisma = makePrisma({
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(3) }]),
      user: {
        findUnique: jest.fn((args: any) => {
          if (args?.select?.buyerNo) return Promise.resolve({ buyerNo: null });
          return Promise.resolve({ status: UserStatus.ACTIVE, deletionExecutedAt: null });
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'identity-phone',
      userId: 'seller-then-buyer',
      provider: 'PHONE',
      identifier: PHONE,
      user: { status: UserStatus.ACTIVE },
    });
    const { service } = makeService(prisma);

    await service.login({ phone: PHONE, mode: 'code', code: '123456' } as any);

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'seller-then-buyer', buyerNo: null },
      data: { buyerNo: 'AIMM00000000000003' },
    });
  });
});

describe('AuthService — H5 invite login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inviteLogin logs in an existing phone user and binds after auth', async () => {
    const prisma = makePrisma();
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'identity-phone',
      userId: 'existing-user',
      provider: 'PHONE',
      identifier: PHONE,
      user: { status: UserStatus.ACTIVE },
    });
    const { service, inviteH5 } = makeService(prisma);

    const result = await (service as any).inviteLogin({
      phone: PHONE,
      code: '123456',
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });

    expect(inviteH5.bindAfterAuth).toHaveBeenCalledWith({
      userId: 'existing-user',
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });
    expect(result).toMatchObject({
      userId: 'existing-user',
      user: { id: 'existing-user' },
      inviteBinding: {
        status: 'BOUND',
        type: 'NORMAL_SHARE',
      },
    });
  });

  it('inviteLogin auto-registers a new phone user with provided nickname', async () => {
    const prisma = makePrisma();
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service, inviteH5 } = makeService(prisma);

    const result = await (service as any).inviteLogin({
      phone: PHONE,
      code: '123456',
      name: '会议用户',
      inviteCode: 'VIPCODE1',
    });

    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        profile: { create: { nickname: '会议用户' } },
        authIdentities: {
          create: expect.objectContaining({
            provider: 'PHONE',
            identifier: PHONE,
            appId: 'PHONE',
          }),
        },
      }),
    }));
    expect(inviteH5.bindAfterAuth).toHaveBeenCalledWith({
      userId: 'new-user',
      inviteCode: 'VIPCODE1',
      landingSessionId: undefined,
    });
    expect(result.userId).toBe('new-user');
  });

  it('inviteLogin recovers from first phone auto-registration race by reusing the winning identity', async () => {
    const prisma = makePrisma();
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    prisma.authIdentity.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'identity-raced-phone',
        userId: 'raced-user',
        provider: 'PHONE',
        identifier: PHONE,
        appId: 'PHONE',
        user: { status: UserStatus.ACTIVE },
      });
    prisma.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`provider`,`identifier`,`appId`)',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['provider', 'identifier', 'appId'] },
      },
    ));
    const { service, inviteH5 } = makeService(prisma);

    const result = await (service as any).inviteLogin({
      phone: PHONE,
      code: '123456',
      name: '会议用户',
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });

    expect(result.userId).toBe('raced-user');
    expect(inviteH5.bindAfterAuth).toHaveBeenCalledWith({
      userId: 'raced-user',
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });
  });

  it('inviteLogin succeeds when binding returns ALREADY_BOUND_OTHER', async () => {
    const prisma = makePrisma();
    const bcrypt = require('bcrypt');
    prisma.smsOtp.findMany.mockResolvedValue([
      { id: 'otp-1', codeHash: bcrypt.hashSync('123456', 4), usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
    ]);
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'identity-phone',
      userId: 'existing-user',
      provider: 'PHONE',
      identifier: PHONE,
      user: { status: UserStatus.ACTIVE },
    });
    const { service, inviteH5 } = makeService(prisma);
    inviteH5.bindAfterAuth.mockResolvedValue({
      status: 'ALREADY_BOUND_OTHER',
      type: 'VIP_REFERRAL',
      message: '已绑定推荐关系，无法覆盖',
    });

    const result = await (service as any).inviteLogin({
      phone: PHONE,
      code: '123456',
      inviteCode: 'VIPCODE1',
    });

    expect(result).toMatchObject({
      userId: 'existing-user',
      inviteBinding: {
        status: 'ALREADY_BOUND_OTHER',
        message: '已绑定推荐关系，无法覆盖',
      },
    });
  });

  it('inviteLogin rejects invalid sms code before creating a user or binding', async () => {
    const prisma = makePrisma();
    prisma.smsOtp.findMany.mockResolvedValue([]);
    const { service, inviteH5 } = makeService(prisma);

    await expect((service as any).inviteLogin({
      phone: PHONE,
      code: '000000',
      inviteCode: 'SABC1234',
    })).rejects.toThrow('验证码无效或已过期');

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(inviteH5.bindAfterAuth).not.toHaveBeenCalled();
  });

  it('inviteLogin records login attempt failure when otp validation fails', async () => {
    const prisma = makePrisma();
    prisma.smsOtp.findMany.mockResolvedValue([]);
    const { service } = makeService(prisma);

    await expect((service as any).inviteLogin({
      phone: PHONE,
      code: '000000',
      inviteCode: 'SABC1234',
    })).rejects.toThrow('验证码无效或已过期');

    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'PHONE',
        phone: PHONE,
        success: false,
        meta: { mode: 'code' },
      }),
    });
  });
});

describe('AuthService — H5 invite WeChat login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds H5 WeChat auth URL with short server-side state containing invite context', async () => {
    const prisma = makePrisma();
    const { service, redisCoord } = makeService(prisma);

    const url = await (service as any).buildH5WechatAuthUrl({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });
    const parsed = new URL(url);

    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://open.weixin.qq.com/connect/oauth2/authorize');
    expect(parsed.searchParams.get('appid')).toBe('stub-WECHAT_H5_APP_ID');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('snsapi_userinfo');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://app.ai-maimai.com/invite/SABC1234',
    );

    const state = parsed.searchParams.get('state');
    expect(state).toEqual(expect.any(String));
    expect(state).toMatch(/^[a-f0-9]{32}$/);
    expect(state!.length).toBeLessThanOrEqual(128);
    expect(redisCoord.set).toHaveBeenCalledWith(
      `auth:h5-wechat:state:${state}`,
      expect.any(String),
      600000,
    );
    const verified = await (service as any).consumeH5WechatState(state);
    expect(verified).toMatchObject({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });
  });

  it('rejects H5 WeChat callback when landing session belongs to another invite code', async () => {
    const prisma = makePrisma();
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({ inviteCode: 'BCODE999' });
    const { service, inviteH5 } = makeService(prisma);
    const state = await (service as any).createH5WechatState({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_b_code',
    });

    await expect((service as any).h5WechatInviteLogin({
      wechatCode: 'conference-wechat-code',
      state,
      inviteCode: 'SABC1234',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.inviteH5LandingEvent.findUnique).toHaveBeenCalledWith({
      where: { landingSessionId: 'ih5_session_b_code' },
      select: { inviteCode: true },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(inviteH5.bindAfterAuth).not.toHaveBeenCalled();
  });

  it('H5 WeChat invite login reuses unionId identity and binds after auth', async () => {
    const prisma = makePrisma();
    const { service, inviteH5 } = makeService(prisma);
    const wechatCode = 'conference-wechat-code';
    const unionId = mockWechatOpenId('wx_unionid', wechatCode);
    const h5OpenId = mockWechatOpenId('wx_h5_openid', wechatCode);
    const existingIdentity = {
      id: 'identity-existing-wx',
      userId: 'existing-wechat-user',
      provider: 'WECHAT',
      identifier: 'app-open-id',
      unionId,
      appId: 'mobile-app-id',
      user: { status: UserStatus.ACTIVE },
    };
    prisma.authIdentity.findFirst.mockImplementation((args: any) => {
      if (args?.where?.provider === 'WECHAT' && args?.where?.unionId === unionId) {
        return Promise.resolve(existingIdentity);
      }
      return Promise.resolve(null);
    });
    const state = await (service as any).createH5WechatState({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });

    const result = await (service as any).h5WechatInviteLogin({
      wechatCode,
      state,
      inviteCode: 'SABC1234',
    });

    expect(prisma.authIdentity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: 'WECHAT',
        unionId,
      }),
      include: { user: { select: { status: true } } },
    }));
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(inviteH5.bindAfterAuth).toHaveBeenCalledWith({
      userId: 'existing-wechat-user',
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });
    expect(result).toMatchObject({
      userId: 'existing-wechat-user',
      loginMethod: 'wechat',
      user: { id: 'existing-wechat-user' },
      inviteBinding: {
        status: 'BOUND',
        type: 'NORMAL_SHARE',
      },
    });
    expect(h5OpenId).not.toBe(existingIdentity.identifier);
  });

  it('H5 WeChat invite login reuses legacy meta.unionId identity before creating a user', async () => {
    const prisma = makePrisma();
    const { service, inviteH5 } = makeService(prisma);
    const wechatCode = 'legacy-app-wechat-code';
    const unionId = mockWechatOpenId('wx_unionid', wechatCode);
    const h5OpenId = mockWechatOpenId('wx_h5_openid', wechatCode);
    const legacyIdentity = {
      id: 'identity-legacy-wx',
      userId: 'legacy-wechat-user',
      provider: 'WECHAT',
      identifier: 'legacy-app-open-id',
      unionId: null,
      appId: null,
      meta: { unionId },
      user: { status: UserStatus.ACTIVE },
    };
    prisma.authIdentity.findFirst.mockImplementation((args: any) => {
      if (args?.where?.provider === 'WECHAT' && args?.where?.unionId === unionId) {
        return Promise.resolve(null);
      }
      if (
        args?.where?.provider === 'WECHAT' &&
        args?.where?.meta?.path?.[0] === 'unionId' &&
        args?.where?.meta?.equals === unionId
      ) {
        return Promise.resolve(legacyIdentity);
      }
      if (args?.where?.provider === 'WECHAT' && args?.where?.identifier === h5OpenId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    const state = await (service as any).createH5WechatState({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_legacy',
    });

    const result = await (service as any).h5WechatInviteLogin({
      wechatCode,
      state,
      inviteCode: 'SABC1234',
    });

    expect(prisma.authIdentity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: 'WECHAT',
        meta: { path: ['unionId'], equals: unionId },
      }),
      include: { user: { select: { status: true } } },
    }));
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.authIdentity.update).toHaveBeenCalledWith({
      where: { id: 'identity-legacy-wx' },
      data: expect.objectContaining({ unionId }),
    });
    expect(prisma.authIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'legacy-wechat-user',
        provider: 'WECHAT',
        identifier: h5OpenId,
        unionId,
        appId: 'mock-h5-service-account',
      }),
    });
    expect(inviteH5.bindAfterAuth).toHaveBeenCalledWith({
      userId: 'legacy-wechat-user',
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_legacy',
    });
    expect(result).toMatchObject({
      userId: 'legacy-wechat-user',
      loginMethod: 'wechat',
    });
  });

  it('rejects real H5 WeChat login without unionId to avoid duplicate App and H5 accounts', async () => {
    const prisma = makePrisma();
    const { service, inviteH5 } = makeService(prisma);
    jest.spyOn(service as any, 'exchangeWechatOAuthCode').mockResolvedValue({
      openId: 'h5-openid-without-union',
      unionId: '',
      appId: 'real-h5-service-account',
      appType: 'H5_SERVICE_ACCOUNT',
      accessToken: 'h5-access-token',
    });
    const state = await (service as any).createH5WechatState({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_no_union',
    });

    await expect((service as any).h5WechatInviteLogin({
      wechatCode: 'real-code-without-union',
      state,
      inviteCode: 'SABC1234',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(inviteH5.bindAfterAuth).not.toHaveBeenCalled();
  });
});
