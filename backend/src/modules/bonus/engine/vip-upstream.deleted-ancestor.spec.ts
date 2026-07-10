import { VipUpstreamService } from './vip-upstream.service';
import { BonusConfig } from './bonus-config.service';
import { PLATFORM_USER_ID } from './constants';

/**
 * Task 5（账号注销）：VIP 分润上溯遇到已注销祖辈节点的资金安全。
 *
 * 验证点：
 * 1. 已注销祖辈不产生新的 RewardLedger 入账行、其 RewardAccount 余额保持为 0
 * 2. 被跳过的份额在平台留存路径（PLATFORM_PROFIT / *_FALLBACK）上可审计且金额正确
 * 3. 守恒：rewardPool 全额进入平台路径，不凭空消失、不重复计入
 */
describe('VipUpstreamService.distribute 已注销祖辈份额归平台', () => {
  const REWARD_POOL = 50;
  const ORDER_AMOUNT = 200;
  const BUYER_ID = 'buyer-1';
  const ANCESTOR_ID = 'deleted-ancestor';
  const ALLOCATION_ID = 'alloc-1';
  const ORDER_ID = 'order-1';

  const config = {
    vipMaxLayers: 15,
    vipFreezeDays: 7,
    vipBranchFactor: 3,
  } as unknown as BonusConfig;

  /**
   * 构造一个事务 mock：
   * - 第 k 个祖先 = 已注销 ANCESTOR_ID（status=DELETED, deletionExecutedAt 非空）
   * - 记录所有对 rewardLedger.create / rewardAccount.update 的调用，便于断言
   */
  function makeTx(ancestorUser: { status: string; deletionExecutedAt: Date | null }) {
    const ledgerCreates: any[] = [];
    const accountUpdates: any[] = [];
    const accountCreates: any[] = [];

    const tx = {
      // 有效消费计数
      vipEligibleOrder: {
        count: jest.fn().mockResolvedValue(0), // prevCount=0 → k=1
        create: jest.fn().mockResolvedValue({}),
      },
      vipProgress: {
        findUnique: jest.fn().mockResolvedValue({ selfPurchaseCount: 0 }),
        update: jest.fn().mockResolvedValue({ selfPurchaseCount: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // findKthAncestor：买家 vipNodeId
      memberProfile: {
        findUnique: jest.fn().mockResolvedValue({ vipNodeId: 'buyer-node' }),
      },
      // 递归 CTE：返回第 k 个祖先（真实用户节点，userId 非空）
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'ancestor-node', userId: ANCESTOR_ID, level: 1 },
      ]),
      // resolveActiveRewardRecipient 读取祖先 User 状态
      user: {
        findUnique: jest.fn().mockResolvedValue(ancestorUser),
      },
      // 平台 / 祖先 RewardAccount
      rewardAccount: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          // 平台账户：首次不存在，触发 create
          if (where?.userId_type?.userId === PLATFORM_USER_ID) return Promise.resolve(null);
          return Promise.resolve(null);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const acc = { id: `acct-${data.userId}-${data.type}`, ...data, balance: 0, frozen: 0 };
          accountCreates.push(acc);
          return Promise.resolve(acc);
        }),
        update: jest.fn().mockImplementation((args: any) => {
          accountUpdates.push(args);
          return Promise.resolve({});
        }),
      },
      rewardLedger: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          ledgerCreates.push(data);
          return Promise.resolve({ id: `ledger-${ledgerCreates.length}`, ...data });
        }),
        findMany: jest.fn().mockResolvedValue([]), // unlockFrozenRewards 无冻结
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    return { tx, ledgerCreates, accountUpdates, accountCreates };
  }

  const makeNotificationService = () => ({
    send: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  });

  const makeService = (notificationService = makeNotificationService()) =>
    new VipUpstreamService({} as any, notificationService as any);

  it('祖先已注销（DELETED）→ 不给祖先入账，份额全额归平台且可审计', async () => {
    const service = makeService();
    const { tx, ledgerCreates, accountUpdates } = makeTx({
      status: 'DELETED',
      deletionExecutedAt: new Date('2026-06-01T00:00:00Z'),
    });

    const res = await service.distribute(
      tx as any,
      ALLOCATION_ID,
      ORDER_ID,
      BUYER_ID,
      ORDER_AMOUNT,
      REWARD_POOL,
      config,
    );

    // 返回视为无有效祖先
    expect(res.result).toBe('no_ancestor');
    expect(res.ancestorUserId).toBeNull();

    // 不给已注销祖先创建任何 ledger / 更新其账户
    const ancestorLedgers = ledgerCreates.filter((l) => l.userId === ANCESTOR_ID);
    expect(ancestorLedgers).toHaveLength(0);

    // 平台 fallback ledger 存在、金额正确、reason 可审计
    const platformLedgers = ledgerCreates.filter((l) => l.userId === PLATFORM_USER_ID);
    expect(platformLedgers).toHaveLength(1);
    expect(platformLedgers[0].amount).toBe(REWARD_POOL);
    expect(platformLedgers[0].status).toBe('AVAILABLE');
    expect(platformLedgers[0].meta.reason).toBe('DELETED_UPSTREAM_RECIPIENT');
    expect(platformLedgers[0].meta.skippedAncestorUserId).toBe(ANCESTOR_ID);

    // 守恒：所有入账金额之和 = rewardPool（无重复、无丢失）
    const totalCredited = ledgerCreates.reduce((s, l) => s + l.amount, 0);
    expect(totalCredited).toBe(REWARD_POOL);

    // 平台账户余额加了 rewardPool；没有任何对祖先账户的余额变更
    const platformBalanceInc = accountUpdates
      .filter((u) => u.data?.balance?.increment != null)
      .reduce((s, u) => s + u.data.balance.increment, 0);
    expect(platformBalanceInc).toBe(REWARD_POOL);
  });

  it('祖先 ACTIVE 且未注销 → 正常给祖先入账（对照组，确认 helper 不误伤）', async () => {
    const notificationService = makeNotificationService();
    const service = makeService(notificationService);
    const { tx, ledgerCreates } = makeTx({ status: 'ACTIVE', deletionExecutedAt: null });
    tx.vipProgress.findUnique.mockResolvedValue({ selfPurchaseCount: 1 });

    const res = await service.distribute(
      tx as any,
      ALLOCATION_ID,
      ORDER_ID,
      BUYER_ID,
      ORDER_AMOUNT,
      REWARD_POOL,
      config,
    );

    expect(res.result).toBe('distributed');
    expect(res.ancestorUserId).toBe(ANCESTOR_ID);

    // 祖先拿到入账，平台 fallback 不应出现
    const ancestorLedgers = ledgerCreates.filter((l) => l.userId === ANCESTOR_ID);
    expect(ancestorLedgers).toHaveLength(1);
    expect(ancestorLedgers[0].amount).toBe(REWARD_POOL);
    const platformLedgers = ledgerCreates.filter((l) => l.userId === PLATFORM_USER_ID);
    expect(platformLedgers).toHaveLength(0);

    // 守恒
    const totalCredited = ledgerCreates.reduce((s, l) => s + l.amount, 0);
    expect(totalCredited).toBe(REWARD_POOL);
    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'reward.credited',
      aggregateType: 'rewardLedger',
      aggregateId: 'ledger-1',
      idempotencyKey: 'reward:ledger-1:credited',
      actor: { kind: 'system' },
      payload: {
        ledgerId: 'ledger-1',
        userId: ANCESTOR_ID,
        amount: REWARD_POOL,
      },
    }, tx);
  });

  it('快照路径使用支付时 VIP 祖先且不查询当前树', async () => {
    const service = makeService();
    const { tx, ledgerCreates } = makeTx({ status: 'ACTIVE', deletionExecutedAt: null });
    tx.vipProgress.findUnique.mockResolvedValue({ selfPurchaseCount: 1 });

    const res = await service.distribute(
      tx as any,
      ALLOCATION_ID,
      ORDER_ID,
      BUYER_ID,
      ORDER_AMOUNT,
      REWARD_POOL,
      null,
      {
        buyerPath: 'VIP',
        ancestors: [{ depth: 1, nodeId: 'snapshot-vip-node', userId: ANCESTOR_ID, level: 9 }],
      },
    );

    expect(res).toEqual({ result: 'distributed', ancestorUserId: ANCESTOR_ID });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.memberProfile.findUnique).not.toHaveBeenCalled();
    expect(ledgerCreates[0]).toEqual(expect.objectContaining({
      userId: ANCESTOR_ID,
      meta: expect.objectContaining({ ancestorNodeId: 'snapshot-vip-node', ancestorLevel: 9 }),
    }));
  });

  it('释放 VIP 冻结奖励时在事务内发出 reward.unfrozen 通知', async () => {
    const notificationService = makeNotificationService();
    const service = makeService(notificationService);
    const tx: any = {
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ledger-vip-freeze-1', amount: 9, meta: { scheme: 'VIP_UPSTREAM', requiredLevel: 3 } },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rewardAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: 'acct-vip' }),
        update: jest.fn().mockResolvedValue({}),
      },
      vipProgress: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await service.unlockFrozenRewards(tx, ANCESTOR_ID, 3);

    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'reward.unfrozen',
      aggregateType: 'rewardLedger',
      aggregateId: 'ledger-vip-freeze-1',
      idempotencyKey: 'reward:ledger-vip-freeze-1:unfrozen',
      actor: { kind: 'system' },
      payload: {
        userId: ANCESTOR_ID,
        amount: 9,
      },
    }, tx);
  });
});
