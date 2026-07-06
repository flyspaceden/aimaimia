import { AdminAppUsersService } from './admin-app-users.service';

describe('AdminAppUsersService buyer public ids', () => {
  const makeService = () => {
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      memberProfile: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const digitalAssetService = {
      clearAccountAssets: jest.fn(),
    };
    return {
      prisma,
      digitalAssetService,
      service: new AdminAppUsersService(prisma as any, digitalAssetService as any),
    };
  };

  const userRow = {
    id: 'user-internal-1',
    buyerNo: 'AIMM00000000000001',
    status: 'ACTIVE',
    createdAt: new Date('2026-06-15T01:00:00.000Z'),
    updatedAt: new Date('2026-06-15T02:00:00.000Z'),
    profile: {
      nickname: '测试买家',
      avatarUrl: 'https://example.com/avatar.png',
      level: '新芽会员',
      growthPoints: 3,
      points: 5,
      gender: null,
      birthday: null,
      city: null,
    },
    authIdentities: [
      { provider: 'PHONE', identifier: '13800138000', verified: true },
    ],
    memberProfile: { tier: 'NORMAL', referralCode: null },
    normalShareProfile: { code: 'S8K6M2Q9', status: 'ACTIVE' },
    _count: { orders: 2, addresses: 1, followsGiven: 0 },
  };

  it('returns buyerNo in app user list rows', async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([userRow]);
    prisma.user.count.mockResolvedValue(1);

    const result = await service.findAll();

    expect(result.items[0]).toMatchObject({
      id: 'user-internal-1',
      buyerNo: 'AIMM00000000000001',
      nickname: '测试买家',
    });
  });

  it('returns the current visible recommendation code for normal and VIP app users', async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([
      userRow,
      {
        ...userRow,
        id: 'vip-user-1',
        buyerNo: 'AIMM00000000000002',
        memberProfile: { tier: 'VIP', referralCode: 'VIPCODE1' },
        normalShareProfile: { code: 'SOLDNORMAL', status: 'ACTIVE' },
      },
      {
        ...userRow,
        id: 'normal-without-share-code',
        buyerNo: 'AIMM00000000000003',
        memberProfile: { tier: 'NORMAL', referralCode: null },
        normalShareProfile: null,
      },
    ]);
    prisma.user.count.mockResolvedValue(3);

    const result = await service.findAll();

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'user-internal-1',
        memberTier: 'NORMAL',
        normalShareCode: 'S8K6M2Q9',
        normalShareStatus: 'ACTIVE',
        vipReferralCode: null,
      }),
      expect.objectContaining({
        id: 'vip-user-1',
        memberTier: 'VIP',
        normalShareCode: null,
        normalShareStatus: null,
        vipReferralCode: 'VIPCODE1',
      }),
      expect.objectContaining({
        id: 'normal-without-share-code',
        memberTier: 'NORMAL',
        normalShareCode: null,
        normalShareStatus: null,
        vipReferralCode: null,
      }),
    ]));
  });

  it('returns buyerNo in app user detail', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(userRow);

    const result = await service.findById('user-internal-1');

    expect(result).toMatchObject({
      id: 'user-internal-1',
      buyerNo: 'AIMM00000000000001',
      nickname: '测试买家',
    });
  });

  it('returns recommendation relationship summary in app user detail', async () => {
    const { service, prisma } = makeService();
    const boundAt = new Date('2026-07-05T01:00:00.000Z');
    const vipCreatedAt = new Date('2026-07-05T02:00:00.000Z');
    prisma.user.findUnique.mockResolvedValue({
      ...userRow,
      memberProfile: {
        tier: 'VIP',
        referralCode: 'VIPCODE1',
        inviterUserId: 'vip-inviter-1',
        vipPurchasedAt: vipCreatedAt,
      },
      normalShareProfile: {
        id: 'share-profile-1',
        userId: 'user-internal-1',
        code: 'S8K6M2Q9',
        status: 'ACTIVE',
        disabledReason: null,
        createdAt: boundAt,
        updatedAt: boundAt,
      },
      normalShareBindingReceived: {
        id: 'binding-received-1',
        inviterUserId: 'normal-inviter-1',
        inviteeUserId: 'user-internal-1',
        code: 'S1111111',
        source: 'APP',
        relationStatus: 'SUPERSEDED_BY_VIP_TREE',
        relationInvalidAt: vipCreatedAt,
        relationInvalidReason: '推荐人已是 VIP，关系转入 VIP 树',
        effectiveInviterUserId: 'vip-inviter-1',
        boundAt,
        firstOrderId: null,
        rewardStatus: 'REGISTER_REWARDED',
        rewardIssuedAt: boundAt,
        createdAt: boundAt,
        updatedAt: vipCreatedAt,
        inviter: {
          id: 'normal-inviter-1',
          buyerNo: 'AIMM00000000001001',
          profile: { nickname: '普通推荐人', avatarUrl: null },
          authIdentities: [{ identifier: '13900000001' }],
        },
        firstOrder: null,
      },
      normalShareBindingsMade: [
        {
          id: 'binding-made-1',
          inviterUserId: 'user-internal-1',
          inviteeUserId: 'normal-invitee-1',
          code: 'S8K6M2Q9',
          source: 'APP',
          relationStatus: 'ACTIVE',
          relationInvalidAt: null,
          relationInvalidReason: null,
          effectiveInviterUserId: 'user-internal-1',
          boundAt,
          firstOrderId: 'order-1',
          rewardStatus: 'ISSUED',
          rewardIssuedAt: vipCreatedAt,
          createdAt: boundAt,
          updatedAt: vipCreatedAt,
          invitee: {
            id: 'normal-invitee-1',
            buyerNo: 'AIMM00000000002001',
            profile: { nickname: '普通被推荐人', avatarUrl: null },
            authIdentities: [{ identifier: '13900000002' }],
            memberProfile: { tier: 'NORMAL' },
          },
          firstOrder: { id: 'order-1', orderNo: 'NO1', totalAmount: 128, status: 'RECEIVED', createdAt: vipCreatedAt },
        },
      ],
      referralReceived: {
        id: 'vip-ref-received-1',
        inviterUserId: 'vip-inviter-1',
        inviteeUserId: 'user-internal-1',
        codeUsed: 'VIPIN001',
        channel: 'APP',
        createdAt: vipCreatedAt,
        inviter: {
          id: 'vip-inviter-1',
          buyerNo: 'AIMM00000000003001',
          profile: { nickname: 'VIP推荐人', avatarUrl: null },
          authIdentities: [{ identifier: '13900000003' }],
        },
      },
    });
    prisma.memberProfile.findMany.mockResolvedValue([
      {
        userId: 'vip-invitee-1',
        tier: 'VIP',
        referralCode: 'VIPCHILD',
        vipPurchasedAt: vipCreatedAt,
        user: {
          id: 'vip-invitee-1',
          buyerNo: 'AIMM00000000004001',
          profile: { nickname: 'VIP被推荐人', avatarUrl: null },
          authIdentities: [{ identifier: '13900000004' }],
        },
      },
    ]);

    const result = await service.findById('user-internal-1');

    expect(result.recommendation).toMatchObject({
      visibleCode: {
        type: 'VIP_REFERRAL',
        code: 'VIPCODE1',
        url: 'https://app.ai-maimai.com/r/VIPCODE1',
      },
      currentInviter: {
        id: 'vip-inviter-1',
        buyerNo: 'AIMM00000000003001',
        nickname: 'VIP推荐人',
      },
      counts: {
        directNormalInvitees: 1,
        activeNormalInvitees: 1,
        directVipInvitees: 1,
      },
      normalShareProfile: {
        code: 'S8K6M2Q9',
        shareUrl: 'https://app.ai-maimai.com/s/S8K6M2Q9',
      },
      normalBindingReceived: {
        id: 'binding-received-1',
        relationStatus: 'SUPERSEDED_BY_VIP_TREE',
        inviter: { nickname: '普通推荐人' },
      },
      vipReferralReceived: {
        id: 'vip-ref-received-1',
        codeUsed: 'VIPIN001',
        inviter: { nickname: 'VIP推荐人' },
      },
      directNormalInvitees: [
        {
          id: 'binding-made-1',
          invitee: { nickname: '普通被推荐人' },
          firstOrder: { orderNo: 'order-1' },
        },
      ],
      directVipInvitees: [
        {
          userId: 'vip-invitee-1',
          referralCode: 'VIPCHILD',
          user: { nickname: 'VIP被推荐人' },
        },
      ],
    });
  });

  it('searches app users by buyerNo keyword', async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await service.findAll(1, 20, undefined, 'AIMM00000000000001');

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { buyerNo: 'AIMM00000000000001' },
        ]),
      }),
    }));
  });

  it('orders app users by order count when table sorting requests it', async () => {
    const { service, prisma } = makeService();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await service.findAll(1, 20, undefined, undefined, undefined, undefined, undefined, 'orderCount', 'ascend');

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { orders: { _count: 'asc' } },
        { createdAt: 'desc' },
        { id: 'asc' },
      ],
    }));
  });

  it('resolves AIMM detail input to the internal user id', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-internal-1' })
      .mockResolvedValueOnce(userRow);

    const result = await service.findById('AIMM00000000000001');

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, {
      where: { buyerNo: 'AIMM00000000000001' },
      select: { id: true },
    });
    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'user-internal-1' },
    }));
    expect(result.id).toBe('user-internal-1');
  });

  it('clears digital assets when banning an app user', async () => {
    const { service, prisma, digitalAssetService } = makeService();
    prisma.user.findUnique.mockResolvedValue(userRow);
    prisma.user.update.mockResolvedValue({ ...userRow, status: 'BANNED' });

    await service.toggleBan('user-internal-1', 'BANNED');

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(digitalAssetService.clearAccountAssets).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        userId: 'user-internal-1',
        reason: 'SERIOUS_BAN',
      }),
    );
  });
});
