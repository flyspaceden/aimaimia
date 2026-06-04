import { BadRequestException } from '@nestjs/common';
import { DeferredLinkService } from './deferred-link.service';

describe('DeferredLinkService.create — 推荐码有效性', () => {
  it('拒绝普通用户的 referralCode，只有 VIP 码才能生成延迟深链', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'normal-user',
          referralCode: 'NORMAL01',
          tier: 'NORMAL',
        }),
      },
      deferredDeepLink: {
        create: jest.fn(),
      },
    };
    const service = new DeferredLinkService(prismaMock);

    await expect(
      service.create(
        {
          referralCode: 'NORMAL01',
          userAgent: 'Mozilla/5.0 iPhone',
          screenWidth: 390,
          screenHeight: 844,
          language: 'zh-CN',
        },
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prismaMock.deferredDeepLink.create).not.toHaveBeenCalled();
  });

  it('拒绝已注销 VIP 推荐人的 referralCode（账号注销 Task 4）', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'vip-deleted',
          referralCode: 'VIPCODE1',
          tier: 'VIP',
          user: {
            status: 'DELETED',
            deletionExecutedAt: new Date('2026-06-01T00:00:00.000Z'),
          },
        }),
      },
      deferredDeepLink: {
        create: jest.fn(),
      },
    };
    const service = new DeferredLinkService(prismaMock);

    await expect(
      service.create(
        {
          referralCode: 'VIPCODE1',
          userAgent: 'Mozilla/5.0 iPhone',
          screenWidth: 390,
          screenHeight: 844,
          language: 'zh-CN',
        },
        '127.0.0.1',
      ),
    ).rejects.toThrow('推荐人账号不可用');

    expect(prismaMock.deferredDeepLink.create).not.toHaveBeenCalled();
  });

  it('正常 ACTIVE VIP 推荐人允许生成延迟深链', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'vip-active',
          referralCode: 'VIPCODE1',
          tier: 'VIP',
          user: { status: 'ACTIVE', deletionExecutedAt: null },
        }),
      },
      deferredDeepLink: {
        create: jest.fn().mockResolvedValue({ cookieId: 'ddl_abc' }),
      },
    };
    const service = new DeferredLinkService(prismaMock);

    await expect(
      service.create(
        {
          referralCode: 'VIPCODE1',
          userAgent: 'Mozilla/5.0 iPhone',
          screenWidth: 390,
          screenHeight: 844,
          language: 'zh-CN',
        },
        '127.0.0.1',
      ),
    ).resolves.toEqual({ cookieId: 'ddl_abc' });

    expect(prismaMock.deferredDeepLink.create).toHaveBeenCalled();
  });
});

describe('DeferredLinkService.resolve — 已注销推荐人防护', () => {
  function buildResolveMock(opts: {
    found: any;
    member: any;
  }) {
    const updateMock = jest.fn(async ({ data }: any) => ({ ...opts.found, ...data }));
    const prismaMock: any = {
      deferredDeepLink: {
        findUnique: jest.fn().mockResolvedValue(opts.found),
        update: updateMock,
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue(opts.member),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    return { prismaMock, updateMock };
  }

  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);

  it('推荐人已注销时返回 referralCode=null，但链路仍被消费（matched=true，不复用）', async () => {
    const { prismaMock, updateMock } = buildResolveMock({
      found: { id: 'ddl-1', cookieId: 'ddl_x', referralCode: 'VIPCODE1', matched: false, expiresAt: futureExpiry },
      member: {
        userId: 'vip-deleted',
        referralCode: 'VIPCODE1',
        tier: 'VIP',
        user: { status: 'DELETED', deletionExecutedAt: new Date('2026-06-01T00:00:00.000Z') },
      },
    });
    const service = new DeferredLinkService(prismaMock);

    const result = await service.resolve('ddl_x');

    expect(result).toEqual({ referralCode: null });
    // 链路仍被标记已消费，避免被重复探测
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'ddl-1' },
      data: { matched: true },
    });
  });

  it('推荐人 ACTIVE 时正常返回 referralCode', async () => {
    const { prismaMock } = buildResolveMock({
      found: { id: 'ddl-2', cookieId: 'ddl_y', referralCode: 'VIPCODE2', matched: false, expiresAt: futureExpiry },
      member: {
        userId: 'vip-active',
        referralCode: 'VIPCODE2',
        tier: 'VIP',
        user: { status: 'ACTIVE', deletionExecutedAt: null },
      },
    });
    const service = new DeferredLinkService(prismaMock);

    const result = await service.resolve('ddl_y');

    expect(result).toEqual({ referralCode: 'VIPCODE2' });
  });
});
