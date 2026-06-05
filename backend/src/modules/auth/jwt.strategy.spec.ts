import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';

// ConfigService 仅需提供 JWT_SECRET（Strategy 构造时读取），用 stub 即可
function makeConfig() {
  return {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-jwt-secret';
      throw new Error(`unexpected config key ${key}`);
    }),
  } as any;
}

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ status: UserStatus.ACTIVE }),
    },
    session: {
      findFirst: jest.fn().mockResolvedValue({ id: 'session-1' }),
    },
    ...overrides,
  } as any;
}

describe('JwtStrategy.validate — 账号状态拦截', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('正常 ACTIVE 用户 + 有效 session → 通过', async () => {
    const prisma = makePrisma();
    const strategy = new JwtStrategy(makeConfig(), prisma);

    const result = await strategy.validate({ sub: 'user-1', sessionId: 'session-1' });

    expect(result).toEqual({ sub: 'user-1' });
  });

  it('用户不存在 → UnauthorizedException', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const strategy = new JwtStrategy(makeConfig(), prisma);

    await expect(strategy.validate({ sub: 'ghost', sessionId: 's' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('已封禁用户（BANNED）→ ForbiddenException', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ status: UserStatus.BANNED });
    const strategy = new JwtStrategy(makeConfig(), prisma);

    await expect(strategy.validate({ sub: 'user-1', sessionId: 's' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('已注销用户（DELETED）的旧 JWT → ForbiddenException（核心回归用例）', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ status: UserStatus.DELETED });
    const strategy = new JwtStrategy(makeConfig(), prisma);

    // 即便 session 仍被 mock 为有效，DELETED 也必须在 session 校验之前被拒
    await expect(strategy.validate({ sub: 'deleted-user', sessionId: 's' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // 状态拦截发生在 session 查询之前，不应触达 session 校验
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
  });

  it('session 已过期/被注销 → UnauthorizedException', async () => {
    const prisma = makePrisma();
    prisma.session.findFirst.mockResolvedValue(null);
    const strategy = new JwtStrategy(makeConfig(), prisma);

    await expect(strategy.validate({ sub: 'user-1', sessionId: 's' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
