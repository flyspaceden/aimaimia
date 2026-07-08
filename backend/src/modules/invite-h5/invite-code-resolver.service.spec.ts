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

describe('InviteCodeResolverService', () => {
  it('resolves an active normal share code', async () => {
    const { prisma, service } = makeHarness();
    prisma.normalShareProfile.findUnique.mockResolvedValue({
      userId: 'normal-inviter-1',
      status: 'ACTIVE',
    });
    prisma.memberProfile.findUnique.mockResolvedValue(null);

    const result = await service.resolve(' sabc1234 ');

    expect(prisma.normalShareProfile.findUnique).toHaveBeenCalledWith({
      where: { code: 'SABC1234' },
      select: { userId: true, status: true },
    });
    expect(prisma.memberProfile.findUnique).toHaveBeenCalledWith({
      where: { referralCode: 'SABC1234' },
      select: { userId: true, tier: true },
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
    prisma.memberProfile.findUnique.mockResolvedValue({
      userId: 'vip-inviter-1',
      tier: 'VIP',
    });

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
    prisma.normalShareProfile.findUnique.mockResolvedValue({
      userId: 'normal-inviter-1',
      status: 'ACTIVE',
    });
    prisma.memberProfile.findUnique.mockResolvedValue({
      userId: 'vip-inviter-1',
      tier: 'VIP',
    });

    await expect(service.resolve('samecode')).resolves.toEqual({
      status: 'CONFLICT',
      code: 'SAMECODE',
    });
  });
});
