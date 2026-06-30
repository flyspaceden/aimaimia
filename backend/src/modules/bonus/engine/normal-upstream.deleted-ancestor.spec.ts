import { NormalUpstreamService } from './normal-upstream.service';
import { BonusConfig } from './bonus-config.service';
import { PLATFORM_USER_ID } from './constants';

/**
 * Task 5（账号注销）：普通树分润上溯遇到已注销祖辈节点的资金安全。
 *
 * 验证点：
 * 1. 已注销祖辈不产生新的 RewardLedger 入账行、其 RewardAccount 余额保持为 0
 * 2. 被跳过的份额在平台留存路径（PLATFORM_PROFIT / NORMAL_TREE_FALLBACK）上可审计且金额正确
 * 3. 守恒：rewardPool 全额进入平台路径
 */
describe('NormalUpstreamService.distribute 已注销祖辈份额归平台', () => {
  const REWARD_POOL = 32;
  const ORDER_AMOUNT = 200;
  const BUYER_ID = 'buyer-1';
  const ANCESTOR_ID = 'deleted-ancestor';
  const ALLOCATION_ID = 'alloc-1';
  const ORDER_ID = 'order-1';

  const config = {
    normalMaxLayers: 15,
    normalFreezeDays: 7,
    normalBranchFactor: 3,
  } as unknown as BonusConfig;

  function makeTx(ancestorUser: { status: string; deletionExecutedAt: Date | null }) {
    const ledgerCreates: any[] = [];
    const accountUpdates: any[] = [];

    const tx = {
      normalEligibleOrder: {
        count: jest.fn().mockResolvedValue(0), // prevCount=0 → k=1
        create: jest.fn().mockResolvedValue({}),
      },
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue({ selfPurchaseCount: 0 }),
        update: jest.fn().mockResolvedValue({ selfPurchaseCount: 1 }),
      },
      // memberProfile.findUnique 被调用两次：
      //  1) findKthAncestor 取买家 normalTreeNodeId
      //  2) 6b 取祖先 tier
      memberProfile: {
        findUnique: jest.fn().mockImplementation(({ where, select }: any) => {
          if (where?.userId === BUYER_ID) {
            return Promise.resolve({ normalTreeNodeId: 'buyer-node' });
          }
          if (where?.userId === ANCESTOR_ID) {
            return Promise.resolve({ tier: 'NORMAL' });
          }
          return Promise.resolve(null);
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'ancestor-node', userId: ANCESTOR_ID, level: 1 },
      ]),
      user: {
        findUnique: jest.fn().mockResolvedValue(ancestorUser),
      },
      rewardAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: `acct-${data.userId}-${data.type}`, ...data, balance: 0, frozen: 0 }),
        ),
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
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    return { tx, ledgerCreates, accountUpdates };
  }

  const makeNotificationService = () => ({
    send: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  });

  const makeService = (notificationService = makeNotificationService()) =>
    new NormalUpstreamService(notificationService as any);

  it('祖先已注销（deletionExecutedAt 非空）→ 不给祖先入账，份额全额归平台且可审计', async () => {
    const service = makeService();
    const { tx, ledgerCreates, accountUpdates } = makeTx({
      status: 'ACTIVE', // 即便 status 还是 ACTIVE，只要 deletionExecutedAt 非空也必须跳过
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

    expect(res.result).toBe('no_ancestor');
    expect(res.ancestorUserId).toBeNull();

    const ancestorLedgers = ledgerCreates.filter((l) => l.userId === ANCESTOR_ID);
    expect(ancestorLedgers).toHaveLength(0);

    const platformLedgers = ledgerCreates.filter((l) => l.userId === PLATFORM_USER_ID);
    expect(platformLedgers).toHaveLength(1);
    expect(platformLedgers[0].amount).toBe(REWARD_POOL);
    expect(platformLedgers[0].status).toBe('AVAILABLE');
    expect(platformLedgers[0].meta.reason).toBe('DELETED_UPSTREAM_RECIPIENT');

    const totalCredited = ledgerCreates.reduce((s, l) => s + l.amount, 0);
    expect(totalCredited).toBe(REWARD_POOL);

    const platformBalanceInc = accountUpdates
      .filter((u) => u.data?.balance?.increment != null)
      .reduce((s, u) => s + u.data.balance.increment, 0);
    expect(platformBalanceInc).toBe(REWARD_POOL);
  });

  it('祖先 DELETED → 同样归平台', async () => {
    const service = makeService();
    const { tx, ledgerCreates } = makeTx({ status: 'DELETED', deletionExecutedAt: null });

    const res = await service.distribute(
      tx as any,
      ALLOCATION_ID,
      ORDER_ID,
      BUYER_ID,
      ORDER_AMOUNT,
      REWARD_POOL,
      config,
    );

    expect(res.result).toBe('no_ancestor');
    const platformLedgers = ledgerCreates.filter((l) => l.userId === PLATFORM_USER_ID);
    expect(platformLedgers).toHaveLength(1);
    expect(platformLedgers[0].amount).toBe(REWARD_POOL);
    expect(ledgerCreates.filter((l) => l.userId === ANCESTOR_ID)).toHaveLength(0);
  });

  it('祖先 ACTIVE 且未注销 → 正常给祖先入账（对照组）', async () => {
    const notificationService = makeNotificationService();
    const service = makeService(notificationService);
    const { tx, ledgerCreates } = makeTx({ status: 'ACTIVE', deletionExecutedAt: null });
    tx.normalProgress.findUnique.mockImplementation(({ where }: any) => {
      if (where?.userId === ANCESTOR_ID) return Promise.resolve({ selfPurchaseCount: 1 });
      return Promise.resolve({ selfPurchaseCount: 0 });
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

    expect(res.result).toBe('distributed');
    expect(res.ancestorUserId).toBe(ANCESTOR_ID);
    expect(ledgerCreates.filter((l) => l.userId === ANCESTOR_ID)).toHaveLength(1);
    expect(ledgerCreates.filter((l) => l.userId === PLATFORM_USER_ID)).toHaveLength(0);

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

  it('释放普通树冻结奖励时在事务内发出 reward.unfrozen 通知', async () => {
    const notificationService = makeNotificationService();
    const service = makeService(notificationService);
    const tx: any = {
      rewardLedger: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ledger-freeze-b', amount: 7, meta: { scheme: 'NORMAL_TREE', requiredLevel: 2 } },
          { id: 'ledger-freeze-a', amount: 5, meta: { scheme: 'NORMAL_TREE', requiredLevel: 2 } },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      rewardAccount: {
        findUnique: jest.fn().mockResolvedValue({ id: 'acct-normal' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    await service.unlockFrozenRewards(tx, ANCESTOR_ID, 2);

    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'reward.unfrozen',
      aggregateType: 'rewardLedger',
      aggregateId: 'reward-unfreeze:deleted-ancestor:ledger-freeze-a,ledger-freeze-b',
      idempotencyKey: 'reward:unfrozen:deleted-ancestor:ledger-freeze-a:ledger-freeze-b',
      actor: { kind: 'system' },
      payload: {
        userId: ANCESTOR_ID,
        amount: 12,
      },
    }, tx);
  });
});
