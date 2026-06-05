import { Prisma } from '@prisma/client';
import { BonusService } from './bonus.service';
import { PLATFORM_USER_ID } from './engine/constants';

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
      },
      vipProgress: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = buildService(prismaMock);

    const result = await service.getMemberProfile('vip-user');

    expect(result.referralCode).toBe('VIPCODE1');
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
    const inboxService = {} as any;
    return new BonusService(
      prismaMock,
      bonusConfig,
      couponEngine,
      inboxService,
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
          }),
        // pickUniqueReferralCode 内部用 findFirst 检查冲突
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
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

  it('历史推荐人已注销时，VIP 直推奖励归平台且不写入推荐人账户', async () => {
    const ledgerCreateMock = jest.fn().mockResolvedValue({});
    const accountUpdateMock = jest.fn().mockResolvedValue({});
    const prismaMock: any = {
      vipPurchase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'vp-deleted-inviter',
            userId: 'invitee-deleted-inviter',
            orderId: 'order-deleted-inviter',
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
        findUnique: jest.fn().mockResolvedValue({
          userId: 'invitee-deleted-inviter',
          tier: 'NORMAL',
          inviterUserId: 'inviter-deleted',
          referralCode: null,
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          userId: 'invitee-deleted-inviter',
          tier: 'VIP',
          inviterUserId: 'inviter-deleted',
          referralCode: 'NEWVIP01',
        }),
      },
      vipProgress: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'DELETED',
          deletionExecutedAt: new Date('2026-06-01T00:00:00.000Z'),
        }),
      },
      rewardAccount: {
        upsert: jest.fn().mockResolvedValue({ id: 'acct-inviter-deleted' }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'acct-platform-profit' }),
        update: accountUpdateMock,
      },
      rewardLedger: {
        create: ledgerCreateMock,
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(makeTxRunner(prismaMock));
    const inboxService = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new BonusService(
      prismaMock,
      { getConfig: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      inboxService as any,
    );
    jest.spyOn(service as any, 'assignVipTreeNode').mockResolvedValue(undefined);

    await service.activateVipAfterPayment(
      'invitee-deleted-inviter',
      'order-deleted-inviter',
      'gift-1',
      400,
      { title: 'VIP 礼包' },
      'pkg-1',
      0.15,
    );

    expect(ledgerCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'acct-platform-profit',
        userId: PLATFORM_USER_ID,
        entryType: 'RELEASE',
        amount: 60,
        status: 'AVAILABLE',
        refType: 'VIP_REFERRAL',
        refId: 'vp-deleted-inviter',
        meta: expect.objectContaining({
          scheme: 'VIP_REFERRAL_FALLBACK',
          reason: 'DELETED_DIRECT_REFERRAL_RECIPIENT',
          sourceUserId: 'invitee-deleted-inviter',
          skippedInviterUserId: 'inviter-deleted',
        }),
      }),
    });
    expect(ledgerCreateMock).not.toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'inviter-deleted',
        refType: 'VIP_REFERRAL',
      }),
    });
    expect(accountUpdateMock).toHaveBeenCalledWith({
      where: { id: 'acct-platform-profit' },
      data: { balance: { increment: 60 } },
    });
    expect(inboxService.send).not.toHaveBeenCalled();
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

    await (service as any).assignVipTreeNode(tx, 'invitee');

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

    await (service as any).assignVipTreeNode(tx, 'invitee');

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

    await (service as any).assignVipTreeNode(tx, 'invitee');

    expect(tx.vipTreeNode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'invitee',
        parentId: 'node-c0',
        position: 1,
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
          }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      referralLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
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
