import { ForbiddenException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

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
  return { service, jwt, couponEngine, growthEvents, inviteH5 };
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
    const { service } = makeService(prisma);

    const res = await service.loginWithWeChat('wx-fresh-code');

    expect(res.userId).toBe('new-user');
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
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
      }),
    }));
    expect(inviteH5.bindAfterAuth).toHaveBeenCalledWith({
      userId: 'new-user',
      inviteCode: 'VIPCODE1',
      landingSessionId: undefined,
    });
    expect(result.userId).toBe('new-user');
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
