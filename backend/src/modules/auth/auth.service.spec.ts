import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { validate } from 'class-validator';

// 本单测只手工注入 captcha mock，不需要真实验证码实现，
// 故在 import AuthService 之前 stub 掉该模块，避免加载验证码图片依赖。
jest.mock('../captcha/captcha.service', () => ({ CaptchaService: class {} }));

// eslint-disable-next-line import/first
import { AuthService } from './auth.service';
import { WechatMiniappLoginDto } from './dto/wechat-miniapp.dto';

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
      findMany: jest.fn().mockResolvedValue([]),
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
      create: jest.fn().mockResolvedValue({ id: 'otp-new' }),
      count: jest.fn().mockResolvedValue(0),
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
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1) }]),
    $transaction: jest.fn(async (cb: any) => cb(base)),
  };
  Object.assign(base, overrides);
  return base;
}

function makeService(prisma: any, configOverrides: Record<string, string> = {}) {
  const h5WechatStateStore = new Map<string, string>();
  const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as any;
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      if (Object.prototype.hasOwnProperty.call(configOverrides, key)) {
        return configOverrides[key];
      }
      if (key === 'SMS_MOCK') return 'true';
      if (key === 'WECHAT_MOCK') return 'true';
      if (key === 'NODE_ENV') return 'test';
      if (key === 'JWT_EXPIRES_IN') return '15m';
      return fallback;
    }),
    getOrThrow: jest.fn((key: string) => configOverrides[key] ?? `stub-${key}`),
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
    get: jest.fn(async (key: string) => h5WechatStateStore.get(key) ?? null),
    del: jest.fn().mockResolvedValue(undefined),
    acquireLock: jest.fn().mockResolvedValue(true),
    renewLock: jest.fn().mockResolvedValue(true),
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

describe('AuthService.changePassword — 买家改密事务', () => {
  beforeEach(() => jest.clearAllMocks());

  it('校验旧密码后在 Serializable 事务写入新哈希、撤销其他会话并留审计', async () => {
    const bcrypt = require('bcrypt');
    const oldHash = bcrypt.hashSync('OldPass1', 4);
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'phone-identity', userId: 'user-1', identifier: PHONE,
      meta: { passwordHash: oldHash, preserved: 'yes' },
    });
    const { service } = makeService(prisma);

    await expect(service.changePassword(
      'user-1',
      { oldPassword: 'OldPass1', newPassword: 'NewPass2' },
      'session-current',
    )).resolves.toEqual({ ok: true });

    const update = prisma.authIdentity.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'phone-identity' });
    expect(update.data.meta.preserved).toBe('yes');
    await expect(bcrypt.compare('NewPass2', update.data.meta.passwordHash)).resolves.toBe(true);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: 'ACTIVE', id: { not: 'session-current' } },
      data: { status: 'REVOKED', expiresAt: expect.any(Date) },
    });
    expect(prisma.loginEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1', provider: 'PHONE', phone: PHONE, success: true,
        meta: { action: 'PASSWORD_CHANGED', otherSessionsRevoked: true },
      }),
    });
    expect(prisma.$transaction.mock.calls.at(-1)?.[1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('旧密码错误时不写身份、不撤销会话', async () => {
    const bcrypt = require('bcrypt');
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'phone-identity', userId: 'user-1', identifier: PHONE,
      meta: { passwordHash: bcrypt.hashSync('OldPass1', 4) },
    });
    const { service } = makeService(prisma);

    await expect(service.changePassword(
      'user-1',
      { oldPassword: 'WrongPass1', newPassword: 'NewPass2' },
      'session-current',
    )).rejects.toThrow('旧密码不正确');
    expect(prisma.authIdentity.update).not.toHaveBeenCalled();
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('注销竞态中的账号不能修改密码', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.ACTIVE,
      deletionExecutedAt: new Date(),
    });
    const { service } = makeService(prisma);

    await expect(service.changePassword(
      'user-1',
      { oldPassword: 'OldPass1', newPassword: 'NewPass2' },
      'session-current',
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.authIdentity.update).not.toHaveBeenCalled();
  });
});

describe('AuthService — 旧 App 微信绑定统一身份锁', () => {
  beforeEach(() => jest.clearAllMocks());

  it('在共用微信身份锁和 Serializable 事务内拒绝任一 unionId 候选属于其他用户', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findMany.mockResolvedValue([{ userId: 'other-user' }]);
    const { service, redisCoord } = makeService(prisma);

    await expect(service.bindWechat('active-user', 'same-wechat'))
      .rejects.toThrow('该微信已被其他账号绑定');

    expect(redisCoord.acquireLock).toHaveBeenCalledWith(
      expect.stringMatching(/^auth:wechat-identity:/),
      expect.any(String),
      10_000,
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(prisma.authIdentity.create).not.toHaveBeenCalled();
    expect(redisCoord.releaseLock).toHaveBeenCalled();
  });

  it('写入真实 AppID 和 unionId 列而不是只存 legacy meta', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma, { WECHAT_APP_ID: 'wx-mobile-app-id' });

    await expect(service.bindWechat('active-user', 'new-wechat')).resolves.toEqual({ ok: true });

    expect(prisma.authIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'active-user',
        provider: 'WECHAT',
        appId: 'wx-mobile-app-id',
        unionId: mockWechatOpenId('wx_unionid', 'new-wechat'),
        verified: true,
      }),
    });
  });

  it('App 登录精确 OpenID 属于 A 但 UnionID 候选属于 B 时 fail-closed', async () => {
    const prisma = makePrisma();
    const code = 'exact-a-union-b';
    const openId = mockWechatOpenId('wx_openid', code);
    const unionId = mockWechatOpenId('wx_unionid', code);
    prisma.authIdentity.findMany.mockImplementation((args: any) => {
      if (args?.where?.identifier === openId) {
        return Promise.resolve([{
          id: 'wechat-exact-a',
          userId: 'user-a',
          provider: 'WECHAT',
          identifier: openId,
          unionId,
          appId: 'mock-mobile-app',
          meta: {},
          user: { status: UserStatus.ACTIVE, deletionExecutedAt: null },
        }]);
      }
      return Promise.resolve([{
        id: 'wechat-union-b',
        userId: 'user-b',
        provider: 'WECHAT',
        identifier: 'other-app-openid',
        unionId,
        appId: 'other-app-id',
        meta: {},
        user: { status: UserStatus.ACTIVE, deletionExecutedAt: null },
      }]);
    });
    const { service } = makeService(prisma);

    await expect(service.loginWithWeChat(code))
      .rejects.toThrow('微信身份与统一身份冲突');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('App 首登 Serializable 连续冲突时有限重试并最终 fail-closed', async () => {
    const prisma = makePrisma();
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    prisma.$transaction.mockRejectedValue(conflict);
    const { service } = makeService(prisma);

    await expect(service.loginWithWeChat('app-serializable-conflict'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it.each([false, null])(
    '微信锁续租返回 %s 时在创建用户前 fail-closed',
    async (renewed) => {
      const prisma = makePrisma();
      const { service, redisCoord } = makeService(prisma);
      redisCoord.renewLock
        .mockResolvedValueOnce(true)
        .mockResolvedValue(renewed);

      await expect(service.loginWithWeChat(`lost-lock-${String(renewed)}`))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.authIdentity.create).not.toHaveBeenCalled();
      expect(prisma.session.create).not.toHaveBeenCalled();
    },
  );

  it('身份事务完成后锁丢失时不签 JWT，并撤销未暴露的 Session', async () => {
    const prisma = makePrisma();
    const { service, redisCoord, jwt } = makeService(prisma);
    redisCoord.renewLock
      .mockResolvedValueOnce(true) // 事务前
      .mockResolvedValueOnce(true) // 用户+身份写入前
      .mockResolvedValueOnce(true) // issueTokens 前
      .mockResolvedValueOnce(false); // JWT 签发紧前

    await expect(service.loginWithWeChat('lost-before-token-sign'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-new', status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
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
    const unionKey = createHash('sha256').update(`union:${unionId}`).digest('hex').slice(0, 24);
    expect(redisCoord.acquireLock).toHaveBeenCalledWith(
      `auth:wechat-identity:${unionKey}`,
      expect.any(String),
      10000,
    );
    expect(redisCoord.releaseLock).toHaveBeenCalledWith(
      `auth:wechat-identity:${unionKey}`,
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
    prisma.authIdentity.findMany.mockResolvedValue([{
      id: 'identity-wx',
      userId: 'deleted-user',
      provider: 'WECHAT',
      identifier: OPENID,
      appId: 'mock-mobile-app',
      unionId: mockWechatOpenId('wx_unionid', 'wx-code'),
      meta: {},
      user: { status: UserStatus.DELETED },
    }]);
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.DELETED,
      deletionExecutedAt: new Date(),
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

  it('refresh preserves the exact mini-program authIdentityId instead of selecting another identity', async () => {
    const prisma = makePrisma();
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    prisma.session.findFirst.mockResolvedValue({
      id: 'session-old',
      userId: 'active-user',
      authIdentityId: 'mini-identity-1',
      absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    });
    prisma.authIdentity.findFirst.mockImplementation((args: any) => {
      if (args?.where?.id === 'mini-identity-1') {
        return Promise.resolve({
          id: 'mini-identity-1',
          userId: 'active-user',
          provider: 'WECHAT',
          appId: 'mini-app-id',
          verified: true,
        });
      }
      return Promise.resolve(null);
    });
    const { service } = makeService(prisma, {
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });

    const result = await service.refresh({ refreshToken: 'refresh-token' } as any);

    expect(result).toMatchObject({ loginMethod: 'wechat-miniapp' });
    expect(prisma.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'active-user',
        authIdentityId: 'mini-identity-1',
      }),
    });
  });

  it('legacy session without authIdentityId cannot gain mini-program payment identity on refresh', async () => {
    const prisma = makePrisma();
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    prisma.session.findFirst.mockResolvedValue({
      id: 'session-legacy',
      userId: 'active-user',
      authIdentityId: null,
      absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    });
    const { service } = makeService(prisma, {
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });

    const result = await service.refresh({ refreshToken: 'refresh-token' } as any);

    expect(result).toMatchObject({ loginMethod: 'phone' });
    expect(prisma.authIdentity.findFirst).not.toHaveBeenCalled();
    expect(prisma.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'active-user',
        authIdentityId: null,
      }),
    });
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

describe('AuthService — 微信小程序登录与手机号安全合并', () => {
  beforeEach(() => jest.clearAllMocks());

  it('真实 code2Session 登录直接创建会话，且客户端响应不泄露 session_key/openid/code', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockImplementation((args: any) =>
      Promise.resolve(args?.where?.id === 'identity-new' ? { id: 'identity-new' } : null),
    );
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        openid: 'mini-openid-secret',
        unionid: 'mini-union-secret',
        session_key: 'wechat-session-key-secret',
      }),
    } as any);
    const { service, redisCoord } = makeService(prisma, {
      WECHAT_MOCK: 'false',
      WECHAT_MINIAPP_MOCK: 'false',
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
      WECHAT_MINIAPP_APP_SECRET: 'mini-app-secret',
    });

    const result = await service.loginWithWechatMiniapp('one-time-wechat-code');

    expect(result).toMatchObject({
      userId: 'new-user',
      loginMethod: 'wechat-miniapp',
    });
    const responseText = JSON.stringify(result);
    expect(responseText).not.toContain('one-time-wechat-code');
    expect(responseText).not.toContain('wechat-session-key-secret');
    expect(responseText).not.toContain('mini-openid-secret');
    expect(responseText).not.toContain('mini-union-secret');
    expect(responseText).not.toContain('mini-app-secret');
    expect(redisCoord.set).not.toHaveBeenCalled();
    expect(prisma.authIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'new-user',
        identifier: 'mini-openid-secret',
        unionId: 'mini-union-secret',
        appId: 'mini-app-id',
      }),
    });
    fetchSpy.mockRestore();
  });

  it('unionId 命中 App 既有账号时绑定新的小程序 appId+openid，并复用同一 User', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockImplementation((args: any) =>
      Promise.resolve(args?.where?.id === 'identity-new' ? { id: 'identity-new' } : null),
    );
    prisma.authIdentity.findMany.mockResolvedValue([
      {
        id: 'existing-app-wechat',
        userId: 'existing-user',
        identifier: 'mobile-openid',
        unionId: mockWechatOpenId('wx_unionid', 'same-wechat'),
        appId: 'mobile-app-id',
        meta: {},
        user: { status: UserStatus.ACTIVE },
      },
    ]);
    const { service } = makeService(prisma, {
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });

    const result = await service.loginWithWechatMiniapp('same-wechat');

    expect(result).toMatchObject({
      userId: 'existing-user',
      loginMethod: 'wechat-miniapp',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.authIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'existing-user',
        provider: 'WECHAT',
        appId: 'mini-app-id',
        unionId: mockWechatOpenId('wx_unionid', 'same-wechat'),
      }),
    });
  });

  it('在每次 Serializable 事务内重新裁决 exact A + 新出现 union B，不回填错误 unionId', async () => {
    const prisma = makePrisma();
    const code = 'mini-stale-exact-union-conflict';
    const openId = mockWechatOpenId('wx_miniapp_openid_mini-app-id', code);
    const unionId = mockWechatOpenId('wx_unionid', code);
    const txAuthIdentity = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'mini-exact-a',
        userId: 'user-a',
        identifier: openId,
        unionId: null,
        appId: 'mini-app-id',
        meta: {},
        user: { status: UserStatus.ACTIVE, deletionExecutedAt: null },
      }),
      findMany: jest.fn().mockResolvedValue([{
        id: 'other-app-union-b',
        userId: 'user-b',
        identifier: 'other-app-openid',
        unionId,
        appId: 'other-app-id',
        meta: {},
        user: { status: UserStatus.ACTIVE, deletionExecutedAt: null },
      }]),
      create: jest.fn(),
      update: jest.fn(),
    };
    const tx = { ...prisma, authIdentity: txAuthIdentity };
    prisma.$transaction.mockImplementation(async (operation: any) => operation(tx));
    const { service } = makeService(prisma, {
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });

    await expect(service.loginWithWechatMiniapp(code))
      .rejects.toThrow('微信小程序身份与统一身份冲突');

    expect(prisma.authIdentity.findFirst).not.toHaveBeenCalled();
    expect(prisma.authIdentity.findMany).not.toHaveBeenCalled();
    expect(txAuthIdentity.findFirst).toHaveBeenCalled();
    expect(txAuthIdentity.findMany).toHaveBeenCalled();
    expect(txAuthIdentity.update).not.toHaveBeenCalled();
    expect(txAuthIdentity.create).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('小程序事务内候选裁决后锁丢失时，不回填 unionId 也不签发 Session', async () => {
    const prisma = makePrisma();
    const code = 'mini-lock-lost-before-union-backfill';
    const openId = mockWechatOpenId('wx_miniapp_openid_mini-app-id', code);
    const txAuthIdentity = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'mini-exact-a',
        userId: 'user-a',
        identifier: openId,
        unionId: null,
        appId: 'mini-app-id',
        meta: {},
        user: { status: UserStatus.ACTIVE, deletionExecutedAt: null },
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    };
    const tx = { ...prisma, authIdentity: txAuthIdentity };
    prisma.$transaction.mockImplementation(async (operation: any) => operation(tx));
    const { service, redisCoord } = makeService(prisma, {
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });
    redisCoord.renewLock
      .mockResolvedValueOnce(true) // 进入 Serializable 前
      .mockResolvedValueOnce(false); // 候选裁决后、身份回填前

    await expect(service.loginWithWechatMiniapp(code))
      .rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(txAuthIdentity.findFirst).toHaveBeenCalled();
    expect(txAuthIdentity.findMany).toHaveBeenCalled();
    expect(txAuthIdentity.update).not.toHaveBeenCalled();
    expect(txAuthIdentity.create).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('小程序自动补身份连续发生 P2034 时有限重试并最终返回 503', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockResolvedValue({
      id: 'existing-mini-identity',
      userId: 'existing-user',
      identifier: mockWechatOpenId('wx_miniapp_openid_mini-app-id', 'retry-conflict'),
      unionId: mockWechatOpenId('wx_unionid', 'retry-conflict'),
      appId: 'mini-app-id',
      meta: {},
      user: { status: UserStatus.ACTIVE, deletionExecutedAt: null },
    });
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    prisma.$transaction.mockRejectedValue(conflict);
    const { service } = makeService(prisma, {
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });

    await expect(service.loginWithWechatMiniapp('retry-conflict'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('无法匹配 App 或既有小程序身份时直接创建微信买家账号，不要求手机号', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findFirst.mockImplementation((args: any) =>
      Promise.resolve(args?.where?.id === 'identity-new' ? { id: 'identity-new' } : null),
    );
    const { service, couponEngine, growthEvents } = makeService(prisma, {
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });

    const session = await service.loginWithWechatMiniapp('new-mini-user');

    expect(session).toMatchObject({
      userId: 'new-user',
      loginMethod: 'wechat-miniapp',
    });
    expect(session).not.toHaveProperty('bindRequired');
    expect(session).not.toHaveProperty('miniLoginTicket');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buyerNo: 'AIMM00000000000001',
        profile: { create: expect.objectContaining({ nickname: expect.any(String) }) },
        memberProfile: { create: expect.objectContaining({ referralCode: expect.any(String) }) },
        growthAccount: { create: expect.any(Object) },
        normalShareProfile: { create: expect.objectContaining({ status: 'ACTIVE' }) },
      }),
      select: { id: true },
    });
    expect(prisma.authIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'new-user',
        provider: 'WECHAT',
        appId: 'mini-app-id',
        verified: true,
      }),
    });
    expect(prisma.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'new-user',
        authIdentityId: 'identity-new',
      }),
    });
    expect(couponEngine.handleTrigger).toHaveBeenCalledWith('new-user', 'REGISTER');
    expect(growthEvents.receive).toHaveBeenCalled();
  });

  it('生产环境 SMS_MOCK=true 时小程序绑定发码与身份写入均 fail-closed', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma, {
      NODE_ENV: 'production',
      SMS_MOCK: 'true',
      WECHAT_MOCK: 'false',
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });
    const ticket = await (service as any).createMiniappLoginTicket({
      openId: 'mini-openid',
      unionId: 'mini-unionid',
      appId: 'mini-app-id',
      appType: 'MINI_PROGRAM',
      accessToken: null,
    });

    await expect(service.sendWechatMiniappBindPhoneCode(ticket, PHONE))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.bindWechatMiniappPhone(ticket, PHONE, '123456'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.smsOtp.create).not.toHaveBeenCalled();
    expect(prisma.authIdentity.create).not.toHaveBeenCalled();
  });

  it('生产环境 WECHAT_MOCK=true 时旧 App 微信登录 fail-closed 且不创建账号', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma, {
      NODE_ENV: 'production',
      WECHAT_MOCK: 'true',
    });

    await expect(service.loginWithWeChat('mock-code'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.authIdentity.create).not.toHaveBeenCalled();
  });

  it('拒绝过期或用途被篡改的 ticket', async () => {
    const prisma = makePrisma();
    const { service, redisCoord } = makeService(prisma, {
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });
    const profile = {
      openId: 'ticket-openid',
      unionId: 'ticket-unionid',
      appId: 'mini-app-id',
      appType: 'MINI_PROGRAM',
      accessToken: null,
    };
    const ticket = await (service as any).createMiniappLoginTicket(profile);
    const [ticketKey, storedValue] = redisCoord.set.mock.calls[0];
    const payload = JSON.parse(storedValue);

    await redisCoord.set(ticketKey, JSON.stringify({
      ...payload,
      purpose: 'PASSWORD_RESET',
    }));
    await expect(
      service.sendWechatMiniappBindPhoneCode(ticket, PHONE),
    ).rejects.toThrow('小程序登录凭证无效或已过期');

    const expiredTicket = await (service as any).createMiniappLoginTicket({
      ...profile,
      openId: 'expired-ticket-openid',
    });
    const latestSetCall = redisCoord.set.mock.calls
      .filter((call: any[]) => call[2] === 5 * 60_000)
      .at(-1);
    const expiredKey = latestSetCall[0];
    const expiredPayload = JSON.parse(latestSetCall[1]);
    await redisCoord.set(expiredKey, JSON.stringify({
      ...expiredPayload,
      issuedAt: Date.now() - 6 * 60_000,
      expiresAt: Date.now() - 60_000,
    }));
    await expect(
      service.sendWechatMiniappBindPhoneCode(expiredTicket, PHONE),
    ).rejects.toThrow('小程序登录凭证无效或已过期');
  });

  it('DTO 禁止客户端夹带 userId 指定合并目标', async () => {
    const dto = Object.assign(new WechatMiniappLoginDto(), {
      code: 'wechat-code',
      userId: 'victim-user-id',
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.some((error) => error.property === 'userId')).toBe(true);
  });

  it('生产环境强制拒绝 Mock 小程序登录', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma, {
      NODE_ENV: 'production',
      WECHAT_MINIAPP_MOCK: 'true',
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
    });

    await expect(service.loginWithWechatMiniapp('client-controlled-code'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.authIdentity.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('检查全部 UnionID 候选，第四条出现另一账号时 fail-closed', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findMany.mockResolvedValue([
      { id: 'wx-1', userId: 'user-a', user: { status: UserStatus.ACTIVE } },
      { id: 'wx-2', userId: 'user-a', user: { status: UserStatus.ACTIVE } },
      { id: 'wx-3', userId: 'user-a', user: { status: UserStatus.ACTIVE } },
      { id: 'wx-4', userId: 'user-b', user: { status: UserStatus.ACTIVE } },
    ]);
    const { service } = makeService(prisma, { WECHAT_MINIAPP_APP_ID: 'mini-app-id' });

    await expect(service.loginWithWechatMiniapp('conflicting-union'))
      .rejects.toThrow('微信统一身份关联多个账号');
    expect(prisma.authIdentity.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
  });

  it('code2Session 非 2xx 时按上游不可用失败，不创建 ticket 或身份', async () => {
    const prisma = makePrisma();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      json: jest.fn(),
    } as any);
    const { service, redisCoord } = makeService(prisma, {
      WECHAT_MINIAPP_MOCK: 'false',
      WECHAT_MINIAPP_APP_ID: 'mini-app-id',
      WECHAT_MINIAPP_APP_SECRET: 'mini-app-secret',
    });

    await expect(service.loginWithWechatMiniapp('wechat-upstream-error'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(redisCoord.set).not.toHaveBeenCalled();
    expect(prisma.authIdentity.create).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('命中身份后在事务内复核注销状态，已注销时不补建小程序身份', async () => {
    const prisma = makePrisma();
    prisma.authIdentity.findMany.mockResolvedValue([
      {
        id: 'existing-mobile-wechat',
        userId: 'deleted-user',
        identifier: 'mobile-openid',
        unionId: mockWechatOpenId('wx_unionid', 'deleted-union'),
        appId: 'mobile-app-id',
        meta: {},
        user: { status: UserStatus.ACTIVE, deletionExecutedAt: null },
      },
    ]);
    prisma.user.findUnique.mockResolvedValue({
      status: UserStatus.DELETED,
      deletionExecutedAt: new Date(),
    });
    const { service } = makeService(prisma, { WECHAT_MINIAPP_APP_ID: 'mini-app-id' });

    await expect(service.loginWithWechatMiniapp('deleted-union'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.authIdentity.create).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
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
    prisma.authIdentity.findFirst.mockResolvedValue(null);
    prisma.authIdentity.findMany.mockResolvedValue([existingIdentity]);
    const state = await (service as any).createH5WechatState({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_1',
    });

    const result = await (service as any).h5WechatInviteLogin({
      wechatCode,
      state,
      inviteCode: 'SABC1234',
    });

    expect(prisma.authIdentity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: 'WECHAT',
        OR: expect.arrayContaining([
          { unionId },
          { meta: { path: ['unionId'], equals: unionId } },
        ]),
      }),
      include: { user: { select: { status: true, deletionExecutedAt: true } } },
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
      if (args?.where?.provider === 'WECHAT' && args?.where?.identifier === h5OpenId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    prisma.authIdentity.findMany.mockResolvedValue([legacyIdentity]);
    const state = await (service as any).createH5WechatState({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_session_legacy',
    });

    const result = await (service as any).h5WechatInviteLogin({
      wechatCode,
      state,
      inviteCode: 'SABC1234',
    });

    expect(prisma.authIdentity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: 'WECHAT',
        OR: expect.arrayContaining([
          { unionId },
          { meta: { path: ['unionId'], equals: unionId } },
        ]),
      }),
      include: { user: { select: { status: true, deletionExecutedAt: true } } },
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
