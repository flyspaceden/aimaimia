import { Prisma } from '@prisma/client';
import { BonusService } from './bonus.service';

describe('BonusService.getMemberProfile — 推荐关系展示口径', () => {
  function buildService(prismaMock: any) {
    return new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
    );
  }

  it('普通会员即使有历史 referralCode，也不向 App 返回自己的推荐码', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'normal-user',
          tier: 'NORMAL',
          referralCode: 'NORMAL01',
          inviterUserId: null,
          vipPurchasedAt: null,
          normalEligible: false,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      vipProgress: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = buildService(prismaMock);

    const result = await service.getMemberProfile('normal-user');

    expect(result.referralCode).toBeNull();
    expect(result.inviter).toBeNull();
  });

  it('VIP 会员返回自己的推荐码', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'vip-user',
          tier: 'VIP',
          referralCode: 'VIPCODE1',
          inviterUserId: null,
          vipPurchasedAt: new Date('2026-05-01T00:00:00.000Z'),
          normalEligible: false,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      vipProgress: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = buildService(prismaMock);

    const result = await service.getMemberProfile('vip-user');

    expect(result.referralCode).toBe('VIPCODE1');
  });

  it('返回当前会员直接推荐并已升级为 VIP 的人数', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'vip-user',
          tier: 'VIP',
          referralCode: 'VIPCODE1',
          inviterUserId: null,
          vipPurchasedAt: new Date('2026-05-01T00:00:00.000Z'),
          normalEligible: false,
        }),
        count: jest.fn().mockResolvedValue(3),
      },
      vipProgress: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = buildService(prismaMock);

    const result = await service.getMemberProfile('vip-user');

    expect(prismaMock.memberProfile.count).toHaveBeenCalledWith({
      where: { inviterUserId: 'vip-user', tier: 'VIP' },
    });
    expect(result.inviteeVipCount).toBe(3);
  });

  it('返回已绑定推荐人的昵称和脱敏手机号', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'normal-user',
          tier: 'NORMAL',
          referralCode: null,
          inviterUserId: 'vip-inviter',
          vipPurchasedAt: null,
          normalEligible: false,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      vipProgress: { findUnique: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vip-inviter',
          profile: { nickname: '张三' },
          authIdentities: [{ identifier: '13812345678' }],
        }),
      },
    };
    const service = buildService(prismaMock);

    const result = await service.getMemberProfile('normal-user');

    expect(result.inviter).toEqual({
      userId: 'vip-inviter',
      nickname: '张三',
      maskedPhone: '138****5678',
    });
  });

  it('查询推荐人摘要时只取已验证的最早手机号，避免多 PHONE 身份返回不稳定', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'normal-user',
          tier: 'NORMAL',
          referralCode: null,
          inviterUserId: 'vip-inviter',
          vipPurchasedAt: null,
          normalEligible: false,
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      vipProgress: { findUnique: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vip-inviter',
          profile: { nickname: '张三' },
          authIdentities: [{ identifier: '13812345678' }],
        }),
      },
    };
    const service = buildService(prismaMock);

    await service.getMemberProfile('normal-user');

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'vip-inviter' },
      select: expect.objectContaining({
        authIdentities: {
          where: { provider: 'PHONE', verified: true },
          select: { identifier: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      }),
    });
  });

  it('绑定已写入后，推荐人摘要查询失败也应返回绑定成功', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          })
          .mockResolvedValueOnce({
            userId: 'invitee-y',
            tier: 'NORMAL',
          })
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue({
          inviterUserId: 'vip-user',
          inviteeUserId: 'invitee-y',
          codeUsed: 'VIPCODE1',
        }),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest
          .fn()
          // 1. 事务内校验推荐人 User 状态 → 正常可用
          .mockResolvedValueOnce({ status: 'ACTIVE', deletionExecutedAt: null })
          // 2. buildInviterSummary 查询失败
          .mockRejectedValueOnce(new Error('connection timeout')),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      { handleTrigger: jest.fn() } as any,
      {} as any,
    );

    await expect(
      service.useReferralCode('invitee-y', 'VIPCODE1'),
    ).resolves.toEqual({
      success: true,
      inviterUserId: 'vip-user',
      inviter: null,
    });
  });
});

describe('BonusService.getWithdrawHistory — unified consumption point source filtering', () => {
  function buildService(prismaMock: any) {
    return new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      { handleTrigger: jest.fn() } as any,
      {} as any,
    );
  }

  it('keeps unified group-buy funded withdrawals in wallet history and excludes legacy group-buy withdrawals', async () => {
    const legacyCreatedAt = new Date('2026-06-22T12:00:00.000Z');
    const unifiedCreatedAt = new Date('2026-06-22T11:00:00.000Z');
    const rewardCreatedAt = new Date('2026-06-22T10:00:00.000Z');
    const prismaMock: any = {
      withdrawRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'w-legacy-gb',
            amount: 30,
            channel: 'ALIPAY',
            status: 'PROCESSING',
            accountType: 'GROUP_BUY_REBATE',
            accountSnapshot: { account: 'legacy@example.com', source: 'GROUP_BUY_REBATE_LEGACY' },
            createdAt: legacyCreatedAt,
          },
          {
            id: 'w-unified-gb',
            amount: 25,
            channel: 'ALIPAY',
            status: 'PROCESSING',
            accountType: 'GROUP_BUY_REBATE',
            accountSnapshot: { account: 'unified@example.com', source: 'UNIFIED_POINTS' },
            createdAt: unifiedCreatedAt,
          },
          {
            id: 'w-reward',
            amount: 20,
            channel: 'ALIPAY',
            status: 'PAID',
            accountType: 'VIP_REWARD',
            accountSnapshot: { account: 'reward@example.com' },
            createdAt: rewardCreatedAt,
          },
        ]),
      },
    };
    const service = buildService(prismaMock);

    const result = await service.getWithdrawHistory('user-1');

    expect(prismaMock.withdrawRequest.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 100,
    });
    expect(result).toEqual([
      {
        id: 'w-unified-gb',
        amount: 25,
        channel: 'ALIPAY',
        status: 'PROCESSING',
        createdAt: unifiedCreatedAt.toISOString(),
      },
      {
        id: 'w-reward',
        amount: 20,
        channel: 'ALIPAY',
        status: 'PAID',
        createdAt: rewardCreatedAt.toISOString(),
      },
    ]);
  });

  it('continues scanning when newer legacy group-buy withdrawals fill the first page', async () => {
    const legacyRows = Array.from({ length: 100 }, (_, index) => ({
      id: `w-legacy-${index}`,
      amount: 30,
      channel: 'ALIPAY',
      status: 'PROCESSING',
      accountType: 'GROUP_BUY_REBATE',
      accountSnapshot: { account: 'legacy@example.com', source: 'GROUP_BUY_REBATE_LEGACY' },
      createdAt: new Date(`2026-06-22T12:${String(index % 60).padStart(2, '0')}:00.000Z`),
    }));
    const unifiedCreatedAt = new Date('2026-06-21T11:00:00.000Z');
    const prismaMock: any = {
      withdrawRequest: {
        findMany: jest.fn().mockImplementation(({ skip }: any) => {
          if (skip === 0) return Promise.resolve(legacyRows);
          if (skip === 100) {
            return Promise.resolve([
              {
                id: 'w-unified-after-legacy-page',
                amount: 25,
                channel: 'ALIPAY',
                status: 'PROCESSING',
                accountType: 'GROUP_BUY_REBATE',
                accountSnapshot: { account: 'unified@example.com', source: 'UNIFIED_POINTS' },
                createdAt: unifiedCreatedAt,
              },
            ]);
          }
          return Promise.resolve([]);
        }),
      },
    };
    const service = buildService(prismaMock);

    const result = await service.getWithdrawHistory('user-1');

    expect(prismaMock.withdrawRequest.findMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 100,
    });
    expect(prismaMock.withdrawRequest.findMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      skip: 100,
      take: 100,
    });
    expect(result).toEqual([
      {
        id: 'w-unified-after-legacy-page',
        amount: 25,
        channel: 'ALIPAY',
        status: 'PROCESSING',
        createdAt: unifiedCreatedAt.toISOString(),
      },
    ]);
  });
});

/**
 * 回归测试：CRIT-1 — VIP 激活重试路径状态机错位
 *
 * 历史 bug：
 *   prepare tx 把 FAILED → RETRYING 后，inner tx 的 CAS 期望状态是 FAILED，
 *   导致 CAS 永远命中 0 行，重试路径永远跳过授奖代码块，
 *   推荐人永远拿不到 VIP 推荐奖（每单可能丢失数十至数百元）。
 *
 * 本测试验证：
 *   1. retrying=true 时 CAS 期望状态包含 'RETRYING'（而非 'FAILED'）
 *   2. retrying=false 时 CAS 期望状态包含 'PENDING'
 *   3. 两条路径都把状态推进到 'ACTIVATING'
 */
describe('BonusService.activateVipAfterPayment — CAS 状态机契约', () => {
  function buildService(prismaMock: any) {
    const bonusConfig = { getConfig: jest.fn().mockResolvedValue({}) } as any;
    const couponEngine = {} as any;
    const notificationService = {} as any;
    return new BonusService(
      prismaMock,
      bonusConfig,
      couponEngine,
      notificationService,
    );
  }

  /**
   * 让 $transaction 直接执行 callback，返回它的结果。
   * 同时把 prisma 顶层 mock 当作 tx 传给回调（共用同一个 mock）。
   */
  function makeTxRunner(prismaMock: any) {
    return async (cb: any) => cb(prismaMock);
  }

  it('重试路径：CAS 期望状态必须是 RETRYING（防止 CRIT-1 回归）', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });

    const prismaMock: any = {
      vipPurchase: {
        // prepare tx 看到 FAILED 状态
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'vp-1',
            userId: 'invitee-1',
            orderId: 'order-1',
            activationStatus: 'FAILED',
            referralBonusRate: 0.15,
          })
          // inner tx 在 CAS 后再次 findUnique
          .mockResolvedValueOnce({
            id: 'vp-1',
            userId: 'invitee-1',
            orderId: 'order-1',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0.15,
            amount: 400,
          }),
        // prepare tx 把 FAILED 改成 RETRYING
        update: jest.fn().mockResolvedValue({
          id: 'vp-1',
          activationStatus: 'RETRYING',
        }),
        // 关键断言点：inner tx 的 CAS
        updateMany: updateManyMock,
      },
      memberProfile: {
        // 让 inner tx 走"已是 VIP，补记激活成功"的最短路径，
        // 不需要 mock 后面的 grantVipReferralBonus / 树插入等
        findUnique: jest.fn().mockResolvedValue({
          userId: 'invitee-1',
          tier: 'VIP',
          inviterUserId: 'inviter-1',
          referralCode: 'ABC12345',
        }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));

    const service = buildService(prismaMock);

    await service.activateVipAfterPayment(
      'invitee-1',
      'order-1',
      'gift-1',
      400,
      { title: 'VIP 礼包' },
      'pkg-1',
      0.15,
    );

    // 关键断言：CAS where.activationStatus.in 必须是 ['RETRYING']，绝不能是 ['FAILED']
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const call = updateManyMock.mock.calls[0][0];
    expect(call.where.id).toBe('vp-1');
    expect(call.where.activationStatus).toEqual({ in: ['RETRYING'] });
    expect(call.data.activationStatus).toBe('ACTIVATING');
  });

  it('首次激活路径：CAS 期望状态必须是 PENDING', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });

    const prismaMock: any = {
      vipPurchase: {
        // prepare tx 看到无现存记录 → 走 create 分支
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'vp-2',
            userId: 'invitee-2',
            orderId: 'order-2',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0.15,
            amount: 400,
          }),
        create: jest.fn().mockResolvedValue({
          id: 'vp-2',
          activationStatus: 'PENDING',
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: updateManyMock,
      },
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'invitee-2',
          tier: 'VIP',
          inviterUserId: 'inviter-2',
          referralCode: 'XYZ98765',
        }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));

    const service = buildService(prismaMock);

    await service.activateVipAfterPayment(
      'invitee-2',
      'order-2',
      'gift-2',
      399,
      { title: 'VIP 礼包' },
      'pkg-2',
      0.15,
    );

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const call = updateManyMock.mock.calls[0][0];
    expect(call.where.id).toBe('vp-2');
    expect(call.where.activationStatus).toEqual({ in: ['PENDING'] });
    expect(call.data.activationStatus).toBe('ACTIVATING');
  });

  it('HIGH-2 防御：普通用户的推荐码不能被绑定（tier=NORMAL 应返回"推荐码无效"）', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'normal-user',
          referralCode: 'NORMAL01',
          tier: 'NORMAL',
        }),
      },
    };
    const service = buildService(prismaMock);

    await expect(
      service.useReferralCode('invitee-x', 'NORMAL01'),
    ).rejects.toThrow('推荐码无效');

    // 防御性：拒绝必须发生在事务开始之前，绝不能让普通用户的码进入绑定流程
    expect(prismaMock.memberProfile.findUnique).toHaveBeenCalledTimes(1);
  });

  it('VIP 用户的推荐码可以正常绑定（前置 tier 校验不误伤 VIP）', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest
          .fn()
          // 1. service 入口查 inviter
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          })
          // 2. 事务内查 currentMember（被推荐人当前状态）
          .mockResolvedValueOnce({
            userId: 'invitee-y',
            tier: 'NORMAL',
          })
          // 3. 事务内重新查 inviter（防 TOCTOU）
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          }),
        // pickUniqueReferralCode 内部用 findFirst 检查冲突
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest
          .fn()
          // 1. 事务内校验推荐人 User 状态 → 正常可用
          .mockResolvedValueOnce({ status: 'ACTIVE', deletionExecutedAt: null })
          // 2. buildInviterSummary 查询脱敏摘要
          .mockResolvedValueOnce({
            id: 'vip-user',
            profile: { nickname: '李四' },
            authIdentities: [{ identifier: '13900001111' }],
          }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));

    const couponEngineMock = {
      handleTrigger: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      couponEngineMock as any,
      {} as any,
    );

    await expect(
      service.useReferralCode('invitee-y', 'VIPCODE1'),
    ).resolves.toMatchObject({
      success: true,
      inviterUserId: 'vip-user',
      inviter: {
        userId: 'vip-user',
        nickname: '李四',
        maskedPhone: '139****1111',
      },
    });

    expect(prismaMock.memberProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'invitee-y' },
      create: {
        userId: 'invitee-y',
        inviterUserId: 'vip-user',
      },
      update: { inviterUserId: 'vip-user' },
    });

    expect(prismaMock.referralLink.create).toHaveBeenCalled();
  });

  it('VIP 推荐绑定在事务内重新校验推荐码仍属于 VIP 推荐人', async () => {
    let referralCodeLookupCount = 0;
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.referralCode === 'VIPCODE1') {
            referralCodeLookupCount += 1;
            return Promise.resolve(
              referralCodeLookupCount === 1
                ? {
                    userId: 'vip-user',
                    referralCode: 'VIPCODE1',
                    tier: 'VIP',
                  }
                : {
                    userId: 'vip-user',
                    referralCode: 'VIPCODE1',
                    tier: 'NORMAL',
                  },
            );
          }
          if (where.userId === 'invitee-y') {
            return Promise.resolve({
              userId: 'invitee-y',
              tier: 'NORMAL',
              inviterUserId: null,
            });
          }
          return Promise.resolve(null);
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', deletionExecutedAt: null }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const couponEngineMock = {
      handleTrigger: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      couponEngineMock as any,
      {} as any,
    );

    await expect(
      service.useReferralCode('invitee-y', 'VIPCODE1'),
    ).rejects.toThrow('推荐码无效');

    expect(referralCodeLookupCount).toBe(2);
    expect(prismaMock.referralLink.create).not.toHaveBeenCalled();
    expect(prismaMock.memberProfile.upsert).not.toHaveBeenCalled();
    expect(couponEngineMock.handleTrigger).not.toHaveBeenCalled();
  });

  it('VIP 推荐绑定拒绝已存在的不同普通邀请人', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          })
          .mockResolvedValueOnce({
            userId: 'invitee-y',
            tier: 'NORMAL',
            inviterUserId: 'normal-inviter',
          })
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'normal-binding-1',
          inviteeUserId: 'invitee-y',
          inviterUserId: 'normal-inviter',
          effectiveInviterUserId: 'normal-inviter',
          relationStatus: 'ACTIVE',
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', deletionExecutedAt: null }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const couponEngineMock = {
      handleTrigger: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      couponEngineMock as any,
      {} as any,
    );

    await expect(
      service.useReferralCode('invitee-y', 'VIPCODE1'),
    ).rejects.toThrow('已绑定推荐关系，不能更换');

    expect(prismaMock.referralLink.create).not.toHaveBeenCalled();
    expect(prismaMock.referralLink.update).not.toHaveBeenCalled();
    expect(prismaMock.memberProfile.upsert).not.toHaveBeenCalled();
    expect(couponEngineMock.handleTrigger).not.toHaveBeenCalled();
  });

  it('VIP 推荐绑定遇到同一普通邀请人时保持幂等且不触发 INVITE 红包', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          })
          .mockResolvedValueOnce({
            userId: 'invitee-y',
            tier: 'NORMAL',
            inviterUserId: 'vip-user',
          })
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'normal-binding-1',
          inviteeUserId: 'invitee-y',
          inviterUserId: 'vip-user',
          effectiveInviterUserId: 'vip-user',
          relationStatus: 'ACTIVE',
        }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ status: 'ACTIVE', deletionExecutedAt: null })
          .mockResolvedValueOnce({
            id: 'vip-user',
            profile: { nickname: '李四' },
            authIdentities: [{ identifier: '13900001111' }],
          }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const couponEngineMock = {
      handleTrigger: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      couponEngineMock as any,
      {} as any,
    );

    await expect(
      service.useReferralCode('invitee-y', 'VIPCODE1'),
    ).resolves.toMatchObject({
      success: true,
      inviterUserId: 'vip-user',
    });

    expect(prismaMock.referralLink.create).not.toHaveBeenCalled();
    expect(prismaMock.referralLink.update).not.toHaveBeenCalled();
    expect(prismaMock.memberProfile.upsert).not.toHaveBeenCalled();
    expect(couponEngineMock.handleTrigger).not.toHaveBeenCalled();
  });

  it('VIP 推荐绑定即使普通邀请人相同，也拒绝不同的现有 VIP 推荐链路', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          })
          .mockResolvedValueOnce({
            userId: 'invitee-y',
            tier: 'NORMAL',
            inviterUserId: 'vip-user',
          })
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vip-referral-existing',
          inviteeUserId: 'invitee-y',
          inviterUserId: 'other-vip',
          codeUsed: 'OTHERVIP',
        }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'normal-binding-1',
          inviteeUserId: 'invitee-y',
          inviterUserId: 'vip-user',
          effectiveInviterUserId: 'vip-user',
          relationStatus: 'ACTIVE',
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', deletionExecutedAt: null }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const couponEngineMock = {
      handleTrigger: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      couponEngineMock as any,
      {} as any,
    );

    await expect(
      service.useReferralCode('invitee-y', 'VIPCODE1'),
    ).rejects.toThrow('已绑定推荐关系，不能更换');

    expect(prismaMock.referralLink.create).not.toHaveBeenCalled();
    expect(prismaMock.referralLink.update).not.toHaveBeenCalled();
    expect(prismaMock.memberProfile.upsert).not.toHaveBeenCalled();
    expect(couponEngineMock.handleTrigger).not.toHaveBeenCalled();
  });

  it('VIP 推荐绑定即使现有 VIP 推荐链路相同，也拒绝不同的有效普通邀请人', async () => {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          })
          .mockResolvedValueOnce({
            userId: 'invitee-y',
            tier: 'NORMAL',
            inviterUserId: 'vip-user',
          })
          .mockResolvedValueOnce({
            userId: 'vip-user',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vip-referral-existing',
          inviteeUserId: 'invitee-y',
          inviterUserId: 'vip-user',
          codeUsed: 'VIPCODE1',
        }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'normal-binding-1',
          inviteeUserId: 'invitee-y',
          inviterUserId: 'normal-inviter',
          effectiveInviterUserId: 'normal-inviter',
          relationStatus: 'ACTIVE',
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', deletionExecutedAt: null }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const couponEngineMock = {
      handleTrigger: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      couponEngineMock as any,
      {} as any,
    );

    await expect(
      service.useReferralCode('invitee-y', 'VIPCODE1'),
    ).rejects.toThrow('已绑定推荐关系，不能更换');

    expect(prismaMock.referralLink.create).not.toHaveBeenCalled();
    expect(prismaMock.referralLink.update).not.toHaveBeenCalled();
    expect(prismaMock.memberProfile.upsert).not.toHaveBeenCalled();
    expect(couponEngineMock.handleTrigger).not.toHaveBeenCalled();
  });

  it('CAS 命中 0 行（被其他流程接管）应安全返回，不抛错', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 0 });

    const prismaMock: any = {
      vipPurchase: {
        findUnique: jest.fn().mockResolvedValueOnce({
          id: 'vp-3',
          userId: 'invitee-3',
          orderId: 'order-3',
          activationStatus: 'FAILED',
          referralBonusRate: 0.15,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'vp-3',
          activationStatus: 'RETRYING',
        }),
        updateMany: updateManyMock,
      },
      memberProfile: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));

    const service = buildService(prismaMock);

    await expect(
      service.activateVipAfterPayment(
        'invitee-3',
        'order-3',
        'gift-3',
        399,
        { title: 'VIP 礼包' },
        'pkg-3',
        0.15,
      ),
    ).resolves.toBeUndefined();

    // CAS 命中 0 行后，inner tx 应直接 return，不再去查 memberProfile
    expect(prismaMock.memberProfile.findUnique).not.toHaveBeenCalled();
  });

  it('普通邀请人在被邀请人升级 VIP 时仍是普通用户：普通绑定失效，VIP 树走系统路径且不发一次性 VIP 推荐奖', async () => {
    const prismaMock: any = {
      vipPurchase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'vp-normal-inviter',
            userId: 'invitee-normal-inviter',
            orderId: 'order-normal-inviter',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0.15,
            amount: 400,
          }),
        create: jest.fn().mockResolvedValue({
          id: 'vp-active-inviter',
          activationStatus: 'PENDING',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      memberProfile: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.userId === 'invitee-normal-inviter') {
            return Promise.resolve({
              userId: 'invitee-normal-inviter',
              tier: 'NORMAL',
              inviterUserId: 'normal-inviter',
              referralCode: null,
            });
          }
          if (where.userId === 'normal-inviter') {
            return Promise.resolve({
              userId: 'normal-inviter',
              tier: 'NORMAL',
              vipNodeId: null,
            });
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          userId: 'invitee-normal-inviter',
          tier: 'VIP',
          inviterUserId: 'normal-inviter',
          referralCode: 'NEWVIP01',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vipProgress: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      normalShareBinding: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
    );
    const assignSpy = jest.spyOn(service as any, 'assignVipTreeNode').mockResolvedValue(undefined);
    const grantSpy = jest.spyOn(service as any, 'grantVipReferralBonus').mockResolvedValue(undefined);

    await service.activateVipAfterPayment(
      'invitee-normal-inviter',
      'order-normal-inviter',
      'gift-1',
      400,
      { title: 'VIP 礼包' },
      'pkg-1',
      0.15,
    );

    expect(prismaMock.normalShareBinding.updateMany).toHaveBeenCalledWith({
      where: {
        inviteeUserId: 'invitee-normal-inviter',
        inviterUserId: 'normal-inviter',
        relationStatus: 'ACTIVE',
      },
      data: {
        relationStatus: 'INVALIDATED_BY_INVITEE_VIP_UPGRADE',
        relationInvalidAt: expect.any(Date),
        relationInvalidReason: 'INVITER_NOT_VIP_AT_INVITEE_UPGRADE',
        effectiveInviterUserId: null,
      },
    });
    expect(prismaMock.memberProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'invitee-normal-inviter', inviterUserId: 'normal-inviter' },
      data: { inviterUserId: null },
    });
    expect(assignSpy).toHaveBeenCalledWith(prismaMock, 'invitee-normal-inviter', null);
    expect(grantSpy).not.toHaveBeenCalled();
  });

  it('普通邀请人已先成为 VIP 且有 vipNodeId：普通绑定升级为 VIP 树承接关系', async () => {
    const prismaMock: any = {
      vipPurchase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'vp-vip-inviter',
            userId: 'invitee-vip-inviter',
            orderId: 'order-vip-inviter',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0.15,
            amount: 400,
          }),
        create: jest.fn().mockResolvedValue({
          id: 'vp-deleted-inviter',
          activationStatus: 'PENDING',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      memberProfile: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.userId === 'invitee-vip-inviter') {
            return Promise.resolve({
              userId: 'invitee-vip-inviter',
              tier: 'NORMAL',
              inviterUserId: 'vip-inviter',
              referralCode: null,
            });
          }
          if (where.userId === 'vip-inviter') {
            return Promise.resolve({
              userId: 'vip-inviter',
              tier: 'VIP',
              vipNodeId: 'node-vip-inviter',
            });
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          userId: 'invitee-vip-inviter',
          tier: 'VIP',
          inviterUserId: 'vip-inviter',
          referralCode: 'NEWVIP01',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      vipProgress: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      normalShareBinding: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
    );
    const assignSpy = jest.spyOn(service as any, 'assignVipTreeNode').mockResolvedValue(undefined);
    const grantSpy = jest.spyOn(service as any, 'grantVipReferralBonus').mockResolvedValue(undefined);

    await service.activateVipAfterPayment(
      'invitee-vip-inviter',
      'order-vip-inviter',
      'gift-1',
      400,
      { title: 'VIP 礼包' },
      'pkg-1',
      0.15,
    );

    expect(prismaMock.normalShareBinding.updateMany).toHaveBeenCalledWith({
      where: {
        inviteeUserId: 'invitee-vip-inviter',
        inviterUserId: 'vip-inviter',
        relationStatus: 'ACTIVE',
      },
      data: {
        relationStatus: 'SUPERSEDED_BY_VIP_TREE',
      },
    });
    expect(prismaMock.memberProfile.updateMany).not.toHaveBeenCalled();
    expect(assignSpy).toHaveBeenCalledWith(prismaMock, 'invitee-vip-inviter', 'vip-inviter');
    expect(grantSpy).not.toHaveBeenCalled();
  });

  it('没有普通绑定但存在 VIP 推荐关系时，VIP 升级仍落在推荐人子树并传递数字资产邀请人', async () => {
    const digitalAssetService = {
      grantVipActivationAssets: jest.fn().mockResolvedValue(undefined),
    };
    const prismaMock: any = {
      vipPurchase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'vp-vip-referral-only',
            userId: 'invitee-vip-referral-only',
            orderId: 'order-vip-referral-only',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0.2,
            amount: 600,
          }),
        create: jest.fn().mockResolvedValue({
          id: 'vp-vip-referral-only',
          activationStatus: 'PENDING',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      memberProfile: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.userId === 'invitee-vip-referral-only') {
            return Promise.resolve({
              userId: 'invitee-vip-referral-only',
              tier: 'NORMAL',
              inviterUserId: 'vip-inviter',
              referralCode: null,
            });
          }
          if (where.userId === 'vip-inviter') {
            return Promise.resolve({
              userId: 'vip-inviter',
              tier: 'VIP',
              vipNodeId: 'node-vip-inviter',
            });
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          userId: 'invitee-vip-referral-only',
          tier: 'VIP',
          inviterUserId: 'vip-inviter',
          referralCode: 'NEWVIP03',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      vipProgress: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      normalShareBinding: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
      digitalAssetService as any,
    );
    const assignSpy = jest.spyOn(service as any, 'assignVipTreeNode').mockResolvedValue(undefined);
    const grantSpy = jest.spyOn(service as any, 'grantVipReferralBonus').mockResolvedValue(undefined);

    await service.activateVipAfterPayment(
      'invitee-vip-referral-only',
      'order-vip-referral-only',
      'gift-1',
      600,
      { title: 'VIP 礼包' },
      'pkg-1',
      0.2,
    );

    expect(prismaMock.normalShareBinding.updateMany).toHaveBeenCalledWith({
      where: {
        inviteeUserId: 'invitee-vip-referral-only',
        inviterUserId: 'vip-inviter',
        relationStatus: 'ACTIVE',
      },
      data: {
        relationStatus: 'SUPERSEDED_BY_VIP_TREE',
      },
    });
    expect(prismaMock.memberProfile.updateMany).not.toHaveBeenCalled();
    expect(assignSpy).toHaveBeenCalledWith(prismaMock, 'invitee-vip-referral-only', 'vip-inviter');
    expect(digitalAssetService.grantVipActivationAssets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        inviterUserId: 'vip-inviter',
      }),
    );
    expect(grantSpy).not.toHaveBeenCalled();
  });

  it('VIP 包激活即使 referralBonusRate 大于 0，也不调用一次性 VIP 推荐奖励', async () => {
    const prismaMock: any = {
      vipPurchase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'vp-no-onetime-bonus',
            userId: 'invitee-no-onetime-bonus',
            orderId: 'order-no-onetime-bonus',
            activationStatus: 'ACTIVATING',
            referralBonusRate: 0.25,
            amount: 800,
          }),
        create: jest.fn().mockResolvedValue({
          id: 'vp-no-onetime-bonus',
          activationStatus: 'PENDING',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      memberProfile: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.userId === 'invitee-no-onetime-bonus') {
            return Promise.resolve({
              userId: 'invitee-no-onetime-bonus',
              tier: 'NORMAL',
              inviterUserId: 'vip-inviter',
              referralCode: null,
            });
          }
          if (where.userId === 'vip-inviter') {
            return Promise.resolve({
              userId: 'vip-inviter',
              tier: 'VIP',
              vipNodeId: 'node-vip-inviter',
            });
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          userId: 'invitee-no-onetime-bonus',
          tier: 'VIP',
          inviterUserId: 'vip-inviter',
          referralCode: 'NEWVIP02',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      vipProgress: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      normalShareBinding: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'assignVipTreeNode').mockResolvedValue(undefined);
    const grantSpy = jest.spyOn(service as any, 'grantVipReferralBonus').mockResolvedValue(undefined);

    await service.activateVipAfterPayment(
      'invitee-no-onetime-bonus',
      'order-no-onetime-bonus',
      'gift-1',
      800,
      { title: 'VIP 礼包' },
      'pkg-1',
      0.25,
    );

    expect(grantSpy).not.toHaveBeenCalled();
  });
});

describe('BonusService.activateVipByCumulativeSpend — 累计消费自动升级 VIP', () => {
  function makeTxRunner(prismaMock: any) {
    return async (cb: any) => cb(prismaMock);
  }

  function buildService(prismaMock: any, config: any = {}) {
    return new BonusService(
      prismaMock,
      {
        getConfig: jest.fn().mockResolvedValue({
          autoVipBySpendEnabled: true,
          autoVipCumulativeSpendThreshold: 399,
          ...config,
        }),
      } as any,
      {} as any,
      {} as any,
    );
  }

  function buildAutoVipPrisma(options: {
    member?: any;
    account?: any;
    inviter?: any;
    normalProgress?: any;
  } = {}) {
    const member = options.member ?? {
      userId: 'user-auto',
      tier: 'NORMAL',
      inviterUserId: 'vip-inviter',
      referralCode: null,
      vipPurchasedAt: null,
    };
    const inviter = options.inviter ?? {
      userId: 'vip-inviter',
      tier: 'VIP',
      vipNodeId: 'node-vip-inviter',
    };
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest.fn(({ where }: any) => {
          if (where.userId === 'user-auto') return Promise.resolve(member);
          if (where.userId === 'vip-inviter') return Promise.resolve(inviter);
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          ...member,
          tier: 'VIP',
          referralCode: member.referralCode ?? 'NEWVIP01',
          vipPurchasedAt: member.vipPurchasedAt ?? new Date('2026-07-05T00:00:00.000Z'),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      digitalAssetAccount: {
        findUnique: jest.fn().mockResolvedValue(options.account ?? {
          userId: 'user-auto',
          cumulativeSpendAmount: 399,
        }),
      },
      vipProgress: {
        upsert: jest.fn().mockResolvedValue({ userId: 'user-auto' }),
      },
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue(options.normalProgress ?? {
          userId: 'user-auto',
          frozenAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      normalShareBinding: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vipPurchase: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    return prismaMock;
  }

  it('配置关闭时直接返回 DISABLED，不升级会员', async () => {
    const prismaMock = buildAutoVipPrisma();
    const service = buildService(prismaMock, { autoVipBySpendEnabled: false });

    const result = await service.activateVipByCumulativeSpend('user-auto', 'order-1');

    expect(result).toEqual({ status: 'DISABLED' });
    expect(prismaMock.memberProfile.upsert).not.toHaveBeenCalled();
  });

  it('累计消费未达到配置门槛时返回 NOT_ELIGIBLE', async () => {
    const prismaMock = buildAutoVipPrisma({
      account: { userId: 'user-auto', cumulativeSpendAmount: 398.99 },
    });
    const service = buildService(prismaMock, { autoVipCumulativeSpendThreshold: 399 });

    const result = await service.activateVipByCumulativeSpend('user-auto', 'order-1');

    expect(result).toEqual({ status: 'NOT_ELIGIBLE' });
    expect(prismaMock.memberProfile.upsert).not.toHaveBeenCalled();
  });

  it('用户已是 VIP 时幂等返回 ALREADY_VIP', async () => {
    const prismaMock = buildAutoVipPrisma({
      member: {
        userId: 'user-auto',
        tier: 'VIP',
        inviterUserId: 'vip-inviter',
        referralCode: 'VIPCODE1',
        vipPurchasedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
    const service = buildService(prismaMock);

    const result = await service.activateVipByCumulativeSpend('user-auto', 'order-1');

    expect(result).toEqual({ status: 'ALREADY_VIP' });
    expect(prismaMock.vipProgress.upsert).not.toHaveBeenCalled();
  });

  it('并发冲突后重查已是 VIP 时返回 ALREADY_VIP，避免订单侧写入假死信', async () => {
    const prismaMock = buildAutoVipPrisma();
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    prismaMock.memberProfile.findUnique = jest.fn().mockResolvedValue({
      userId: 'user-auto',
      tier: 'VIP',
    });
    const service = buildService(prismaMock);

    const result = await service.activateVipByCumulativeSpend('user-auto', 'order-1');

    expect(result).toEqual({ status: 'ALREADY_VIP' });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.memberProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-auto' },
      select: { tier: true },
    });
  });

  it('达标普通用户升级为 VIP，不创建 VipPurchase/赠品/一次性推荐奖，并冻结普通树', async () => {
    const prismaMock = buildAutoVipPrisma();
    const service = buildService(prismaMock);
    const assignSpy = jest.spyOn(service as any, 'assignVipTreeNode').mockResolvedValue(undefined);
    const grantSpy = jest.spyOn(service as any, 'grantVipReferralBonus').mockResolvedValue(undefined);

    const result = await service.activateVipByCumulativeSpend('user-auto', 'order-1');

    expect(result).toEqual({
      status: 'UPGRADED',
      vipTreeInviterUserId: 'vip-inviter',
    });
    expect(prismaMock.memberProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-auto' },
      create: expect.objectContaining({
        userId: 'user-auto',
        tier: 'VIP',
        referralCode: expect.any(String),
        vipPurchasedAt: expect.any(Date),
      }),
      update: expect.objectContaining({
        tier: 'VIP',
        referralCode: expect.any(String),
        vipPurchasedAt: expect.any(Date),
      }),
    });
    expect(prismaMock.vipProgress.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-auto' },
      create: { userId: 'user-auto' },
      update: {},
    });
    expect(assignSpy).toHaveBeenCalledWith(prismaMock, 'user-auto', 'vip-inviter');
    expect(prismaMock.normalProgress.update).toHaveBeenCalledWith({
      where: { userId: 'user-auto' },
      data: { frozenAt: expect.any(Date) },
    });
    expect(prismaMock.vipPurchase.create).not.toHaveBeenCalled();
    expect(grantSpy).not.toHaveBeenCalled();
  });
});

describe('BonusService.getWallet — 团购返利统一读模型', () => {
  function buildService(prismaMock: any) {
    return new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
    );
  }

  function buildWalletPrisma(isSellerOwner: boolean) {
    return {
      rewardAccount: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'acct-vip', userId: 'user-1', type: 'VIP_REWARD', balance: 10, frozen: 1 },
          { id: 'acct-normal', userId: 'user-1', type: 'NORMAL_REWARD', balance: 20, frozen: 2 },
          { id: 'acct-industry', userId: 'user-1', type: 'INDUSTRY_FUND', balance: 300, frozen: 40 },
        ]),
      },
      companyStaff: {
        findFirst: jest.fn().mockResolvedValue(isSellerOwner ? { id: 'staff-owner' } : null),
      },
      groupBuyRebateAccount: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-1',
          balance: 5,
          reserved: 2,
          withdrawn: 7,
          deducted: 3,
        }),
      },
      groupBuyRebateLedger: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 4 } }),
      },
    };
  }

  it('非卖家 OWNER 的钱包合并 VIP、普通和团购返利，但不暴露产业基金', async () => {
    const prismaMock: any = buildWalletPrisma(false);
    const service = buildService(prismaMock);

    const result = await service.getWallet('user-1');

    expect(result).toEqual({
      balance: 35,
      frozen: 7,
      total: 42,
      deductibleBalance: 35,
      withdrawableBalance: 35,
      isSellerOwner: false,
      vip: { balance: 10, frozen: 1 },
      normal: { balance: 20, frozen: 2 },
      industryFund: null,
      groupBuyRebate: {
        balance: 5,
        pending: 4,
        reserved: 2,
        withdrawn: 7,
        deducted: 3,
        total: 17,
      },
    });
    expect(prismaMock.groupBuyRebateLedger.aggregate).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: 'PENDING_REBATE',
        status: 'PENDING',
        deletedAt: null,
      },
      _sum: { amount: true },
    });
  });

  it('卖家 OWNER 的钱包额外合并并展示产业基金，抵扣余额仍排除产业基金', async () => {
    const prismaMock: any = buildWalletPrisma(true);
    const service = buildService(prismaMock);

    const result = await service.getWallet('user-1');

    expect(result).toMatchObject({
      balance: 335,
      frozen: 47,
      total: 382,
      deductibleBalance: 35,
      withdrawableBalance: 335,
      isSellerOwner: true,
      industryFund: { balance: 300, frozen: 40 },
      groupBuyRebate: {
        balance: 5,
        pending: 4,
        reserved: 2,
        withdrawn: 7,
        deducted: 3,
        total: 17,
      },
    });
    expect(prismaMock.companyStaff.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', role: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
  });
});

describe('BonusService.getWalletLedger — 奖励和团购返利统一流水', () => {
  function buildService(prismaMock: any) {
    return new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
    );
  }

  function rewardLedger(
    id: string,
    accountType: string,
    createdAt: string,
    amount: number,
    overrides: Record<string, any> = {},
  ) {
    return {
      id,
      accountId: `acct-${id}`,
      userId: 'user-1',
      entryType: overrides.entryType ?? 'RELEASE',
      amount,
      status: overrides.status ?? 'AVAILABLE',
      refType: overrides.refType ?? 'ORDER',
      refId: `order-${id}`,
      meta: overrides.meta ?? { accountType },
      createdAt: new Date(createdAt),
      account: { type: accountType },
    };
  }

  function groupBuyLedger(id: string, createdAt: string, amount: number) {
    return {
      id,
      accountId: 'gb-acct',
      userId: 'user-1',
      type: 'RELEASE',
      status: 'AVAILABLE',
      amount,
      balanceBefore: 0,
      balanceAfter: amount,
      refType: 'GROUP_BUY_REFERRAL',
      refId: `ref-${id}`,
      meta: { tierSequence: 1 },
      createdAt: new Date(createdAt),
    };
  }

  function buildLedgerPrisma(isSellerOwner: boolean) {
    const rewardLedgers = [
      rewardLedger('reward-platform-profit', 'PLATFORM_PROFIT', '2026-06-22T13:00:00.000Z', 900),
      rewardLedger('reward-charity', 'CHARITY_FUND', '2026-06-22T12:30:00.000Z', 50),
      rewardLedger('reward-industry', 'INDUSTRY_FUND', '2026-06-22T11:00:00.000Z', 300),
      rewardLedger('reward-normal', 'NORMAL_REWARD', '2026-06-22T10:00:00.000Z', 20),
      rewardLedger('reward-vip', 'VIP_REWARD', '2026-06-22T08:00:00.000Z', 10),
    ];

    const filterRewardLedgers = (where: any) => {
      const allowedTypes = where?.account?.type?.in;
      const filtered = Array.isArray(allowedTypes)
        ? rewardLedgers.filter((ledger) => allowedTypes.includes(ledger.account.type))
        : rewardLedgers;
      return filtered.filter((ledger) => ledger.status !== where?.status?.not && ledger.userId === where?.userId);
    };

    return {
      companyStaff: {
        findFirst: jest.fn().mockResolvedValue(isSellerOwner ? { id: 'staff-owner' } : null),
      },
      rewardLedger: {
        findMany: jest.fn().mockImplementation(({ where, take }) =>
          Promise.resolve(filterRewardLedgers(where).slice(0, take)),
        ),
        count: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(filterRewardLedgers(where).length),
        ),
      },
      groupBuyRebateLedger: {
        findMany: jest.fn().mockResolvedValue([
          groupBuyLedger('gb-new', '2026-06-22T12:00:00.000Z', 5),
          groupBuyLedger('gb-mid', '2026-06-22T09:00:00.000Z', 4),
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
    };
  }

  it('非卖家 OWNER 合并奖励和团购返利后按时间倒序分页，并隐藏产业基金流水', async () => {
    const prismaMock: any = buildLedgerPrisma(false);
    const service = buildService(prismaMock);

    const result = await service.getWalletLedger('user-1', 2, 2);

    expect(result).toEqual({
      items: [
        {
          id: 'gb-mid',
          sourceLedgerId: 'gb-mid',
          source: 'GROUP_BUY_REBATE',
          accountType: 'GROUP_BUY_REBATE',
          type: 'RELEASE',
          entryType: 'RELEASE',
          status: 'AVAILABLE',
          amount: 4,
          balanceAfter: 4,
          refType: 'GROUP_BUY_REFERRAL',
          refId: 'ref-gb-mid',
          meta: { tierSequence: 1 },
          createdAt: '2026-06-22T09:00:00.000Z',
        },
        {
          id: 'reward-vip',
          sourceLedgerId: 'reward-vip',
          source: 'REWARD',
          accountType: 'VIP_REWARD',
          type: 'RELEASE',
          entryType: 'RELEASE',
          status: 'AVAILABLE',
          amount: 10,
          refType: 'ORDER',
          refId: 'order-reward-vip',
          meta: { accountType: 'VIP_REWARD' },
          createdAt: '2026-06-22T08:00:00.000Z',
        },
      ],
      nextPage: undefined,
    });
    const allowedAccountTypes = ['VIP_REWARD', 'NORMAL_REWARD'];
    expect(prismaMock.rewardLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          account: { type: { in: allowedAccountTypes } },
        }),
      }),
    );
    expect(prismaMock.rewardLedger.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        account: { type: { in: allowedAccountTypes } },
      }),
    });
  });

  it('卖家 OWNER 只看到允许的 Reward 账户类型，包含产业基金但排除平台内部账户', async () => {
    const prismaMock: any = buildLedgerPrisma(true);
    const service = buildService(prismaMock);

    const result = await service.getWalletLedger('user-1', 1, 3);

    expect(result.items.map((item: any) => item.id)).toEqual([
      'gb-new',
      'reward-industry',
      'reward-normal',
    ]);
    expect(result.items[1]).toMatchObject({
      id: 'reward-industry',
      source: 'REWARD',
      accountType: 'INDUSTRY_FUND',
      amount: 300,
    });
    expect(result.nextPage).toBe(2);
    expect(result.items.map((item: any) => item.id)).not.toContain('reward-platform-profit');
    expect(result.items.map((item: any) => item.id)).not.toContain('reward-charity');

    const allowedAccountTypes = ['VIP_REWARD', 'NORMAL_REWARD', 'INDUSTRY_FUND'];
    expect(prismaMock.rewardLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          account: { type: { in: allowedAccountTypes } },
        }),
      }),
    );
    expect(prismaMock.rewardLedger.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        account: { type: { in: allowedAccountTypes } },
      }),
    });
  });

  it('钱包流水单独展示 VIP 直推佣金 scheme，避免混入 VIP 推荐奖励或上溯分润', async () => {
    const rewardLedgers = [
      rewardLedger('reward-normal-direct', 'NORMAL_REWARD', '2026-06-22T12:40:00.000Z', 3, {
        refType: 'ORDER',
        meta: { scheme: 'NORMAL_DIRECT_REFERRAL', accountType: 'NORMAL_REWARD' },
      }),
      rewardLedger('reward-normal-direct-void', 'NORMAL_REWARD', '2026-06-22T12:35:00.000Z', 3, {
        refType: 'AFTER_SALE',
        meta: { scheme: 'NORMAL_DIRECT_REFERRAL_VOID', accountType: 'NORMAL_REWARD' },
      }),
      rewardLedger('reward-vip-direct-void', 'VIP_REWARD', '2026-06-22T12:30:00.000Z', 12, {
        refType: 'AFTER_SALE',
        meta: { scheme: 'VIP_DIRECT_REFERRAL_VOID', accountType: 'VIP_REWARD' },
      }),
      rewardLedger('reward-direct', 'VIP_REWARD', '2026-06-22T12:20:00.000Z', 12, {
        refType: 'ORDER',
        meta: { scheme: 'VIP_DIRECT_REFERRAL', accountType: 'VIP_REWARD' },
      }),
      rewardLedger('reward-upstream', 'VIP_REWARD', '2026-06-22T12:10:00.000Z', 8, {
        refType: 'ORDER',
        meta: { scheme: 'VIP_UPSTREAM', accountType: 'VIP_REWARD' },
      }),
      rewardLedger('reward-referral', 'VIP_REWARD', '2026-06-22T12:00:00.000Z', 5, {
        refType: 'VIP_REFERRAL',
        meta: { scheme: 'VIP_REFERRAL', accountType: 'VIP_REWARD' },
      }),
    ];
    const prismaMock: any = {
      companyStaff: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue(rewardLedgers),
        count: jest.fn().mockResolvedValue(rewardLedgers.length),
      },
      groupBuyRebateLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = buildService(prismaMock);

    const result = await service.getWalletLedger('user-1', 1, 20);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'reward-normal-direct',
        scheme: 'NORMAL_DIRECT_REFERRAL',
        sourceLabel: '普通直推佣金',
      }),
      expect.objectContaining({
        id: 'reward-normal-direct-void',
        scheme: 'NORMAL_DIRECT_REFERRAL_VOID',
        sourceLabel: '普通直推佣金作废',
      }),
      expect.objectContaining({
        id: 'reward-vip-direct-void',
        scheme: 'VIP_DIRECT_REFERRAL_VOID',
        sourceLabel: 'VIP 直推佣金作废',
      }),
      expect.objectContaining({
        id: 'reward-direct',
        refType: 'ORDER',
        scheme: 'VIP_DIRECT_REFERRAL',
        sourceLabel: 'VIP 直推佣金',
      }),
      expect.objectContaining({
        id: 'reward-upstream',
        refType: 'ORDER',
        scheme: 'VIP_UPSTREAM',
        sourceLabel: 'VIP 上溯分润',
      }),
      expect.objectContaining({
        id: 'reward-referral',
        refType: 'VIP_REFERRAL',
        scheme: 'VIP_REFERRAL',
        sourceLabel: 'VIP 推荐奖励',
      }),
    ]);
  });

  it('未知 scheme 钱包流水不输出 sourceLabel，避免覆盖 App 提现或抵扣标题', async () => {
    const rewardLedgers = [
      rewardLedger('reward-withdraw', 'VIP_REWARD', '2026-06-22T12:20:00.000Z', -12, {
        entryType: 'WITHDRAW',
        refType: 'WITHDRAW',
        meta: { scheme: 'POINTS_WITHDRAW', accountType: 'VIP_REWARD' },
      }),
      rewardLedger('reward-deduct', 'VIP_REWARD', '2026-06-22T12:10:00.000Z', -8, {
        entryType: 'DEDUCT',
        refType: 'ORDER',
        meta: { scheme: 'POINTS_DEDUCTION', accountType: 'VIP_REWARD' },
      }),
    ];
    const prismaMock: any = {
      companyStaff: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue(rewardLedgers),
        count: jest.fn().mockResolvedValue(rewardLedgers.length),
      },
      groupBuyRebateLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = buildService(prismaMock);

    const result = await service.getWalletLedger('user-1', 1, 20);

    expect(result.items[0]).toMatchObject({
      id: 'reward-withdraw',
      scheme: 'POINTS_WITHDRAW',
    });
    expect(result.items[0]).not.toHaveProperty('sourceLabel');
    expect(result.items[1]).toMatchObject({
      id: 'reward-deduct',
      scheme: 'POINTS_DEDUCTION',
    });
    expect(result.items[1]).not.toHaveProperty('sourceLabel');
  });

  it('对非法页码和过大 pageSize 做夹紧后再查询并计算 nextPage', async () => {
    const prismaMock: any = buildLedgerPrisma(false);
    const service = buildService(prismaMock);

    const result = await service.getWalletLedger('user-1', -5, 200);

    expect(prismaMock.rewardLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
      }),
    );
    expect(prismaMock.groupBuyRebateLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
      }),
    );
    expect(result.items).toHaveLength(4);
    expect(result.nextPage).toBeUndefined();
  });

  it('对小于 1 的 pageSize 夹紧为 1', async () => {
    const prismaMock: any = buildLedgerPrisma(false);
    const service = buildService(prismaMock);

    const result = await service.getWalletLedger('user-1', 0, 0);

    expect(prismaMock.rewardLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
      }),
    );
    expect(prismaMock.groupBuyRebateLedger.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1,
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.nextPage).toBe(2);
  });
});

describe('BonusService.assignVipTreeNode — VIP 推荐人子树落位', () => {
  function buildService(prismaMock: any = {}) {
    return new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
    );
  }

  function makeVipTreeTx(nodes: Record<string, any>) {
    const memberByUserId: Record<string, any> = {
      inviter: {
        userId: 'inviter',
        tier: 'VIP',
        vipNodeId: 'node-inviter',
      },
      invitee: {
        userId: 'invitee',
        tier: 'NORMAL',
        inviterUserId: 'inviter',
      },
    };

    return {
      memberProfile: {
        findUnique: jest.fn(({ where }) => memberByUserId[where.userId] ?? null),
        update: jest.fn(({ where, data }) => {
          memberByUserId[where.userId] = {
            ...(memberByUserId[where.userId] ?? { userId: where.userId }),
            ...data,
          };
          return memberByUserId[where.userId];
        }),
      },
      vipTreeNode: {
        findUnique: jest.fn(({ where }) => nodes[where.id] ?? null),
        findMany: jest.fn(({ where }) => {
          const parentIds = Array.isArray(where.parentId?.in)
            ? where.parentId.in
            : [where.parentId];
          return Object.values(nodes)
            .filter((node: any) => parentIds.includes(node.parentId))
            .sort((a: any, b: any) => a.position - b.position);
        }),
        update: jest.fn(({ where, data }) => {
          const node = nodes[where.id];
          node.childrenCount += data.childrenCount.increment;
          return { ...node };
        }),
        create: jest.fn(({ data }) => {
          const id = 'node-new';
          nodes[id] = { id, childrenCount: 0, createdAt: new Date(), ...data };
          return nodes[id];
        }),
      },
    };
  }

  function node(id: string, parentId: string | null, position: number, childrenCount: number, level = 1) {
    return {
      id,
      rootId: 'A1',
      userId: id.replace('node-', ''),
      parentId,
      level,
      position,
      childrenCount,
      createdAt: new Date(`2026-01-01T00:00:${String(position).padStart(2, '0')}Z`),
    };
  }

  it('推荐人直连已满时，第一层选择 childrenCount 最小的节点承接新人', async () => {
    const nodes = {
      'node-inviter': node('node-inviter', null, 0, 3, 1),
      'node-c0': node('node-c0', 'node-inviter', 0, 2, 2),
      'node-c1': node('node-c1', 'node-inviter', 1, 0, 2),
      'node-c2': node('node-c2', 'node-inviter', 2, 1, 2),
    };
    const tx = makeVipTreeTx(nodes);
    const service = buildService();

    await (service as any).assignVipTreeNode(tx, 'invitee', 'inviter');

    expect(tx.vipTreeNode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'invitee',
        parentId: 'node-c1',
        position: 0,
      }),
    });
  });

  it('当前层全部满时，进入下一层并在整层选择 childrenCount 最小的节点', async () => {
    const nodes = {
      'node-inviter': node('node-inviter', null, 0, 3, 1),
      'node-c0': node('node-c0', 'node-inviter', 0, 3, 2),
      'node-c1': node('node-c1', 'node-inviter', 1, 3, 2),
      'node-c2': node('node-c2', 'node-inviter', 2, 3, 2),
      'node-c0-0': node('node-c0-0', 'node-c0', 0, 2, 3),
      'node-c0-1': node('node-c0-1', 'node-c0', 1, 2, 3),
      'node-c0-2': node('node-c0-2', 'node-c0', 2, 2, 3),
      'node-c1-0': node('node-c1-0', 'node-c1', 0, 0, 3),
      'node-c1-1': node('node-c1-1', 'node-c1', 1, 1, 3),
      'node-c1-2': node('node-c1-2', 'node-c1', 2, 1, 3),
      'node-c2-0': node('node-c2-0', 'node-c2', 0, 1, 3),
      'node-c2-1': node('node-c2-1', 'node-c2', 1, 1, 3),
      'node-c2-2': node('node-c2-2', 'node-c2', 2, 1, 3),
    };
    const tx = makeVipTreeTx(nodes);
    const service = buildService();

    await (service as any).assignVipTreeNode(tx, 'invitee', 'inviter');

    expect(tx.vipTreeNode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'invitee',
        parentId: 'node-c1-0',
        position: 0,
      }),
    });
  });

  it('同层节点一样空时，按树顺序选择最靠前的节点', async () => {
    const nodes = {
      'node-inviter': node('node-inviter', null, 0, 3, 1),
      'node-c0': node('node-c0', 'node-inviter', 0, 1, 2),
      'node-c1': node('node-c1', 'node-inviter', 1, 1, 2),
      'node-c2': node('node-c2', 'node-inviter', 2, 1, 2),
    };
    const tx = makeVipTreeTx(nodes);
    const service = buildService();

    await (service as any).assignVipTreeNode(tx, 'invitee', 'inviter');

    expect(tx.vipTreeNode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'invitee',
        parentId: 'node-c0',
        position: 1,
      }),
    });
  });

  it('显式传入 null 时走系统节点，不读取 MemberProfile.inviterUserId 作为 VIP 推荐人', async () => {
    const nodes = {
      'node-system-root': {
        id: 'node-system-root',
        rootId: 'A1',
        userId: null,
        parentId: null,
        level: 0,
        position: 0,
        childrenCount: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    };
    const tx = makeVipTreeTx(nodes);
    (tx.vipTreeNode as any).findFirst = jest.fn().mockResolvedValue(nodes['node-system-root']);
    const service = buildService();

    await (service as any).assignVipTreeNode(tx, 'invitee', null);

    expect(tx.memberProfile.findUnique).not.toHaveBeenCalledWith({
      where: { userId: 'inviter' },
    });
    expect(tx.vipTreeNode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'invitee',
        parentId: 'node-system-root',
        position: 0,
      }),
    });
  });
});

/**
 * 账号注销 Task 4：已注销 / 非正常状态的 VIP 推荐人不能再被新用户绑定。
 * 历史推荐树/链路保留不动，仅让推荐码对"新绑定"失效。
 */
describe('BonusService.useReferralCode — 已注销推荐人防护', () => {
  function makeTxRunner(prismaMock: any) {
    return async (cb: any) => cb(prismaMock);
  }

  function buildBindingMock(inviterUser: any) {
    const prismaMock: any = {
      memberProfile: {
        findUnique: jest
          .fn()
          // 1. service 入口查 inviter（VIP）
          .mockResolvedValueOnce({
            userId: 'vip-inviter',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          })
          // 2. 事务内查 currentMember（被推荐人当前状态）
          .mockResolvedValueOnce({
            userId: 'invitee-z',
            tier: 'NORMAL',
          })
          // 3. 事务内重新查 inviter（防 TOCTOU）
          .mockResolvedValueOnce({
            userId: 'vip-inviter',
            referralCode: 'VIPCODE1',
            tier: 'VIP',
          }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      normalShareBinding: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        // 事务内校验推荐人 User 状态
        findUnique: jest.fn().mockResolvedValue(inviterUser),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    return prismaMock;
  }

  function buildService(prismaMock: any) {
    return new BonusService(
      prismaMock,
      { getConfig: jest.fn() } as any,
      { handleTrigger: jest.fn() } as any,
      {} as any,
    );
  }

  it('推荐人已注销（deletionExecutedAt 非空）时拒绝绑定，且不写入推荐链路', async () => {
    const prismaMock = buildBindingMock({
      status: 'DELETED',
      deletionExecutedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    const service = buildService(prismaMock);

    await expect(
      service.useReferralCode('invitee-z', 'VIPCODE1'),
    ).rejects.toThrow('推荐人账号不可用');

    expect(prismaMock.referralLink.create).not.toHaveBeenCalled();
    expect(prismaMock.referralLink.update).not.toHaveBeenCalled();
    expect(prismaMock.memberProfile.upsert).not.toHaveBeenCalled();
  });

  it('推荐人状态非 ACTIVE（如 BANNED）时拒绝绑定', async () => {
    const prismaMock = buildBindingMock({
      status: 'BANNED',
      deletionExecutedAt: null,
    });
    const service = buildService(prismaMock);

    await expect(
      service.useReferralCode('invitee-z', 'VIPCODE1'),
    ).rejects.toThrow('推荐人账号不可用');

    expect(prismaMock.referralLink.create).not.toHaveBeenCalled();
  });

  it('已注销推荐人冻结状态仅作用于新绑定，不触碰其历史下级树节点', async () => {
    const prismaMock = buildBindingMock({
      status: 'DELETED',
      deletionExecutedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    // 注入会被误改的"历史树节点"操作 mock，断言它们从未被调用
    prismaMock.vipTreeNode = {
      delete: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    prismaMock.normalTreeNode = {
      delete: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const service = buildService(prismaMock);

    await expect(
      service.useReferralCode('invitee-z', 'VIPCODE1'),
    ).rejects.toThrow('推荐人账号不可用');

    expect(prismaMock.vipTreeNode.delete).not.toHaveBeenCalled();
    expect(prismaMock.vipTreeNode.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.vipTreeNode.update).not.toHaveBeenCalled();
    expect(prismaMock.vipTreeNode.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.normalTreeNode.delete).not.toHaveBeenCalled();
    expect(prismaMock.normalTreeNode.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.normalTreeNode.update).not.toHaveBeenCalled();
    expect(prismaMock.normalTreeNode.updateMany).not.toHaveBeenCalled();
  });
});
