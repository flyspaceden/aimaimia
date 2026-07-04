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
      rewardStatus: 'PENDING',
    });
    expect(tx.normalShareBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inviterUserId: 'inviter-1',
        inviteeUserId: 'invitee-1',
        code: 'SABCDEFG',
        source: 'APP',
      }),
    });
    expect(tx.referralLink.findUnique).toHaveBeenCalledWith({
      where: { inviteeUserId: 'invitee-1' },
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
        rewardStatus: 'PENDING',
      },
      data: {
        rewardStatus: 'REGISTER_REWARDED',
        rewardIssuedAt: expect.any(Date),
      },
    });
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

  it('cannot bind the invitee to their own normal share code', async () => {
    const { service, tx } = makeHarness({
      profileByCode: activeShareProfile({ userId: 'invitee-1' }),
    });

    await expect(
      service.bind('invitee-1', { code: 'SABCDEFG', source: 'APP' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
  });

  it('rejects ordinary share codes owned by VIP inviters', async () => {
    const { service, tx } = makeHarness({
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
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.normalShareBinding.create).not.toHaveBeenCalled();
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

  it('counts all unissued bindings as pending invitees', async () => {
    const count = jest.fn(({ where }: any) => {
      if (!where.rewardStatus) return Promise.resolve(8);
      if (where.rewardStatus === 'ISSUED') return Promise.resolve(3);
      if (where.rewardStatus?.in) return Promise.resolve(5);
      return Promise.resolve(0);
    });
    const service = new NormalShareService({
      normalShareBinding: { count },
      memberProfile: { findUnique: jest.fn().mockResolvedValue({ tier: 'NORMAL' }) },
    } as any, { receive: jest.fn() } as any);

    await expect(service.getStats('inviter-1')).resolves.toEqual({
      totalInvitees: 8,
      rewardedInvitees: 3,
      pendingInvitees: 5,
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        inviterUserId: 'inviter-1',
        rewardStatus: { in: ['PENDING', 'REGISTER_REWARDED', 'FIRST_ORDER_PENDING'] },
      },
    });
  });
});
