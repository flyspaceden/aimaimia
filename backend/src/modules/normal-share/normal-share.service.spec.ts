import { BadRequestException } from '@nestjs/common';
import { NormalShareService } from './normal-share.service';

const activeShareProfile = (overrides: Record<string, unknown> = {}) => ({
  id: 'share-profile-1',
  userId: 'inviter-1',
  code: 'SABCDEFG',
  status: 'ACTIVE',
  disabledReason: null,
  user: {
    id: 'inviter-1',
    status: 'ACTIVE',
    deletionExecutedAt: null,
    profile: { nickname: '邀请人' },
  },
  createdAt: new Date('2026-07-03T00:00:00.000Z'),
  updatedAt: new Date('2026-07-03T00:00:00.000Z'),
  ...overrides,
});

const makeHarness = (options: {
  profileByUser?: any;
  memberProfileByUser?: any;
  profileByCode?: any;
  existingNormalBinding?: any;
  existingVipReferral?: any;
  codeCollision?: any;
  vipReferralCodeCollision?: any;
} = {}) => {
  let lastTransactionOptions: any;
  const tx: any = {
    normalShareProfile: {
      findUnique: jest.fn(({ where }: any) => {
        if (where.userId) return Promise.resolve(options.profileByUser ?? null);
        if (where.code) return Promise.resolve(options.profileByCode ?? options.codeCollision ?? null);
        return Promise.resolve(null);
      }),
      create: jest.fn(({ data }: any) => ({
        id: 'share-profile-created',
        status: 'ACTIVE',
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        updatedAt: new Date('2026-07-03T00:00:00.000Z'),
        ...data,
      })),
    },
    normalShareBinding: {
      findUnique: jest.fn().mockResolvedValue(options.existingNormalBinding ?? null),
      create: jest.fn(({ data }: any) => ({
        id: 'binding-created',
        rewardStatus: 'PENDING',
        ...data,
      })),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    referralLink: {
      findUnique: jest.fn().mockResolvedValue(options.existingVipReferral ?? null),
    },
    memberProfile: {
      findUnique: jest.fn().mockResolvedValue(options.memberProfileByUser ?? { tier: 'NORMAL' }),
      findFirst: jest.fn(({ where }: any) => {
        if (where.referralCode) return Promise.resolve(options.vipReferralCodeCollision ?? null);
        return Promise.resolve(null);
      }),
      upsert: jest.fn(({ create, update }: any) => ({
        id: 'member-profile-1',
        userId: create.userId,
        tier: 'NORMAL',
        ...create,
        ...update,
      })),
    },
  };

  const prisma: any = {
    $transaction: jest.fn((callback: any, transactionOptions: any) => {
      lastTransactionOptions = transactionOptions;
      return callback(tx);
    }),
    normalShareBinding: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    memberProfile: {
      findUnique: jest.fn().mockResolvedValue(options.memberProfileByUser ?? { tier: 'NORMAL' }),
    },
  };

  const growthEvents = {
    receive: jest.fn().mockResolvedValue({ status: 'GRANTED' }),
  };

  const service = new NormalShareService(prisma, growthEvents as any);
  jest.spyOn(service as any, 'generateCode').mockReturnValue('SABCDEFG');

  return {
    service,
    tx,
    prisma,
    growthEvents,
    getTransactionOptions: () => lastTransactionOptions,
  };
};

describe('NormalShareService', () => {
  it('creates one normal share code per user', async () => {
    const { service, tx, getTransactionOptions } = makeHarness();

    const result = await service.getMe('user-1') as any;

    expect(getTransactionOptions()).toMatchObject({ isolationLevel: 'Serializable' });
    expect(tx.normalShareProfile.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        code: 'SABCDEFG',
        status: 'ACTIVE',
      },
    });
    expect(result).toMatchObject({
      code: 'SABCDEFG',
      shareUrl: 'https://app.ai-maimai.com/s/SABCDEFG',
    });
  });

  it('returns the same code when the user already has one', async () => {
    const { service, tx } = makeHarness({
      profileByUser: activeShareProfile({ userId: 'user-1' }),
    });

    const result = await service.getMe('user-1') as any;

    expect(result).toMatchObject({ code: 'SABCDEFG' });
    expect(tx.normalShareProfile.create).not.toHaveBeenCalled();
  });

  it('does not create a normal share code that is already used as a VIP referral code', async () => {
    const { service, tx } = makeHarness();
    jest.spyOn(service as any, 'generateCode')
      .mockReturnValueOnce('SABCDEFG')
      .mockReturnValueOnce('SBCDEFGH');
    tx.memberProfile.findFirst.mockImplementation(({ where }: any) => {
      if (where.referralCode === 'SABCDEFG') {
        return Promise.resolve({ id: 'vip-member-profile-1' });
      }
      return Promise.resolve(null);
    });

    await service.getMe('user-1') as any;

    expect(tx.memberProfile.findFirst).toHaveBeenCalledWith({
      where: { referralCode: 'SABCDEFG' },
      select: { id: true },
    });
    expect(tx.normalShareProfile.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        code: 'SBCDEFGH',
        status: 'ACTIVE',
      },
    });
  });

  it('does not create an ordinary share code for VIP users', async () => {
    const { service, tx } = makeHarness({
      memberProfileByUser: { tier: 'VIP' },
    });

    await expect(service.getMe('vip-user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.normalShareProfile.create).not.toHaveBeenCalled();
  });

  it('binds an invitee to an active normal share code', async () => {
    const { service, tx, prisma, growthEvents } = makeHarness({
      profileByCode: activeShareProfile(),
    });

    const result = await service.bind('invitee-1', {
      code: 'sabcdefg',
      source: 'APP',
    }) as any;

    expect(result).toMatchObject({
      id: 'binding-created',
      inviterUserId: 'inviter-1',
      inviteeUserId: 'invitee-1',
      code: 'SABCDEFG',
      relationStatus: 'ACTIVE',
      effectiveInviterUserId: 'inviter-1',
      rewardStatus: 'PENDING',
    });
    expect(tx.normalShareBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inviterUserId: 'inviter-1',
        inviteeUserId: 'invitee-1',
        code: 'SABCDEFG',
        source: 'APP',
        relationStatus: 'ACTIVE',
        effectiveInviterUserId: 'inviter-1',
      }),
    });
    expect(tx.referralLink.findUnique).toHaveBeenCalledWith({
      where: { inviteeUserId: 'invitee-1' },
    });
    expect(tx.memberProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'invitee-1' },
      create: {
        userId: 'invitee-1',
        inviterUserId: 'inviter-1',
      },
      update: { inviterUserId: 'inviter-1' },
    });
    expect(growthEvents.receive).toHaveBeenCalledWith({
      userId: 'inviter-1',
      behaviorCode: 'NORMAL_INVITE_REGISTER',
      idempotencyKey: 'NORMAL_INVITE_REGISTER:inviter-1:invitee-1',
      refType: 'NORMAL_SHARE_BINDING',
      refId: 'binding-created',
      meta: {
        inviteeUserId: 'invitee-1',
        bindingId: 'binding-created',
        code: 'SABCDEFG',
      },
    });
    expect(prisma.normalShareBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'binding-created',
        relationStatus: 'ACTIVE',
        rewardStatus: 'PENDING',
      },
      data: {
        rewardStatus: 'REGISTER_REWARDED',
        rewardIssuedAt: expect.any(Date),
      },
    });
  });

  it('writes MemberProfile.inviterUserId when binding an invitee without an inviter', async () => {
    const { service, tx } = makeHarness({
      profileByCode: activeShareProfile(),
      memberProfileByUser: {
        userId: 'invitee-1',
        tier: 'NORMAL',
        inviterUserId: null,
      },
    });

    await service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' });

    expect(tx.memberProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'invitee-1' },
      create: {
        userId: 'invitee-1',
        inviterUserId: 'inviter-1',
      },
      update: { inviterUserId: 'inviter-1' },
    });
  });

  it('rejects normal share bind when MemberProfile.inviterUserId points to a different inviter', async () => {
    const { service, tx } = makeHarness({
      profileByCode: activeShareProfile(),
      memberProfileByUser: {
        userId: 'invitee-1',
        tier: 'NORMAL',
        inviterUserId: 'another-inviter',
      },
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toThrow('已绑定推荐关系，不能更换');
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
    expect(tx.memberProfile.upsert).not.toHaveBeenCalled();
  });

  it('does not grant register growth again for an idempotent normal share bind', async () => {
    const { service, growthEvents, prisma } = makeHarness({
      profileByCode: activeShareProfile(),
      existingNormalBinding: {
        id: 'binding-existing',
        inviteeUserId: 'invitee-1',
        inviterUserId: 'inviter-1',
        code: 'SABCDEFG',
        rewardStatus: 'REGISTER_REWARDED',
      },
    });

    await expect(service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' })).resolves.toMatchObject({
      id: 'binding-existing',
      isIdempotent: true,
    });
    expect(growthEvents.receive).not.toHaveBeenCalled();
    expect(prisma.normalShareBinding.updateMany).not.toHaveBeenCalled();
  });

  it('does not revive an inactive normal share relation on repeat bind', async () => {
    const { service, tx, growthEvents, prisma } = makeHarness({
      profileByCode: activeShareProfile(),
      memberProfileByUser: {
        userId: 'invitee-1',
        tier: 'NORMAL',
        inviterUserId: null,
      },
      existingNormalBinding: {
        id: 'binding-existing',
        inviteeUserId: 'invitee-1',
        inviterUserId: 'inviter-1',
        effectiveInviterUserId: null,
        code: 'SABCDEFG',
        relationStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
        rewardStatus: 'PENDING',
      },
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toThrow('普通分享关系已失效，不能重新绑定');
    expect(tx.memberProfile.upsert).not.toHaveBeenCalled();
    expect(growthEvents.receive).not.toHaveBeenCalled();
    expect(prisma.normalShareBinding.updateMany).not.toHaveBeenCalled();
  });

  it('rejects idempotent normal share bind when an existing VIP referral points to a different inviter', async () => {
    const { service, tx, growthEvents, prisma } = makeHarness({
      profileByCode: activeShareProfile(),
      existingNormalBinding: {
        id: 'binding-existing',
        inviteeUserId: 'invitee-1',
        inviterUserId: 'inviter-1',
        effectiveInviterUserId: 'inviter-1',
        code: 'SABCDEFG',
        rewardStatus: 'REGISTER_REWARDED',
      },
      existingVipReferral: {
        id: 'vip-referral-existing',
        inviteeUserId: 'invitee-1',
        inviterUserId: 'other-vip',
        codeUsed: 'OTHERVIP',
      },
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toThrow('已绑定推荐关系，不能更换');

    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
    expect(tx.memberProfile.upsert).not.toHaveBeenCalled();
    expect(growthEvents.receive).not.toHaveBeenCalled();
    expect(prisma.normalShareBinding.updateMany).not.toHaveBeenCalled();
  });

  it('does not create a normal binding or grant growth when the same VIP referral already exists', async () => {
    const { service, tx, growthEvents, prisma } = makeHarness({
      profileByCode: activeShareProfile(),
      memberProfileByUser: {
        userId: 'invitee-1',
        tier: 'NORMAL',
        inviterUserId: null,
      },
      existingVipReferral: {
        id: 'vip-referral-existing',
        inviteeUserId: 'invitee-1',
        inviterUserId: 'inviter-1',
        codeUsed: 'VIPCODE1',
      },
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).resolves.toMatchObject({
      id: 'vip-referral-existing',
      inviteeUserId: 'invitee-1',
      inviterUserId: 'inviter-1',
      isIdempotent: true,
    });

    expect(tx.memberProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'invitee-1' },
      create: {
        userId: 'invitee-1',
        inviterUserId: 'inviter-1',
      },
      update: { inviterUserId: 'inviter-1' },
    });
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
    expect(growthEvents.receive).not.toHaveBeenCalled();
    expect(prisma.normalShareBinding.updateMany).not.toHaveBeenCalled();
  });

  it('cannot bind the invitee to their own normal share code', async () => {
    const { service, tx } = makeHarness({
      profileByCode: activeShareProfile({ userId: 'invitee-1' }),
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
  });

  it('rejects historical ordinary share codes after the inviter becomes VIP', async () => {
    const { service, tx, growthEvents } = makeHarness({
      profileByCode: activeShareProfile({
        user: {
          id: 'inviter-1',
          status: 'ACTIVE',
          deletionExecutedAt: null,
          profile: { nickname: 'VIP 邀请人' },
          memberProfile: { tier: 'VIP' },
        },
      }),
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toThrow('VIP 用户请使用 VIP 推荐码邀请');
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
    expect(growthEvents.receive).not.toHaveBeenCalled();
  });

  it('rejects a second normal share binding to a different inviter', async () => {
    const { service, tx } = makeHarness({
      profileByCode: activeShareProfile(),
      existingNormalBinding: {
        id: 'binding-existing',
        inviteeUserId: 'invitee-1',
        inviterUserId: 'another-inviter',
        code: 'SZZZZZZZ',
      },
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
  });

  it('rejects disabled inviter codes', async () => {
    const { service, tx } = makeHarness({
      profileByCode: activeShareProfile({ status: 'DISABLED' }),
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing VIP referral relationship', async () => {
    const { service, tx } = makeHarness({
      profileByCode: activeShareProfile(),
      existingVipReferral: {
        id: 'vip-referral-1',
        inviteeUserId: 'invitee-1',
        inviterUserId: 'vip-inviter-1',
      },
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
  });

  it('counts bindings with any granted invite reward as rewarded invitees', async () => {
    const count = jest.fn(({ where }: any) => {
      if (!where.rewardStatus) return Promise.resolve(8);
      if (where.rewardStatus?.in?.includes('ISSUED')) return Promise.resolve(4);
      if (where.rewardStatus?.in?.includes('PENDING')) return Promise.resolve(5);
      return Promise.resolve(0);
    });
    const service = new NormalShareService({
      normalShareBinding: { count },
      memberProfile: { findUnique: jest.fn().mockResolvedValue({ tier: 'NORMAL' }) },
    } as any, { receive: jest.fn() } as any);

    await expect(service.getStats('inviter-1')).resolves.toEqual({
      totalInvitees: 8,
      rewardedInvitees: 4,
      pendingInvitees: 5,
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        inviterUserId: 'inviter-1',
        relationStatus: 'ACTIVE',
      },
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        inviterUserId: 'inviter-1',
        relationStatus: 'ACTIVE',
        rewardStatus: { in: ['REGISTER_REWARDED', 'ISSUED'] },
      },
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        inviterUserId: 'inviter-1',
        relationStatus: 'ACTIVE',
        rewardStatus: { in: ['PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING'] },
      },
    });
  });
});
