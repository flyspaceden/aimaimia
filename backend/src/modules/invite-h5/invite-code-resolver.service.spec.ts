import { InviteCodeResolverService } from './invite-code-resolver.service';

const makeHarness = () => {
  const prisma: any = {
    normalShareProfile: {
      findUnique: jest.fn(),
    },
    memberProfile: {
      findUnique: jest.fn(),
    },
  };

  const service = new InviteCodeResolverService(prisma);

  return { prisma, service };
};

const activeNormalShareProfile = (overrides: Record<string, unknown> = {}) => ({
  userId: 'normal-inviter-1',
  status: 'ACTIVE',
  user: {
    status: 'ACTIVE',
    deletionExecutedAt: null,
    memberProfile: { tier: 'NORMAL' },
  },
  ...overrides,
});

const activeVipMemberProfile = (overrides: Record<string, unknown> = {}) => ({
  userId: 'vip-inviter-1',
  tier: 'VIP',
  user: {
    status: 'ACTIVE',
    deletionExecutedAt: null,
  },
  ...overrides,
});

describe('InviteCodeResolverService', () => {
  it('resolves an active normal share code', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue(activeNormalShareProfile());
    prisma.memberProfile.findUnique.mockResolvedValue(null);

    const result = await service.resolve(' sabc1234 ');

    expect(prisma.normalShareProfile.findUnique).toHaveBeenCalledWith({
      where: { code: 'SABC1234' },
      select: {
        userId: true,
        status: true,
        user: {
          select: {
            status: true,
            deletionExecutedAt: true,
            memberProfile: { select: { tier: true } },
          },
        },
      },
    });
    expect(prisma.memberProfile.findUnique).toHaveBeenCalledWith({
      where: { referralCode: 'SABC1234' },
      select: {
        userId: true,
        tier: true,
        user: {
          select: {
            status: true,
            deletionExecutedAt: true,
          },
        },
      },
    });
    expect(result).toEqual({
      status: 'NORMAL_SHARE',
      code: 'SABC1234',
      inviterUserId: 'normal-inviter-1',
    });
  });

  it('resolves a VIP member referral code only when tier is VIP', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue(null);
    prisma.memberProfile.findUnique.mockResolvedValue(activeVipMemberProfile());

    await expect(service.resolve('vipcode1')).resolves.toEqual({
      status: 'VIP_REFERRAL',
      code: 'VIPCODE1',
      inviterUserId: 'vip-inviter-1',
    });

    prisma.memberProfile.findUnique.mockResolvedValue({
      userId: 'normal-user-1',
      tier: 'NORMAL',
    });

    await expect(service.resolve('normal01')).resolves.toEqual({
      status: 'INVALID',
      code: 'NORMAL01',
    });
  });

  it('does not resolve a normal member hidden MemberProfile.referralCode', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue(null);
    prisma.memberProfile.findUnique.mockResolvedValue({
      userId: 'normal-user-1',
      tier: 'NORMAL',
    });

    await expect(service.resolve('normal01')).resolves.toEqual({
      status: 'INVALID',
      code: 'NORMAL01',
    });
  });

  it('returns INVALID when no table has the code', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue(null);
    prisma.memberProfile.findUnique.mockResolvedValue(null);

    await expect(service.resolve('missing')).resolves.toEqual({
      status: 'INVALID',
      code: 'MISSING',
    });
  });

  it('returns CONFLICT when normal share code and VIP referral code both match', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue(activeNormalShareProfile());
    prisma.memberProfile.findUnique.mockResolvedValue(activeVipMemberProfile());

    await expect(service.resolve('samecode')).resolves.toEqual({
      status: 'CONFLICT',
      code: 'SAMECODE',
    });
  });

  it('resolves VIP referral when matching normal share code is disabled', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue(activeNormalShareProfile({
      status: 'DISABLED',
    }));
    prisma.memberProfile.findUnique.mockResolvedValue(activeVipMemberProfile());

    await expect(service.resolve('samecode')).resolves.toEqual({
      status: 'VIP_REFERRAL',
      code: 'SAMECODE',
      inviterUserId: 'vip-inviter-1',
    });
  });

  it('returns INVALID when active normal share code owner is not bindable', async () => {
    const { prisma, service } = makeHarness();
    prisma.memberProfile.findUnique.mockResolvedValue(null);

    prisma.normalShareProfile.findUnique.mockResolvedValue(activeNormalShareProfile({
      user: {
        status: 'DISABLED',
        deletionExecutedAt: null,
        memberProfile: { tier: 'NORMAL' },
      },
    }));
    await expect(service.resolve('sdisabled')).resolves.toEqual({
      status: 'INVALID',
      code: 'SDISABLED',
    });

    prisma.normalShareProfile.findUnique.mockResolvedValue(activeNormalShareProfile({
      user: {
        status: 'ACTIVE',
        deletionExecutedAt: new Date('2026-07-08T00:00:00.000Z'),
        memberProfile: { tier: 'NORMAL' },
      },
    }));
    await expect(service.resolve('sdeleted')).resolves.toEqual({
      status: 'INVALID',
      code: 'SDELETED',
    });
  });

  it('returns INVALID when active normal share code owner is now VIP', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue(activeNormalShareProfile({
      user: {
        status: 'ACTIVE',
        deletionExecutedAt: null,
        memberProfile: { tier: 'VIP' },
      },
    }));
    prisma.memberProfile.findUnique.mockResolvedValue(null);

    await expect(service.resolve('svipuser')).resolves.toEqual({
      status: 'INVALID',
      code: 'SVIPUSER',
    });
  });

  it('returns INVALID when VIP referral code owner is not bindable', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue(null);

    prisma.memberProfile.findUnique.mockResolvedValue(activeVipMemberProfile({
      user: {
        status: 'DISABLED',
        deletionExecutedAt: null,
      },
    }));
    await expect(service.resolve('vipdisabled')).resolves.toEqual({
      status: 'INVALID',
      code: 'VIPDISABLED',
    });

    prisma.memberProfile.findUnique.mockResolvedValue(activeVipMemberProfile({
      user: {
        status: 'ACTIVE',
        deletionExecutedAt: new Date('2026-07-08T00:00:00.000Z'),
      },
    }));
    await expect(service.resolve('vipdeleted')).resolves.toEqual({
      status: 'INVALID',
      code: 'VIPDELETED',
    });
  });
});
