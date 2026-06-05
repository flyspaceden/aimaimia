import { NormalBroadcastService } from './normal-broadcast.service';
import { BonusConfig } from './bonus-config.service';
import { PLATFORM_USER_ID } from './constants';

/**
 * Task 5（账号注销）：遗留普通广播路径遇到已注销受益人的资金安全。
 *
 * NORMAL_BROADCAST 仅对迁移日期前的旧订单生效，理论上不再有新订单进入，
 * 但队列里仍可能残留已注销用户，故同样补强：跳过已注销受益人、其份额归平台、守恒。
 */
describe('NormalBroadcastService.distribute 已注销受益人份额归平台', () => {
  const REWARD_POOL = 30;
  const ORDER_AMOUNT = 100;
  const BUYER_ID = 'buyer-1';
  const ALLOCATION_ID = 'alloc-1';
  const ORDER_ID = 'order-1';

  // 3 个受益人，中间一个已注销
  const BEN_ACTIVE_1 = 'ben-active-1';
  const BEN_DELETED = 'ben-deleted';
  const BEN_ACTIVE_2 = 'ben-active-2';

  const config = {
    // bucketRanges: [low, high|null][]，匹配 determineBucketKey 的解构签名
    bucketRanges: [[0, 1000]],
    normalBroadcastX: 3,
    ruleVersion: 'v1',
  } as unknown as BonusConfig;

  function makeTx() {
    const ledgerCreates: any[] = [];
    const accountUpdates: any[] = [];

    const userStatus: Record<string, { status: string; deletionExecutedAt: Date | null }> = {
      [BEN_ACTIVE_1]: { status: 'ACTIVE', deletionExecutedAt: null },
      [BEN_DELETED]: { status: 'DELETED', deletionExecutedAt: new Date('2026-06-01T00:00:00Z') },
      [BEN_ACTIVE_2]: { status: 'ACTIVE', deletionExecutedAt: null },
    };

    const tx = {
      // findOrCreateBucket 用的是 normalBucket 模型
      normalBucket: {
        findUnique: jest.fn().mockResolvedValue({ id: 'bucket-1', bucketKey: '0-1000' }),
        create: jest.fn().mockResolvedValue({ id: 'bucket-1', bucketKey: '0-1000' }),
      },
      normalQueueMember: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'qm-buyer', joinedAt: new Date('2026-06-02T00:00:00Z') }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'qm-1', userId: BEN_ACTIVE_1, orderId: 'o-1' },
          { id: 'qm-2', userId: BEN_DELETED, orderId: 'o-2' },
          { id: 'qm-3', userId: BEN_ACTIVE_2, orderId: 'o-3' },
        ]),
      },
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(userStatus[where.id] ?? null),
        ),
      },
      rewardAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: `acct-${data.userId}-${data.type}`, ...data, balance: 0 }),
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
      },
      memberProfile: {
        upsert: jest.fn().mockResolvedValue({}),
        // pickUniqueReferralCode 在 upsert.create 分支会查重推荐码
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    return { tx, ledgerCreates, accountUpdates };
  }

  it('已注销受益人被跳过，其份额归平台，三人份额守恒 = rewardPool', async () => {
    const service = new NormalBroadcastService();
    const { tx, ledgerCreates, accountUpdates } = makeTx();

    const total = await service.distribute(
      tx as any,
      ALLOCATION_ID,
      ORDER_ID,
      BUYER_ID,
      ORDER_AMOUNT,
      REWARD_POOL,
      config,
    );

    // 已注销受益人无入账
    expect(ledgerCreates.filter((l) => l.userId === BEN_DELETED)).toHaveLength(0);
    // 两位活跃受益人各 1 笔
    expect(ledgerCreates.filter((l) => l.userId === BEN_ACTIVE_1)).toHaveLength(1);
    expect(ledgerCreates.filter((l) => l.userId === BEN_ACTIVE_2)).toHaveLength(1);
    // 平台拿到被跳过的那一份，reason 可审计
    const platformLedgers = ledgerCreates.filter((l) => l.userId === PLATFORM_USER_ID);
    expect(platformLedgers).toHaveLength(1);
    expect(platformLedgers[0].meta.reason).toBe('DELETED_UPSTREAM_RECIPIENT');

    // 守恒：所有 ledger 金额之和（含 totalDistributed 计入的平台份额）= rewardPool
    const totalLedger = ledgerCreates.reduce((s, l) => s + l.amount, 0);
    expect(totalLedger).toBe(REWARD_POOL);
    expect(total).toBe(REWARD_POOL);

    // 没有任何写入已注销用户账户余额
    const updatedAccountIds = accountUpdates.map((u) => u.where?.id);
    expect(updatedAccountIds).not.toContain(`acct-${BEN_DELETED}-NORMAL_REWARD`);
  });
});
