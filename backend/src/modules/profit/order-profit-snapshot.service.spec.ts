import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from '../captain/captain.constants';
import { resolveOrCreateNormalTreeNode } from './normal-tree-resolver';
import { OrderProfitSnapshotService } from './order-profit-snapshot.service';

const RATE_ROWS = [
  ['VIP_PLATFORM_PERCENT', 0.45],
  ['VIP_REWARD_PERCENT', 0.25],
  ['VIP_DIRECT_REFERRAL_PERCENT', 0.04],
  ['VIP_INDUSTRY_FUND_PERCENT', 0.1],
  ['VIP_CHARITY_PERCENT', 0.05],
  ['VIP_TECH_PERCENT', 0.05],
  ['VIP_RESERVE_PERCENT', 0.06],
  ['VIP_MAX_LAYERS', 15],
  ['NORMAL_PLATFORM_PERCENT', 0.45],
  ['NORMAL_REWARD_PERCENT', 0.2],
  ['NORMAL_DIRECT_REFERRAL_PERCENT', 0.03],
  ['NORMAL_INDUSTRY_FUND_PERCENT', 0.12],
  ['NORMAL_CHARITY_PERCENT', 0.08],
  ['NORMAL_TECH_PERCENT', 0.08],
  ['NORMAL_RESERVE_PERCENT', 0.04],
  ['NORMAL_MAX_LAYERS', 15],
  ['NORMAL_BRANCH_FACTOR', 3],
] as const;

const captainConfig = {
  ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
  enabled: true,
  effectiveFrom: '2026-06-30T16:00:00.000Z',
  scope: {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
    productIds: ['product-1'],
  },
  perOrderCommission: { directProfitRate: 0.08 },
  caps: {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.caps,
    maxTotalIncentiveProfitRate: 0.08,
  },
};

function makeOrder(overrides: any = {}) {
  return {
    id: 'order-1',
    userId: 'buyer-1',
    bizType: 'NORMAL_GOODS',
    goodsAmount: 135,
    shippingFee: 8,
    vipDiscountAmount: 6.75,
    totalCouponDiscount: 10,
    discountAmount: 5,
    groupBuyRebateDeductionAmount: 0,
    paidAt: new Date('2026-07-10T00:00:00.000Z'),
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    user: {
      memberProfile: {
        tier: 'VIP',
        inviterUserId: 'inviter-1',
        vipNodeId: null,
        normalTreeNodeId: null,
      },
    },
    items: [
      {
        id: 'item-1',
        unitPrice: 135,
        quantity: 1,
        companyId: 'company-1',
        isPrize: false,
        sku: {
          cost: 100,
          product: {
            id: 'product-1',
            categoryId: 'category-1',
            companyId: 'company-1',
          },
        },
      },
      {
        id: 'prize-1',
        unitPrice: 999,
        quantity: 1,
        companyId: 'company-1',
        isPrize: true,
        sku: {
          cost: 0,
          product: {
            id: 'prize-product',
            categoryId: 'category-1',
            companyId: 'company-1',
          },
        },
      },
    ],
    ...overrides,
  };
}

function makeTx(order = makeOrder()) {
  const ruleRows = RATE_ROWS.map(([key, value]) => ({
    key,
    value: { value },
    updatedAt: new Date('2026-07-09T00:00:00.000Z'),
  }));
  ruleRows.push({
    key: 'CAPTAIN_SEAFOOD_CONFIG',
    value: { value: captainConfig },
    updatedAt: new Date('2026-07-09T12:00:00.000Z'),
  } as any);

  const createdSnapshots: any[] = [];
  const tx: any = {
    orderProfitSnapshot: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: any) => {
        const snapshot = { id: 'snapshot-1', ...data };
        createdSnapshots.push(snapshot);
        return snapshot;
      }),
    },
    orderProfitReconciliationTask: {
      upsert: jest.fn().mockResolvedValue({ id: 'reconciliation-1' }),
    },
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    ruleConfig: { findMany: jest.fn().mockResolvedValue(ruleRows) },
    ruleVersion: {
      findFirst: jest.fn().mockResolvedValue({
        version: 'rules-v3',
        isComplete: true,
        safetySummary: { valid: true },
      }),
    },
    normalShareBinding: { findUnique: jest.fn().mockResolvedValue(null) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'inviter-1',
        status: 'ACTIVE',
        deletionExecutedAt: null,
        memberProfile: { tier: 'VIP', referralCode: 'VIP-CODE' },
      }),
    },
    vipTreeNode: { findUnique: jest.fn().mockResolvedValue(null) },
    captainRelation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'captain-relation-1',
        buyerUserId: 'buyer-1',
        directCaptainUserId: 'captain-1',
        status: 'ACTIVE',
        source: 'CAPTAIN_CODE',
        codeUsed: 'CAPTAIN-1',
      }),
    },
    captainProfile: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 'captain-1',
        status: 'ACTIVE',
        programCode: 'SEAFOOD_PREPACKAGED',
      }),
    },
  };
  return { tx, createdSnapshots };
}

describe('OrderProfitSnapshotService', () => {
  const service = new OrderProfitSnapshotService();

  it('persists the golden discounted profit and complete payment-time rule facts from tx', async () => {
    const { tx } = makeTx();

    const snapshot = await service.createForPaidOrder(tx, 'order-1');

    expect(snapshot).toMatchObject({
      status: 'READY',
      grossGoodsAmount: 135,
      shippingAmount: 8,
      vipDiscountAmount: 6.75,
      couponDiscountAmount: 10,
      rewardDeductionAmount: 5,
      productCostAmount: 100,
      netGoodsRevenue: 113.25,
      distributableProfitAmount: 13.25,
      captainEligibleProfitAmount: 13.25,
    });
    const data = tx.orderProfitSnapshot.create.mock.calls[0][0].data;
    expect(data.itemBreakdown).toEqual([
      expect.objectContaining({
        orderItemId: 'item-1',
        unitCostCents: 10_000,
        distributableProfitShareCents: 1_325,
      }),
    ]);
    expect(data.ruleSnapshot).toMatchObject({
      buyerPath: 'VIP',
      vipNormalConfigVersion: 'rules-v3',
      validatedSafetyVersion: 'rules-v3',
      directInviter: {
        userId: 'inviter-1',
        tier: 'VIP',
        status: 'ACTIVE',
        effectiveDirectRate: 0.04,
      },
      captain: {
        relationId: 'captain-relation-1',
        directCaptainUserId: 'captain-1',
        profileStatus: 'ACTIVE',
        configVersion: '2026-07-09T12:00:00.000Z',
      },
      rates: {
        vip: {
          platform: 0.45,
          reward: 0.25,
          directReferral: 0.04,
          industryFund: 0.1,
          charity: 0.05,
          tech: 0.05,
          reserve: 0.06,
        },
        normal: {
          platform: 0.45,
          reward: 0.2,
          directReferral: 0.03,
          industryFund: 0.12,
          charity: 0.08,
          tech: 0.08,
          reserve: 0.04,
        },
      },
    });
    expect(tx.ruleConfig.findMany).toHaveBeenCalledTimes(1);
    expect(tx.normalShareBinding.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.captainRelation.findUnique).toHaveBeenCalledTimes(1);
  });

  it('creates one pending reconciliation task for zero SKU cost without throwing', async () => {
    const order = makeOrder({
      items: [
        {
          ...makeOrder().items[0],
          sku: { ...makeOrder().items[0].sku, cost: 0 },
        },
      ],
    });
    const { tx } = makeTx(order);

    await expect(service.createForPaidOrder(tx, 'order-1')).resolves.toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      errorCode: 'ORDER_PROFIT_COST_MISSING',
      distributableProfitAmount: 0,
      captainEligibleProfitAmount: 0,
    });
    expect(tx.orderProfitReconciliationTask.upsert).toHaveBeenCalledWith({
      where: {
        sourceSnapshotId_orderId: {
          sourceSnapshotId: 'snapshot-1',
          orderId: 'order-1',
        },
      },
      update: {},
      create: expect.objectContaining({
        orderId: 'order-1',
        sourceSnapshotId: 'snapshot-1',
        status: 'PENDING',
        errorCode: 'ORDER_PROFIT_COST_MISSING',
      }),
    });
  });

  it('excludes a positive-price prize from profit gross without creating a false reconciliation', async () => {
    const regularItem = makeOrder().items[0];
    const paidPrize = {
      ...makeOrder().items[1],
      unitPrice: 10,
    };
    const order = makeOrder({
      goodsAmount: 145,
      vipDiscountAmount: 0,
      totalCouponDiscount: 10,
      discountAmount: 0,
      items: [regularItem, paidPrize],
    });
    const { tx } = makeTx(order);

    await expect(service.createForPaidOrder(tx, 'order-1')).resolves.toMatchObject({
      status: 'READY',
      grossGoodsAmount: 135,
      netGoodsRevenue: 125,
      productCostAmount: 100,
      distributableProfitAmount: 25,
    });
    expect(tx.orderProfitReconciliationTask.upsert).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'treats invalid SKU cost %s as reconciliation data instead of failing payment',
    async (cost) => {
      const order = makeOrder({
        items: [
          {
            ...makeOrder().items[0],
            sku: { ...makeOrder().items[0].sku, cost },
          },
        ],
      });
      const { tx } = makeTx(order);

      await expect(service.createForPaidOrder(tx, 'order-1')).resolves.toMatchObject({
        status: 'RECONCILIATION_REQUIRED',
        errorCode: 'ORDER_PROFIT_COST_MISSING',
      });
    },
  );

  it.each([
    ['goodsAmount', Number.NaN],
    ['vipDiscountAmount', Number.POSITIVE_INFINITY],
    ['totalCouponDiscount', Number.NEGATIVE_INFINITY],
    ['discountAmount', Number.MAX_SAFE_INTEGER],
    ['groupBuyRebateDeductionAmount', Number.MAX_SAFE_INTEGER],
  ])(
    'turns invalid top-level %s into reconciliation instead of throwing',
    async (field, value) => {
      const { tx } = makeTx(makeOrder({ [field]: value }));

      await expect(service.createForPaidOrder(tx, 'order-1')).resolves.toMatchObject({
        status: 'RECONCILIATION_REQUIRED',
        errorCode: 'ORDER_PROFIT_CONSERVATION_FAILED',
      });
      expect(tx.orderProfitReconciliationTask.upsert).toHaveBeenCalledTimes(1);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'turns invalid order-item unit price %s into reconciliation instead of throwing',
    async (unitPrice) => {
      const order = makeOrder({
        goodsAmount: 135,
        items: [{ ...makeOrder().items[0], unitPrice }],
      });
      const { tx } = makeTx(order);

      await expect(service.createForPaidOrder(tx, 'order-1')).resolves.toMatchObject({
        status: 'RECONCILIATION_REQUIRED',
        errorCode: 'ORDER_PROFIT_CONSERVATION_FAILED',
      });
      expect(tx.orderProfitReconciliationTask.upsert).toHaveBeenCalledTimes(1);
    },
  );

  it('returns the current snapshot on a duplicate callback without creating revision 2', async () => {
    const { tx } = makeTx();
    const existing = { id: 'snapshot-existing', orderId: 'order-1', revision: 1, isCurrent: true };
    tx.orderProfitSnapshot.findFirst.mockResolvedValue(existing);

    await expect(service.createForPaidOrder(tx, 'order-1')).resolves.toBe(existing);

    expect(tx.order.findUnique).not.toHaveBeenCalled();
    expect(tx.orderProfitSnapshot.create).not.toHaveBeenCalled();
    expect(tx.orderProfitReconciliationTask.upsert).not.toHaveBeenCalled();
  });

  it('omits a direct captain when the buyer is the captain', async () => {
    const { tx } = makeTx();
    tx.captainRelation.findUnique.mockResolvedValue({
      id: 'self-relation',
      buyerUserId: 'buyer-1',
      directCaptainUserId: 'buyer-1',
      status: 'ACTIVE',
      source: 'CAPTAIN_CODE',
      codeUsed: 'SELF',
    });

    await service.createForPaidOrder(tx, 'order-1');

    const captain = tx.orderProfitSnapshot.create.mock.calls[0][0].data.ruleSnapshot.captain;
    expect(captain).toMatchObject({
      relationId: 'self-relation',
      directCaptainUserId: null,
      exclusionReason: 'SELF_CAPTAIN',
    });
    expect(tx.captainProfile.findUnique).not.toHaveBeenCalled();
  });
});

describe('resolveOrCreateNormalTreeNode concurrency', () => {
  it('uses an unlocked fast path when the buyer already has a valid tree node', async () => {
    const existingNode = {
      id: 'existing-node',
      rootId: 'NORMAL_ROOT',
      userId: 'normal-buyer',
      parentId: 'parent-1',
      level: 2,
      position: 1,
    };
    const tx: any = {
      $executeRawUnsafe: jest.fn(),
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'normal-buyer',
          treeNodeId: existingNode.id,
        }),
      },
      normalTreeNode: {
        findUnique: jest.fn().mockResolvedValue(existingNode),
      },
    };

    await expect(resolveOrCreateNormalTreeNode(tx, 'normal-buyer', 3))
      .resolves.toBe(existingNode);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('serializes two first-payment attempts and converges on one user node', async () => {
    const root = {
      id: 'normal-root',
      rootId: 'NORMAL_ROOT',
      userId: null,
      parentId: null,
      level: 0,
      position: 0,
      childrenCount: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const nodes = [root];
    let progress: any = null;
    let lockTail = Promise.resolve();
    let nodeCreates = 0;

    const runTransaction = async () => {
      let releaseLock: (() => void) | undefined;
      const tx: any = {
        $executeRawUnsafe: jest.fn(async () => {
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => { releaseLock = resolve; });
          await previous;
        }),
        normalProgress: {
          findUnique: jest.fn(async () => progress),
          upsert: jest.fn(async () => {
            progress ??= { userId: 'normal-buyer', treeNodeId: null };
            return progress;
          }),
          update: jest.fn(async ({ data }: any) => {
            progress = { ...progress, ...data };
            return progress;
          }),
        },
        normalTreeNode: {
          findUnique: jest.fn(async ({ where }: any) => {
            if (where.userId) return nodes.find((node) => node.userId === where.userId) ?? null;
            return nodes.find((node) => node.id === where.id) ?? null;
          }),
          findFirst: jest.fn(async ({ where }: any) =>
            nodes.find((node) => node.rootId === where.rootId && node.level === where.level) ?? null),
          findMany: jest.fn(async ({ where }: any) => {
            if (where.parentId?.in) {
              return nodes
                .filter((node) => where.parentId.in.includes(node.parentId) && node.level === where.level)
                .map((node) => ({ parentId: node.parentId, position: node.position }));
            }
            return nodes
              .filter((node) => node.rootId === where.rootId && node.level === where.level)
              .map((node) => ({ id: node.id, parentId: node.parentId, userId: node.userId, level: node.level }));
          }),
          create: jest.fn(async ({ data }: any) => {
            nodeCreates += 1;
            const node = {
              id: `node-${nodeCreates}`,
              childrenCount: 0,
              createdAt: new Date(),
              ...data,
            };
            nodes.push(node);
            return node;
          }),
          update: jest.fn(async ({ where, data }: any) => {
            const node = nodes.find((entry) => entry.id === where.id)!;
            if (data.childrenCount?.increment) node.childrenCount += data.childrenCount.increment;
            return node;
          }),
        },
        memberProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };

      try {
        return await resolveOrCreateNormalTreeNode(tx, 'normal-buyer', 3);
      } finally {
        releaseLock?.();
      }
    };

    const [first, second] = await Promise.all([runTransaction(), runTransaction()]);

    expect(first.id).toBe(second.id);
    expect(nodes.filter((node) => node.userId === 'normal-buyer')).toHaveLength(1);
    expect(nodeCreates).toBe(1);
    expect(progress.treeNodeId).toBe(first.id);
  });

  it('places a new buyer under the least occupied parent after taking the lock', async () => {
    const root = { id: 'root', rootId: 'NORMAL_ROOT', userId: null, parentId: null, level: 0, position: 0 };
    const parentA = { id: 'parent-a', rootId: 'NORMAL_ROOT', userId: 'a', parentId: 'root', level: 1, position: 0 };
    const parentB = { id: 'parent-b', rootId: 'NORMAL_ROOT', userId: 'b', parentId: 'root', level: 1, position: 1 };
    const parentC = { id: 'parent-c', rootId: 'NORMAL_ROOT', userId: 'c', parentId: 'root', level: 1, position: 2 };
    const children = [
      { id: 'a-0', rootId: 'NORMAL_ROOT', userId: 'a0', parentId: 'parent-a', level: 2, position: 0 },
      { id: 'a-1', rootId: 'NORMAL_ROOT', userId: 'a1', parentId: 'parent-a', level: 2, position: 1 },
    ];
    const nodes: any[] = [root, parentA, parentB, parentC, ...children];
    let createdData: any;
    const tx: any = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      normalProgress: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ userId: 'new-buyer', treeNodeId: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      normalTreeNode: {
        findUnique: jest.fn(async ({ where }: any) =>
          nodes.find((node) => node.id === where.id || node.userId === where.userId) ?? null),
        findFirst: jest.fn().mockResolvedValue(root),
        findMany: jest.fn(async ({ where }: any) => {
          if (where.parentId?.in) {
            return nodes
              .filter((node) => where.parentId.in.includes(node.parentId) && node.level === where.level)
              .map((node) => ({ parentId: node.parentId, position: node.position }));
          }
          return nodes
            .filter((node) => node.rootId === where.rootId && node.level === where.level)
            .map((node) => ({ id: node.id }));
        }),
        create: jest.fn(async ({ data }: any) => {
          createdData = data;
          return { id: 'new-node', childrenCount: 0, createdAt: new Date(), ...data };
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      memberProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    await resolveOrCreateNormalTreeNode(tx, 'new-buyer', 3);

    expect(createdData).toMatchObject({ parentId: 'parent-b', level: 2, position: 0 });
    expect(tx.normalProgress.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.normalProgress.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$executeRawUnsafe.mock.invocationCallOrder[0],
    );
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      tx.normalProgress.findUnique.mock.invocationCallOrder[1],
    );
  });
});
