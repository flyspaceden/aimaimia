import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
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
  const wechatMiniProgram = {
    isAvailable: jest.fn().mockReturnValue(true),
    postJson: jest.fn(),
  };
  const config = {
    get: jest.fn((_key: string, fallback: string) => fallback),
  };
  const service = new InviteH5Service(
    prisma,
    resolver as any,
    normalShare as any,
    bonus as any,
    wechatMiniProgram as any,
    config as any,
  );

  return { prisma, resolver, normalShare, bonus, wechatMiniProgram, config, service };
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

  it('creates a one-day URL Link for the landing event’s resolved mini-program referral path', async () => {
    const { prisma, resolver, wechatMiniProgram, service } = makeHarness();
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({ inviteCode: 'SABC1234' });
    resolver.resolve.mockResolvedValue({
      status: 'NORMAL_SHARE',
      code: 'SABC1234',
      inviterUserId: 'inviter-1',
    });
    wechatMiniProgram.postJson.mockResolvedValue({
      url_link: 'https://wxaurl.cn/AbCdEf',
    });

    await expect(service.createMiniProgramLink({
      inviteCode: 'sabc1234',
      landingSessionId: 'ih5_0123456789abcdef01234567',
    })).resolves.toEqual({ urlLink: 'https://wxaurl.cn/AbCdEf' });

    expect(wechatMiniProgram.postJson).toHaveBeenCalledWith('/wxa/generate_urllink', {
      path: 'packages/referral/landing/index',
      query: 'code=SABC1234&kind=normal',
      expire_type: 1,
      expire_interval: 1,
      env_version: 'release',
    });
  });

  it('holds the URL Link claim for one minute so a token-refresh retry cannot be reclaimed', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-11T12:00:00.000Z'));
    try {
      const { prisma, resolver, wechatMiniProgram, service } = makeHarness();
      prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({ inviteCode: 'SABC1234' });
      resolver.resolve.mockResolvedValue({
        status: 'NORMAL_SHARE',
        code: 'SABC1234',
        inviterUserId: 'inviter-1',
      });
      wechatMiniProgram.postJson.mockResolvedValue({ url_link: 'https://wxaurl.cn/OneMinuteLease' });

      await service.createMiniProgramLink({
        inviteCode: 'SABC1234',
        landingSessionId: 'ih5_0123456789abcdef01234567',
      });

      expect(prisma.inviteH5LandingEvent.updateMany.mock.calls[0][0]).toEqual(expect.objectContaining({
        data: { miniProgramUrlLinkClaimUntil: new Date('2026-08-11T12:01:00.000Z') },
      }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the configured trial or development environment when issuing a URL Link outside production', async () => {
    const { prisma, resolver, wechatMiniProgram, config, service } = makeHarness();
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({ inviteCode: 'VIPCODE1' });
    resolver.resolve.mockResolvedValue({
      status: 'VIP_REFERRAL',
      code: 'VIPCODE1',
      inviterUserId: 'inviter-1',
    });
    config.get.mockReturnValue('trial');
    wechatMiniProgram.postJson.mockResolvedValue({ url_link: 'https://wxaurl.cn/TrialLink' });

    await service.createMiniProgramLink({
      inviteCode: 'VIPCODE1',
      landingSessionId: 'ih5_0123456789abcdef01234567',
    });

    expect(wechatMiniProgram.postJson).toHaveBeenCalledWith('/wxa/generate_urllink', expect.objectContaining({
      query: 'code=VIPCODE1&kind=vip',
      env_version: 'trial',
    }));
  });

  it('reuses an unexpired URL Link for the same landing session without another WeChat request', async () => {
    const { prisma, resolver, wechatMiniProgram, service } = makeHarness();
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({
      inviteCode: 'SABC1234',
      miniProgramUrlLink: 'https://wxaurl.cn/ReusableLink',
      miniProgramUrlLinkExpiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.createMiniProgramLink({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_0123456789abcdef01234567',
    })).resolves.toEqual({ urlLink: 'https://wxaurl.cn/ReusableLink' });

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(wechatMiniProgram.postJson).not.toHaveBeenCalled();
    expect(prisma.inviteH5LandingEvent.updateMany).not.toHaveBeenCalled();
  });

  it('does not make a duplicate WeChat request while another request is generating the same URL Link', async () => {
    const { prisma, resolver, wechatMiniProgram, service } = makeHarness();
    prisma.inviteH5LandingEvent.findUnique
      .mockResolvedValueOnce({
        inviteCode: 'SABC1234',
        miniProgramUrlLink: null,
        miniProgramUrlLinkExpiresAt: null,
      })
      .mockResolvedValueOnce({
        miniProgramUrlLink: null,
        miniProgramUrlLinkExpiresAt: null,
      });
    prisma.inviteH5LandingEvent.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.createMiniProgramLink({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_0123456789abcdef01234567',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(wechatMiniProgram.postJson).not.toHaveBeenCalled();
  });

  it('does not generate a mini-program URL Link when the supplied code differs from its landing event', async () => {
    const { prisma, resolver, wechatMiniProgram, service } = makeHarness();
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({ inviteCode: 'SABC1234' });

    await expect(service.createMiniProgramLink({
      inviteCode: 'VIPCODE1',
      landingSessionId: 'ih5_0123456789abcdef01234567',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(wechatMiniProgram.postJson).not.toHaveBeenCalled();
  });

  it('fails closed without calling WeChat when the mini-program platform is unavailable', async () => {
    const { prisma, resolver, wechatMiniProgram, service } = makeHarness();
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({ inviteCode: 'SABC1234' });
    resolver.resolve.mockResolvedValue({
      status: 'NORMAL_SHARE',
      code: 'SABC1234',
      inviterUserId: 'inviter-1',
    });
    wechatMiniProgram.isAvailable.mockReturnValue(false);

    await expect(service.createMiniProgramLink({
      inviteCode: 'SABC1234',
      landingSessionId: 'ih5_0123456789abcdef01234567',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(wechatMiniProgram.postJson).not.toHaveBeenCalled();
  });

  it('fails closed when WeChat returns a URL Link outside wxaurl.cn', async () => {
    const { prisma, resolver, wechatMiniProgram, service } = makeHarness();
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({ inviteCode: 'VIPCODE1' });
    resolver.resolve.mockResolvedValue({
      status: 'VIP_REFERRAL',
      code: 'VIPCODE1',
      inviterUserId: 'inviter-1',
    });
    wechatMiniProgram.postJson.mockResolvedValue({ url_link: 'https://example.com/not-wechat' });

    await expect(service.createMiniProgramLink({
      inviteCode: 'VIPCODE1',
      landingSessionId: 'ih5_0123456789abcdef01234567',
    })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('issues a ten-minute client-generated download pass only to the authenticated H5 user', async () => {
    const { prisma, service } = makeHarness();
    const ticket = 'A'.repeat(43);
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({
      authedUserId: 'invitee-1',
      downloadPassHash: null,
      downloadPassExpiresAt: null,
      downloadPassUsedAt: null,
    });

    const result = await service.createDownloadPass('invitee-1', 'ih5_session_1', ticket);

    expect(result.status).toBe('READY');
    if (result.status !== 'READY') throw new Error('expected READY pass');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60 * 1000);
    expect(new Date(result.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 1_000);
    expect(prisma.inviteH5LandingEvent.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ landingSessionId: 'ih5_session_1', authedUserId: 'invitee-1' }),
      data: expect.objectContaining({
        downloadPassHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        downloadPassExpiresAt: expect.any(Date),
        downloadPassUsedAt: null,
      }),
    });
  });

  it('reuses the same active download pass for a network retry without overwriting it', async () => {
    const { prisma, service } = makeHarness();
    const expiresAt = new Date(Date.now() + 60_000);
    prisma.inviteH5LandingEvent.updateMany.mockResolvedValue({ count: 1 });
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({
      authedUserId: 'invitee-1',
      downloadPassHash: createHash('sha256').update('A'.repeat(43)).digest('hex'),
      downloadPassExpiresAt: expiresAt,
      downloadPassUsedAt: null,
    });

    await expect(service.createDownloadPass('invitee-1', 'ih5_session_1', 'A'.repeat(43)))
      .resolves.toEqual({ status: 'READY', expiresAt: expiresAt.toISOString() });
    expect(prisma.inviteH5LandingEvent.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        landingSessionId: 'ih5_session_1',
        authedUserId: 'invitee-1',
        downloadPassHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        downloadPassExpiresAt: { gt: expect.any(Date) },
        downloadPassUsedAt: null,
      }),
      data: { downloadPassExpiresAt: expiresAt },
    });
  });

  it('returns the settled same ticket when another identical request wins first issuance', async () => {
    const { prisma, service } = makeHarness();
    const ticket = 'A'.repeat(43);
    const expiresAt = new Date(Date.now() + 60_000);
    prisma.inviteH5LandingEvent.updateMany.mockResolvedValue({ count: 0 });
    prisma.inviteH5LandingEvent.findUnique
      .mockResolvedValueOnce({
        authedUserId: 'invitee-1',
        downloadPassHash: null,
        downloadPassExpiresAt: null,
        downloadPassUsedAt: null,
      })
      .mockResolvedValueOnce({
        authedUserId: 'invitee-1',
        downloadPassHash: createHash('sha256').update(ticket).digest('hex'),
        downloadPassExpiresAt: expiresAt,
        downloadPassUsedAt: null,
      });

    await expect(service.createDownloadPass('invitee-1', 'ih5_session_1', ticket))
      .resolves.toEqual({ status: 'READY', expiresAt: expiresAt.toISOString() });
  });

  it('requires renewal when the system browser consumes a pass during a same-ticket retry', async () => {
    const { prisma, service } = makeHarness();
    const ticket = 'A'.repeat(43);
    const ticketHash = createHash('sha256').update(ticket).digest('hex');
    const expiresAt = new Date(Date.now() + 60_000);
    prisma.inviteH5LandingEvent.updateMany.mockResolvedValue({ count: 0 });
    prisma.inviteH5LandingEvent.findUnique
      .mockResolvedValueOnce({
        authedUserId: 'invitee-1',
        downloadPassHash: ticketHash,
        downloadPassExpiresAt: expiresAt,
        downloadPassUsedAt: null,
      })
      .mockResolvedValueOnce({
        authedUserId: 'invitee-1',
        downloadPassHash: ticketHash,
        downloadPassExpiresAt: expiresAt,
        downloadPassUsedAt: new Date(),
      });

    await expect(service.createDownloadPass('invitee-1', 'ih5_session_1', ticket))
      .resolves.toEqual({ status: 'RENEW_REQUIRED' });
  });

  it('requires a fresh ticket instead of resurrecting an expired or consumed pass', async () => {
    const { prisma, service } = makeHarness();
    const ticket = 'A'.repeat(43);
    prisma.inviteH5LandingEvent.updateMany.mockResolvedValue({ count: 0 });
    prisma.inviteH5LandingEvent.findUnique.mockResolvedValue({
      authedUserId: 'invitee-1',
      downloadPassHash: createHash('sha256').update(ticket).digest('hex'),
      downloadPassExpiresAt: new Date(Date.now() - 1),
      downloadPassUsedAt: null,
    });

    await expect(service.createDownloadPass('invitee-1', 'ih5_session_1', ticket))
      .resolves.toEqual({ status: 'RENEW_REQUIRED' });
    expect(prisma.inviteH5LandingEvent.updateMany).not.toHaveBeenCalled();
  });

  it('does not let a different concurrent ticket overwrite an existing active pass', async () => {
    const { prisma, service } = makeHarness();
    const activeTicket = 'A'.repeat(43);
    prisma.inviteH5LandingEvent.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.inviteH5LandingEvent.findUnique
      .mockResolvedValueOnce({
        authedUserId: 'invitee-1',
        downloadPassHash: createHash('sha256').update(activeTicket).digest('hex'),
        downloadPassExpiresAt: new Date(Date.now() + 60_000),
        downloadPassUsedAt: null,
      })
      .mockResolvedValueOnce({
        authedUserId: 'invitee-1',
        downloadPassHash: createHash('sha256').update(activeTicket).digest('hex'),
        downloadPassExpiresAt: new Date(Date.now() + 60_000),
        downloadPassUsedAt: null,
      });

    await expect(service.createDownloadPass('invitee-1', 'ih5_session_1', 'B'.repeat(43)))
      .rejects.toMatchObject({ response: { message: '下载已在另一个窗口准备，请返回原页面继续' } });
  });

  it('rejects issuing a download pass for another user or an unknown H5 session', async () => {
    const { prisma, service } = makeHarness();
    prisma.inviteH5LandingEvent.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.createDownloadPass('other-user', 'ih5_session_1', 'A'.repeat(43)))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('atomically consumes a download pass once without exposing failure reason', async () => {
    const { prisma, service } = makeHarness();
    prisma.inviteH5LandingEvent.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const ticket = 'A'.repeat(43);

    await expect(service.consumeDownloadPass(ticket)).resolves.toEqual({ valid: true });
    await expect(service.consumeDownloadPass(ticket)).resolves.toEqual({ valid: false });
    expect(prisma.inviteH5LandingEvent.updateMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        downloadPassHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        downloadPassExpiresAt: { gt: expect.any(Date) },
        downloadPassUsedAt: null,
        authedUserId: { not: null },
      }),
      data: { downloadPassUsedAt: expect.any(Date) },
    });
  });
});
