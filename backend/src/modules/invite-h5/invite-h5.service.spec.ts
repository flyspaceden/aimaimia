import { BadRequestException } from '@nestjs/common';
import { InviteH5Service } from './invite-h5.service';

const makeHarness = () => {
  const prisma: any = {
    inviteH5LandingEvent: {
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    referralLink: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn(),
    },
    normalShareBinding: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn(),
    },
    memberProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const resolver = {
    resolve: jest.fn(),
  };
  const normalShare = {
    bind: jest.fn(),
  };
  const bonus = {
    useReferralCode: jest.fn(),
  };
  const service = new InviteH5Service(prisma, resolver as any, normalShare as any, bonus as any);

  return { prisma, resolver, normalShare, bonus, service };
};

describe('InviteH5Service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records landing without returning inviter information', async () => {
    const { prisma, resolver, service } = makeHarness();
    resolver.resolve.mockResolvedValue({
      status: 'NORMAL_SHARE',
      code: 'SABC1234',
      inviterUserId: 'inviter-1',
    });
    prisma.inviteH5LandingEvent.create.mockResolvedValue({
      landingSessionId: 'ih5_session_1',
    });

    const result = await service.recordLanding(
      {
        inviteCode: ' sabc1234 ',
        userAgent: 'Mozilla/5.0',
        screenWidth: 390,
        screenHeight: 844,
        language: 'zh-CN',
      },
      '127.0.0.1',
    );

    expect(prisma.inviteH5LandingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inviteCode: 'SABC1234',
        inviteType: 'NORMAL_SHARE',
        inviterUserId: 'inviter-1',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        screenInfo: '390x844',
        language: 'zh-CN',
      }),
      select: { landingSessionId: true },
    });
    expect(result).toEqual({ landingSessionId: 'ih5_session_1', codeStatus: 'NORMAL_SHARE' });
    expect(result).not.toHaveProperty('inviterUserId');
  });

  it('stores INVALID code opens for stats without binding inviter', async () => {
    const { prisma, resolver, service } = makeHarness();
    resolver.resolve.mockResolvedValue({ status: 'INVALID', code: 'BADCODE1' });
    prisma.inviteH5LandingEvent.create.mockResolvedValue({
      landingSessionId: 'ih5_session_invalid',
    });

    const result = await service.recordLanding({ inviteCode: 'badcode1' }, '10.0.0.1');

    expect(prisma.inviteH5LandingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inviteCode: 'BADCODE1',
        inviteType: 'INVALID',
        inviterUserId: null,
      }),
      select: { landingSessionId: true },
    });
    expect(result).toEqual({ landingSessionId: 'ih5_session_invalid', codeStatus: 'INVALID' });
  });

  it('updates landing event after auth and successful normal binding', async () => {
    const { prisma, resolver, normalShare, service } = makeHarness();
    resolver.resolve.mockResolvedValue({
      status: 'NORMAL_SHARE',
      code: 'SABC1234',
      inviterUserId: 'inviter-1',
    });
    normalShare.bind.mockResolvedValue({ id: 'binding-1' });

    const result = await service.bindAfterAuth({
      userId: 'invitee-1',
      inviteCode: 'sabc1234',
      landingSessionId: 'ih5_session_1',
    });

    expect(normalShare.bind).toHaveBeenCalledWith('invitee-1', {
      code: 'SABC1234',
      source: 'LANDING',
    });
    expect(prisma.inviteH5LandingEvent.updateMany).toHaveBeenCalledWith({
      where: { landingSessionId: 'ih5_session_1' },
      data: expect.objectContaining({
        authedUserId: 'invitee-1',
        bindingStatus: 'BOUND',
        bindingType: 'NORMAL_SHARE',
        errorCode: null,
        boundAt: expect.any(Date),
      }),
    });
    expect(result).toEqual({
      status: 'BOUND',
      type: 'NORMAL_SHARE',
      message: '推荐关系已记录',
    });
  });

  it('uses landing session invite code as the source of truth when binding after auth', async () => {
    const { prisma, resolver, normalShare, service } = makeHarness();
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({
      inviteCode: 'SLANDING',
    });
    resolver.resolve.mockResolvedValue({
      status: 'NORMAL_SHARE',
      code: 'SLANDING',
      inviterUserId: 'landing-inviter',
    });
    normalShare.bind.mockResolvedValue({ id: 'binding-landing' });

    const result = await service.bindAfterAuth({
      userId: 'invitee-1',
      inviteCode: 'VIPCODE1',
      landingSessionId: 'ih5_session_1',
    });

    expect(prisma.inviteH5LandingEvent.findUnique).toHaveBeenCalledWith({
      where: { landingSessionId: 'ih5_session_1' },
      select: { inviteCode: true },
    });
    expect(resolver.resolve).toHaveBeenCalledWith('SLANDING');
    expect(normalShare.bind).toHaveBeenCalledWith('invitee-1', {
      code: 'SLANDING',
      source: 'LANDING',
    });
    expect(result).toMatchObject({ status: 'BOUND', type: 'NORMAL_SHARE' });
  });

  it('returns already-bound without overwriting another inviter', async () => {
    const { prisma, resolver, normalShare, bonus, service } = makeHarness();
    resolver.resolve.mockResolvedValue({
      status: 'VIP_REFERRAL',
      code: 'VIPCODE1',
      inviterUserId: 'vip-inviter-1',
    });
    prisma.normalShareBinding.findUnique.mockResolvedValue({
      relationStatus: 'ACTIVE',
      inviterUserId: 'other-inviter',
      effectiveInviterUserId: 'other-inviter',
    });

    const result = await service.bindAfterAuth({
      userId: 'invitee-1',
      inviteCode: 'VIPCODE1',
      landingSessionId: 'ih5_session_2',
    });

    expect(normalShare.bind).not.toHaveBeenCalled();
    expect(bonus.useReferralCode).not.toHaveBeenCalled();
    expect(prisma.inviteH5LandingEvent.updateMany).toHaveBeenCalledWith({
      where: { landingSessionId: 'ih5_session_2' },
      data: expect.objectContaining({
        authedUserId: 'invitee-1',
        bindingStatus: 'ALREADY_BOUND_OTHER',
        boundAt: undefined,
      }),
    });
    expect(result).toEqual({
      status: 'ALREADY_BOUND_OTHER',
      type: 'VIP_REFERRAL',
      message: '已绑定推荐关系，无法覆盖',
    });
  });

  it('maps self invite and invalid codes without calling binding services', async () => {
    const { resolver, normalShare, bonus, service } = makeHarness();
    resolver.resolve.mockResolvedValueOnce({
      status: 'NORMAL_SHARE',
      code: 'SABC1234',
      inviterUserId: 'invitee-1',
    });

    await expect(service.bindAfterAuth({
      userId: 'invitee-1',
      inviteCode: 'SABC1234',
    })).resolves.toMatchObject({ status: 'SELF_INVITE', type: 'NORMAL_SHARE' });

    resolver.resolve.mockResolvedValueOnce({ status: 'INVALID', code: 'BADCODE1' });

    await expect(service.bindAfterAuth({
      userId: 'invitee-1',
      inviteCode: 'BADCODE1',
    })).resolves.toMatchObject({ status: 'INVALID_CODE', type: null });

    expect(normalShare.bind).not.toHaveBeenCalled();
    expect(bonus.useReferralCode).not.toHaveBeenCalled();
  });

  it('maps known binding exceptions to non-throwing statuses', async () => {
    const { resolver, normalShare, service } = makeHarness();
    resolver.resolve.mockResolvedValue({
      status: 'NORMAL_SHARE',
      code: 'SABC1234',
      inviterUserId: 'inviter-1',
    });
    normalShare.bind.mockRejectedValue(new BadRequestException('已绑定推荐关系，不能更换'));

    await expect(service.bindAfterAuth({
      userId: 'invitee-1',
      inviteCode: 'SABC1234',
    })).resolves.toMatchObject({
      status: 'ALREADY_BOUND_OTHER',
      type: 'NORMAL_SHARE',
    });
  });

  it('counts H5 opens by event and H5 authed/bound users uniquely', async () => {
    const { prisma, service } = makeHarness();
    prisma.inviteH5LandingEvent.count.mockResolvedValueOnce(6);
    prisma.inviteH5LandingEvent.findMany
      .mockResolvedValueOnce([
        { authedUserId: 'invitee-1' },
        { authedUserId: 'invitee-2' },
      ])
      .mockResolvedValueOnce([
        { authedUserId: 'invitee-1' },
      ]);

    const result = await service.getStatsForInviter('inviter-1');

    expect(prisma.inviteH5LandingEvent.count).toHaveBeenCalledWith({
      where: { inviterUserId: 'inviter-1' },
    });
    expect(prisma.inviteH5LandingEvent.findMany).toHaveBeenCalledWith({
      where: {
        inviterUserId: 'inviter-1',
        authedUserId: { not: null },
      },
      distinct: ['authedUserId'],
      select: { authedUserId: true },
    });
    expect(prisma.inviteH5LandingEvent.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        inviterUserId: 'inviter-1',
        authedUserId: { not: null },
        bindingStatus: { in: ['BOUND', 'ALREADY_BOUND_SAME'] },
      },
      distinct: ['authedUserId'],
      select: { authedUserId: true },
    });
    expect(prisma.normalShareBinding.count).not.toHaveBeenCalled();
    expect(prisma.referralLink.count).not.toHaveBeenCalled();
    expect(result).toEqual({ openCount: 6, authedCount: 2, boundCount: 1 });
  });
});
