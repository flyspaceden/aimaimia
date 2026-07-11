import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from './captain.constants';
import { CaptainMonthlySettlementService } from './captain-monthly-settlement.service';

function makeV2Config(enabled = true) {
  return {
    schemaVersion: 2,
    enabled,
    programCode: 'SEAFOOD_PREPACKAGED',
  };
}

function makeV3Config(overrides: any = {}) {
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    enabled: true,
    effectiveFrom: '2026-05-31T16:00:00.000Z',
    monthlyQualification: {
      minDirectEffectiveBuyers: 1,
      minDirectMonthlyGmv: 8000,
      minNewEffectiveBuyers: 1,
    },
    monthlyRewards: {
      baseTierGmv: 25000,
      baseManagementProfitRate: 0.02,
      growthTierGmv: 70000,
      growthBonusProfitRate: 0.005,
      excellentTierGmv: 140000,
      cultivationBonusProfitRate: 0.004,
      performanceBonusProfitRate: 0.01,
    },
    tax: {
      enabled: false,
      withholdingRate: 0.2,
      incomeType: 'LABOR_SERVICE',
    },
    risk: {
      maxMonthlyRefundRate: 0.15,
      holdSettlementOnRisk: true,
    },
    ...overrides,
  };
}

function makeAttribution(overrides: any = {}) {
  const config = overrides.configSnapshot ?? makeV3Config();
  const id = overrides.id ?? 'attr-1';
  const orderId = overrides.orderId ?? `order-${id}`;
  const reserve = overrides.reserve ?? 50;
  const createdAt = overrides.createdAt ?? new Date('2026-06-15T00:00:00.000Z');
  const paidAt = overrides.paidAt ?? createdAt;
  return {
    id,
    orderId,
    buyerUserId: overrides.buyerUserId ?? 'buyer-1',
    directCaptainUserId: overrides.directCaptainUserId ?? 'captain-1',
    programCode: 'SEAFOOD_PREPACKAGED',
    eligibleGoodsAmount: overrides.eligibleGoodsAmount ?? 25000,
    refundAmount: overrides.refundAmount ?? 0,
    calculationModel: 'PROFIT_V3',
    profitSnapshotId: overrides.profitSnapshotId ?? `snapshot-${id}`,
    profitConfigVersion: overrides.profitConfigVersion ?? `config-${id}`,
    profitBaseAmount: overrides.profitBaseAmount ?? 1000,
    configSnapshot: config,
    status: overrides.status ?? 'FROZEN',
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    order: { paidAt },
    meta: {
      monthlyMaximum: reserve,
      ...(overrides.meta ?? {}),
    },
    profitSnapshot: {
      fundingLedgers: overrides.fundingLedgers ?? (reserve > 0
        ? [{
          id: `hold-${id}`,
          type: 'CAPTAIN_MONTHLY_HOLD',
          amount: -reserve,
        }]
        : []),
    },
  };
}

function createHarness(options: {
  config?: any;
  attributions?: any[];
  relations?: any[];
  unresolvedOrderIds?: string[];
  unattributedReconciliations?: Array<{
    id: string;
    orderId: string;
    directCaptainUserId: string;
    paidAt: Date;
    status?: string;
  }>;
  pendingAdjustments?: Array<{
    id: string;
    orderId: string;
    directCaptainUserId: string;
    paidAt: Date;
    status?: string;
  }>;
} = {}) {
  const config = options.config ?? makeV3Config();
  const attributions = options.attributions ?? [];
  const relations = options.relations ?? [{
    buyerUserId: 'buyer-1',
    directCaptainUserId: 'captain-1',
    boundAt: new Date('2026-06-01T00:00:00.000Z'),
  }];
  const reconciliationTasks = [
    ...(options.unresolvedOrderIds ?? []).map((orderId) => {
      const attribution = attributions.find((item) => item.orderId === orderId);
      return {
        id: `reconciliation-${orderId}`,
        orderId,
        directCaptainUserId: attribution?.directCaptainUserId ?? 'captain-1',
        paidAt: attribution?.createdAt ?? new Date('2026-06-15T00:00:00.000Z'),
        status: 'PENDING',
      };
    }),
    ...(options.unattributedReconciliations ?? []).map((task) => ({
      ...task,
      status: task.status ?? 'PENDING',
    })),
  ];
  const adjustmentDrafts = (options.pendingAdjustments ?? []).map((draft) => ({
    ...draft,
    status: draft.status ?? 'PENDING',
  }));
  const settlements: any[] = [];
  const settlementOrders: any[] = [];
  const fundingLedgers: any[] = [];
  const createdLedgers: any[] = [];
  const metrics: any[] = [];

  const tx: any = {
    captainProfile: { findMany: jest.fn() },
    captainOrderAttribution: {
      findMany: jest.fn(async ({ where, distinct }: any = {}) => {
        const rows = attributions.filter((item) => {
          if (where?.directCaptainUserId && item.directCaptainUserId !== where.directCaptainUserId) return false;
          if (where?.programCode && item.programCode !== where.programCode) return false;
          if (where?.calculationModel && item.calculationModel !== where.calculationModel) return false;
          if (where?.createdAt?.gte && item.createdAt < where.createdAt.gte) return false;
          if (where?.createdAt?.lt && item.createdAt >= where.createdAt.lt) return false;
          const paidAt = item.order?.paidAt;
          if (where?.order?.paidAt?.gte && paidAt < where.order.paidAt.gte) return false;
          if (where?.order?.paidAt?.lt && paidAt >= where.order.paidAt.lt) return false;
          return true;
        });
        if (distinct?.includes('directCaptainUserId')) {
          return [...new Map(rows.map((item) => [item.directCaptainUserId, {
            directCaptainUserId: item.directCaptainUserId,
          }])).values()];
        }
        return rows;
      }),
    },
    captainRelation: {
      findMany: jest.fn(async ({ where }: any) => relations.filter(
        (item) => item.directCaptainUserId === where.directCaptainUserId,
      )),
    },
    captainMonthlyMetric: {
      upsert: jest.fn(async ({ create, update, where }: any) => {
        const key = where.captainUserId_month_programCode;
        const existing = metrics.find((item) =>
          item.captainUserId === key.captainUserId
          && item.month === key.month
          && item.programCode === key.programCode);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `metric-${metrics.length + 1}`, ...create };
        metrics.push(row);
        return row;
      }),
    },
    captainMonthlySettlement: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return settlements.find((item) => item.id === where.id) ?? null;
        const key = where.captainUserId_month_programCode;
        return settlements.find((item) =>
          item.captainUserId === key.captainUserId
          && item.month === key.month
          && item.programCode === key.programCode) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `settlement-${settlements.length + 1}`, ...data };
        settlements.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = settlements.find((item) => item.id === where.id);
        if (!row) return { id: where.id, ...data };
        Object.assign(row, data);
        return row;
      }),
    },
    captainMonthlySettlementOrder: {
      findMany: jest.fn(async ({ where }: any) => settlementOrders.filter(
        (item) => item.settlementId === where.settlementId,
      ).map((item) => ({
        ...item,
        orderAttribution: attributions.find((attr) => attr.id === item.orderAttributionId),
      }))),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = settlementOrders.find(
          (item) => item.orderAttributionId === where.orderAttributionId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `settlement-order-${settlementOrders.length + 1}`, ...create };
        settlementOrders.push(row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const kept = settlementOrders.filter((item) => item.settlementId !== where.settlementId);
        const count = settlementOrders.length - kept.length;
        settlementOrders.splice(0, settlementOrders.length, ...kept);
        return { count };
      }),
    },
    orderProfitFundingLedger: {
      findUnique: jest.fn(async ({ where }: any) => fundingLedgers.find(
        (item) => item.idempotencyKey === where.idempotencyKey,
      ) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = where.idempotencyKey;
        const existing = fundingLedgers.find((item) => item.idempotencyKey === key);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `funding-${fundingLedgers.length + 1}`, ...create };
        fundingLedgers.push(row);
        return row;
      }),
    },
    orderProfitReconciliationTask: {
      findFirst: jest.fn(async ({ where }: any) => {
        const captainFilter = where.sourceSnapshot?.ruleSnapshot;
        const paidAtFilter = where.order?.paidAt;
        return reconciliationTasks.find((task) => (
          task.status === where.status
          && captainFilter?.path?.join('.') === 'captain.directCaptainUserId'
          && task.directCaptainUserId === captainFilter.equals
          && task.paidAt >= paidAtFilter.gte
          && task.paidAt < paidAtFilter.lt
        )) ?? null;
      }),
    },
    orderProfitAdjustmentDraft: {
      findFirst: jest.fn(async ({ where }: any) => {
        const captainFilter = where.targetSnapshot?.ruleSnapshot;
        const paidAtFilter = where.order?.paidAt;
        return adjustmentDrafts.find((draft) => (
          draft.status === where.status
          && captainFilter?.path?.join('.') === 'captain.directCaptainUserId'
          && draft.directCaptainUserId === captainFilter.equals
          && draft.paidAt >= paidAtFilter.gte
          && draft.paidAt < paidAtFilter.lt
        )) ?? null;
      }),
    },
    captainAccount: {
      upsert: jest.fn(async ({ where }: any) => ({
        id: `account-${where.userId_programCode.userId}`,
        userId: where.userId_programCode.userId,
        balance: 0,
      })),
      findUnique: jest.fn().mockResolvedValue({ id: 'account-captain-1', balance: 1000 }),
      update: jest.fn(),
    },
    captainCommissionLedger: {
      findUnique: jest.fn(async ({ where }: any) => createdLedgers.find(
        (item) => item.idempotencyKey === where.idempotencyKey,
      ) ?? null),
      findMany: jest.fn(async ({ where }: any) => createdLedgers.filter(
        (item) => item.settlementId === where.settlementId && item.status === where.status,
      )),
      create: jest.fn(async ({ data }: any) => {
        if (createdLedgers.some((item) => item.idempotencyKey === data.idempotencyKey)) {
          const error: any = new Error('duplicate');
          error.code = 'P2002';
          throw error;
        }
        const row = { id: `ledger-${createdLedgers.length + 1}`, ...data };
        createdLedgers.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = createdLedgers.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        for (const ledger of createdLedgers) {
          if (ledger.settlementId === where.settlementId && ledger.status === where.status) {
            Object.assign(ledger, data);
          }
        }
        return { count: createdLedgers.length };
      }),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    captainMonthlySettlement: tx.captainMonthlySettlement,
  };
  const configService = {
    getSnapshot: jest.fn().mockResolvedValue(config),
  };

  return {
    tx,
    prisma,
    configService,
    settlements,
    settlementOrders,
    fundingLedgers,
    createdLedgers,
    metrics,
    reconciliationTasks,
    adjustmentDrafts,
    service: new CaptainMonthlySettlementService(prisma),
  };
}

describe('CaptainMonthlySettlementService V3 monthly profit settlement', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    [8000, 0, 0, 'QUALIFIED'],
    [25000, 30, 20, 'BASE'],
    [70000, 35, 20, 'GROWTH'],
    [140000, 39, 20, 'EXCELLENT'],
  ])(
    'uses whole-month GMV %d for cumulative tiers and produces %d reward',
    async (eligibleGoodsAmount, expectedTotal, expectedManagement, expectedTier) => {
      const attribution = makeAttribution({ eligibleGoodsAmount, reserve: 50 });
      const harness = createHarness({ attributions: [attribution] });

      const [settlement] = await harness.service.createDraftSettlements('2026-06');

      expect(settlement).toEqual(expect.objectContaining({
        totalAmount: expectedTotal,
        baseManagementAmount: expectedManagement,
      }));
      expect(harness.metrics[0]).toEqual(expect.objectContaining({
        personalGmv: eligibleGoodsAmount,
        qualified: true,
        qualifiedTier: expectedTier,
      }));
      expect(harness.settlementOrders).toHaveLength(1);
    },
  );

  it('lets a zero-profit attribution contribute GMV and buyer facts without a reward or reserve', async () => {
    const attribution = makeAttribution({
      eligibleGoodsAmount: 25000,
      profitBaseAmount: 0,
      reserve: 0,
    });
    const harness = createHarness({ attributions: [attribution] });

    const [settlement] = await harness.service.createDraftSettlements('2026-06');

    expect(harness.metrics[0]).toEqual(expect.objectContaining({
      personalGmv: 25000,
      directEffectiveBuyers: 1,
      newEffectiveMembers: 1,
    }));
    expect(settlement.totalAmount).toBe(0);
    expect(harness.settlementOrders[0]).toEqual(expect.objectContaining({
      profitBaseAmount: 0,
      reservedAmount: 0,
      releasedAmount: 0,
    }));
  });

  it('shares one month fact set while applying each order config snapshot and version', async () => {
    const configA = makeV3Config();
    const configB = makeV3Config({
      monthlyRewards: {
        ...makeV3Config().monthlyRewards,
        baseManagementProfitRate: 0.01,
        growthTierGmv: 100000,
        growthBonusProfitRate: 0.02,
      },
    });
    const harness = createHarness({
      attributions: [
        makeAttribution({
          id: 'attr-a',
          buyerUserId: 'buyer-1',
          eligibleGoodsAmount: 40000,
          profitBaseAmount: 100,
          reserve: 10,
          configSnapshot: configA,
          profitConfigVersion: 'config-a',
        }),
        makeAttribution({
          id: 'attr-b',
          buyerUserId: 'buyer-2',
          eligibleGoodsAmount: 40000,
          profitBaseAmount: 100,
          reserve: 10,
          configSnapshot: configB,
          profitConfigVersion: 'config-b',
        }),
      ],
      relations: [
        { buyerUserId: 'buyer-1', directCaptainUserId: 'captain-1', boundAt: new Date('2026-06-01') },
        { buyerUserId: 'buyer-2', directCaptainUserId: 'captain-1', boundAt: new Date('2026-06-02') },
      ],
    });

    const [settlement] = await harness.service.createDraftSettlements('2026-06');

    expect(harness.metrics[0].personalGmv).toBe(80000);
    expect(settlement.totalAmount).toBe(5.5);
    expect(harness.settlementOrders).toEqual(expect.arrayContaining([
      expect.objectContaining({ configVersion: 'config-a', growthBonusAmount: 0.5 }),
      expect.objectContaining({ configVersion: 'config-b', growthBonusAmount: 0 }),
    ]));
  });

  it('disqualifies the order batch when whole-month refund risk exceeds its snapshot limit', async () => {
    const harness = createHarness({
      attributions: [makeAttribution({
        eligibleGoodsAmount: 25000,
        refundAmount: 5000,
        reserve: 50,
      })],
    });

    const [settlement] = await harness.service.createDraftSettlements('2026-06');

    expect(harness.metrics[0].refundRate).toBe(0.2);
    expect(settlement.totalAmount).toBe(0);
    expect(harness.settlementOrders[0].releasedAmount).toBe(50);
  });

  it('caps actual reward by monthly reserve and releases unused reserve exactly once', async () => {
    const capped = makeAttribution({ id: 'attr-capped', reserve: 7 });
    const unused = makeAttribution({
      id: 'attr-unused',
      buyerUserId: 'buyer-2',
      profitBaseAmount: 100,
      reserve: 10,
    });
    const harness = createHarness({
      attributions: [capped, unused],
      relations: [
        { buyerUserId: 'buyer-1', directCaptainUserId: 'captain-1', boundAt: new Date('2026-06-01') },
        { buyerUserId: 'buyer-2', directCaptainUserId: 'captain-1', boundAt: new Date('2026-06-02') },
      ],
    });

    const [first] = await harness.service.createDraftSettlements('2026-06');
    const [second] = await harness.service.createDraftSettlements('2026-06');

    expect(first.id).toBe(second.id);
    expect(harness.settlementOrders.find((item) => item.orderAttributionId === 'attr-capped'))
      .toEqual(expect.objectContaining({ reservedAmount: 7, releasedAmount: 0 }));
    expect(harness.settlementOrders.find((item) => item.orderAttributionId === 'attr-unused'))
      .toEqual(expect.objectContaining({ reservedAmount: 10, releasedAmount: 7 }));
    expect(harness.fundingLedgers).toEqual([
      expect.objectContaining({ type: 'CAPTAIN_MONTHLY_RELEASE', amount: 7 }),
    ]);
    expect(harness.tx.orderProfitFundingLedger.upsert).toHaveBeenCalledTimes(1);
  });

  it('settles against the signed monthly hold net of refund adjustments', async () => {
    const harness = createHarness({
      attributions: [makeAttribution({
        reserve: 0.02,
        profitBaseAmount: 100,
        fundingLedgers: [
          { id: 'hold-attr-1', type: 'CAPTAIN_MONTHLY_HOLD', amount: -0.02 },
          {
            id: 'refund-hold-1',
            type: 'REFUND_ADJUSTMENT',
            amount: 0.01,
            sourceLedgerId: 'hold-attr-1',
          },
        ],
      })],
    });

    const [settlement] = await harness.service.createDraftSettlements('2026-06');

    expect(harness.settlementOrders[0]).toEqual(expect.objectContaining({
      reservedAmount: 0.01,
      baseManagementAmount: 0.01,
      releasedAmount: 0,
    }));
    expect(settlement.totalAmount).toBe(0.01);
  });

  it('reduces the order profit base in proportion to the remaining refunded C', async () => {
    const harness = createHarness({
      attributions: [makeAttribution({
        profitBaseAmount: 1000,
        reserve: 50,
        fundingLedgers: [
          { id: 'hold-attr-1', type: 'CAPTAIN_MONTHLY_HOLD', amount: -50 },
          {
            id: 'refund-hold-1',
            type: 'REFUND_ADJUSTMENT',
            amount: 25,
            sourceLedgerId: 'hold-attr-1',
          },
        ],
      })],
    });

    const [settlement] = await harness.service.createDraftSettlements('2026-06');

    expect(harness.settlementOrders[0]).toEqual(expect.objectContaining({
      profitBaseAmount: 500,
      reservedAmount: 25,
      baseManagementAmount: 10,
      performanceBonusAmount: 5,
      releasedAmount: 10,
    }));
    expect(settlement.totalAmount).toBe(15);
  });

  it('recalculates an existing monthly release net of its refund adjustment exactly once', async () => {
    const attribution = makeAttribution({
      profitBaseAmount: 100,
      reserve: 10,
      fundingLedgers: [
        { id: 'hold-attr-1', type: 'CAPTAIN_MONTHLY_HOLD', amount: -10 },
        { id: 'refund-hold-1', type: 'REFUND_ADJUSTMENT', amount: 5, sourceLedgerId: 'hold-attr-1' },
        { id: 'release-attr-1', type: 'CAPTAIN_MONTHLY_RELEASE', amount: 7 },
        { id: 'refund-release-1', type: 'REFUND_ADJUSTMENT', amount: -3, sourceLedgerId: 'release-attr-1' },
      ],
    });
    const harness = createHarness({ attributions: [attribution] });
    harness.fundingLedgers.push({
      id: 'release-attr-1',
      snapshotId: 'snapshot-attr-1',
      orderId: 'order-attr-1',
      type: 'CAPTAIN_MONTHLY_RELEASE',
      amount: 7,
      idempotencyKey: 'captain:v3:funding:order-attr-1:monthly-release:attr-1',
    });

    const [settlement] = await harness.service.createDraftSettlements('2026-06');

    expect(settlement.totalAmount).toBe(1.5);
    expect(harness.settlementOrders[0]).toEqual(expect.objectContaining({
      reservedAmount: 5,
      releasedAmount: 3.5,
    }));
    expect(harness.fundingLedgers[0].amount).toBe(6.5);
    expect(-10 + 5 + harness.fundingLedgers[0].amount - 3).toBe(-settlement.totalAmount);
  });

  it('uses Asia/Shanghai natural-month UTC boundaries', async () => {
    const harness = createHarness({ attributions: [makeAttribution()] });

    await harness.service.createDraftSettlements('2026-06');

    expect(harness.tx.captainOrderAttribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: {
            paidAt: {
              gte: new Date('2026-05-31T16:00:00.000Z'),
              lt: new Date('2026-06-30T16:00:00.000Z'),
            },
          },
        }),
      }),
    );
  });

  it('uses order paidAt rather than attribution createdAt for month ownership', async () => {
    const harness = createHarness({
      attributions: [makeAttribution({
        createdAt: new Date('2026-06-30T16:05:00.000Z'),
        paidAt: new Date('2026-06-30T15:59:59.000Z'),
      })],
    });

    const [settlement] = await harness.service.createDraftSettlements('2026-06');

    expect(settlement).toEqual(expect.objectContaining({ totalAmount: 30 }));
    expect(harness.tx.captainOrderAttribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order: {
            paidAt: {
              gte: new Date('2026-05-31T16:00:00.000Z'),
              lt: new Date('2026-06-30T16:00:00.000Z'),
            },
          },
        }),
      }),
    );
  });

  it('rejects draft generation before the Shanghai month closes and allows regeneration after close', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
    const harness = createHarness({
      attributions: [makeAttribution({
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        paidAt: new Date('2026-07-10T00:00:00.000Z'),
      })],
    });

    await expect(harness.service.createDraftSettlements('2026-07'))
      .rejects.toThrow('月份尚未闭合');

    jest.setSystemTime(new Date('2026-07-31T16:00:00.000Z'));
    await expect(harness.service.createDraftSettlements('2026-07'))
      .resolves.toHaveLength(1);
  });

  it('rejects approval of a stale draft and regenerates it from final closed-month facts', async () => {
    const first = makeAttribution({ id: 'attr-first', eligibleGoodsAmount: 25000 });
    const attributions = [first];
    const harness = createHarness({ attributions });
    const [draft] = await harness.service.createDraftSettlements('2026-06');

    attributions.push(makeAttribution({
      id: 'attr-late',
      buyerUserId: 'buyer-2',
      eligibleGoodsAmount: 45000,
      paidAt: new Date('2026-06-30T15:59:59.000Z'),
      createdAt: new Date('2026-06-30T16:05:00.000Z'),
    }));

    await expect(harness.service.approveSettlement(draft.id, 'admin-1'))
      .rejects.toThrow('草稿数据已变化');

    const [regenerated] = await harness.service.createDraftSettlements('2026-06');
    expect(regenerated.id).toBe(draft.id);
    expect(regenerated.meta).toEqual(expect.objectContaining({ orderCount: 2 }));
    expect(harness.settlementOrders).toHaveLength(2);
  });

  it('settles and releases historical V3 attributions after the current config is disabled', async () => {
    const harness = createHarness({
      config: makeV3Config({ enabled: false }),
      attributions: [makeAttribution({ reserve: 50 })],
    });

    const [settlement] = await harness.service.createDraftSettlements('2026-06');

    expect(settlement).toEqual(expect.objectContaining({
      totalAmount: 30,
    }));
    expect(harness.fundingLedgers).toEqual([
      expect.objectContaining({ type: 'CAPTAIN_MONTHLY_RELEASE', amount: 20 }),
    ]);
  });

  it.each(['approve', 'pay'])(
    'blocks %s before the selected month closes in Asia/Shanghai',
    async (action) => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
      const harness = createHarness({
        attributions: [makeAttribution({
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
        })],
      });
      const draft = {
        id: 'open-month-settlement',
        captainUserId: 'captain-1',
        month: '2026-07',
        programCode: 'SEAFOOD_PREPACKAGED',
        status: action === 'pay' ? 'APPROVED' : 'DRAFT',
        configSnapshot: makeV3Config(),
        meta: { calculationModel: 'PROFIT_V3_ORDER_SNAPSHOT' },
      };
      harness.settlements.push(draft);

      const request = action === 'approve'
        ? harness.service.approveSettlement(draft.id, 'admin-1')
        : harness.service.markPaid(draft.id, 'admin-1');

      await expect(request).rejects.toThrow('月份尚未闭合');
    },
  );

  it('recalculates only a mutable V3 draft without duplicating settlement orders or releases', async () => {
    const attribution = makeAttribution({ reserve: 50 });
    const harness = createHarness({ attributions: [attribution] });
    const [draft] = await harness.service.createDraftSettlements('2026-06');
    expect(harness.fundingLedgers[0].amount).toBe(20);

    attribution.eligibleGoodsAmount = 140000;

    const recalculated = await harness.service.recalculateSettlement(draft.id, 'admin-1');

    expect(harness.settlements).toHaveLength(1);
    expect(harness.settlementOrders).toHaveLength(1);
    expect(harness.fundingLedgers).toHaveLength(1);
    expect(recalculated.totalAmount).toBe(39);
    expect(harness.fundingLedgers[0].amount).toBe(11);
  });

  it('creates V3 monthly ledgers once and makes repeat approve/pay calls idempotent', async () => {
    const harness = createHarness({ attributions: [makeAttribution()] });
    const [draft] = await harness.service.createDraftSettlements('2026-06');

    await harness.service.approveSettlement(draft.id, 'admin-1');
    await harness.service.approveSettlement(draft.id, 'admin-1');
    await harness.service.markPaid(draft.id, 'admin-1');
    await harness.service.markPaid(draft.id, 'admin-1');

    expect(harness.createdLedgers.map((item) => item.type)).toEqual([
      'MANAGEMENT_ALLOWANCE',
      'PERFORMANCE_BONUS',
    ]);
    expect(harness.tx.captainAccount.update).toHaveBeenCalledTimes(3);
    expect(harness.settlements[0].status).toBe('PAID');
  });

  it('revises approved monthly ledgers after a refund tier downgrade and allows reapprove and pay', async () => {
    const attribution = makeAttribution({ eligibleGoodsAmount: 140000, reserve: 50 });
    const harness = createHarness({ attributions: [attribution] });
    const [draft] = await harness.service.createDraftSettlements('2026-06');
    await harness.service.approveSettlement(draft.id, 'admin-1');
    expect(draft.totalAmount).toBe(39);

    attribution.refundAmount = 10000;
    attribution.updatedAt = new Date('2026-07-01T00:00:00.000Z');
    draft.status = 'PENDING_REVIEW';

    const recalculated = await harness.service.recalculateSettlement(draft.id, 'admin-2');
    expect(recalculated.totalAmount).toBe(35);
    await harness.service.approveSettlement(draft.id, 'admin-2');

    expect(harness.createdLedgers.find((row) => row.type === 'CULTIVATION_BONUS'))
      .toEqual(expect.objectContaining({ amount: 0, status: 'VOIDED' }));
    expect(harness.tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-captain-1' },
      data: { balance: { decrement: 4 } },
    });

    await expect(harness.service.markPaid(draft.id, 'admin-2'))
      .resolves.toEqual(expect.objectContaining({ status: 'PAID' }));
  });

  it('uses a CLAWBACK_PENDING ledger upgrade to repay only that ledger debt before crediting balance', async () => {
    const harness = createHarness();
    const existing = {
      id: 'monthly-management',
      accountId: 'account-captain-1',
      amount: 10,
      status: 'CLAWBACK_PENDING',
      meta: {
        month: '2026-06',
        sourceCaptainUserId: 'captain-1',
        monthlyClawbackCents: 400,
      },
    };
    harness.tx.captainAccount.findUnique.mockResolvedValue({
      id: 'account-captain-1',
      balance: 0,
      clawback: 10,
    });

    await (harness.service as any).reviseMonthlyLedger(harness.tx, existing, 15);

    expect(harness.tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-captain-1' },
      data: {
        clawback: { decrement: 4 },
        balance: { increment: 1 },
      },
    });
    expect(harness.tx.captainCommissionLedger.update).toHaveBeenCalledWith({
      where: { id: 'monthly-management' },
      data: {
        amount: 15,
        balanceAfter: 1,
        status: 'AVAILABLE',
        meta: expect.objectContaining({ monthlyClawbackCents: 0 }),
      },
    });
  });

  it.each([
    ['reconciliation', { unresolvedOrderIds: ['order-attr-1'] }],
    ['adjustment', {
      pendingAdjustments: [{
        id: 'adjustment-1',
        orderId: 'order-attr-1',
        directCaptainUserId: 'captain-1',
        paidAt: new Date('2026-06-20T08:00:00.000Z'),
      }],
    }],
  ])('blocks draft creation before release writes while a %s is pending', async (_label, pending) => {
    const harness = createHarness({
      attributions: [makeAttribution()],
      ...pending,
    });

    await expect(harness.service.createDraftSettlements('2026-06')).rejects.toThrow();

    expect(harness.tx.captainMonthlyMetric.upsert).not.toHaveBeenCalled();
    expect(harness.tx.captainMonthlySettlement.create).not.toHaveBeenCalled();
    expect(harness.tx.captainMonthlySettlementOrder.upsert).not.toHaveBeenCalled();
    expect(harness.tx.orderProfitFundingLedger.upsert).not.toHaveBeenCalled();
  });

  it.each(['approve', 'pay'])('blocks %s while a settlement order has unresolved reconciliation', async (action) => {
    const harness = createHarness({ attributions: [makeAttribution()] });
    const [draft] = await harness.service.createDraftSettlements('2026-06');
    harness.reconciliationTasks.push({
      id: 'reconciliation-order-attr-1', orderId: 'order-attr-1',
      directCaptainUserId: 'captain-1', paidAt: new Date('2026-06-15T00:00:00.000Z'),
      status: 'PENDING',
    });
    if (action === 'pay') draft.status = 'APPROVED';

    const request = action === 'approve'
      ? harness.service.approveSettlement(draft.id, 'admin-1')
      : harness.service.markPaid(draft.id, 'admin-1');

    await expect(request).rejects.toThrow('对账');
  });

  it.each(['approve', 'pay'])(
    'blocks %s while reconciliation is resolved but its revision adjustment is pending',
    async (action) => {
      const harness = createHarness({ attributions: [makeAttribution()] });
      const [draft] = await harness.service.createDraftSettlements('2026-06');
      harness.adjustmentDrafts.push({
        id: 'adjustment-1', orderId: 'order-attr-1',
        directCaptainUserId: 'captain-1',
        paidAt: new Date('2026-06-20T08:00:00.000Z'), status: 'PENDING',
      });
      if (action === 'pay') draft.status = 'APPROVED';

      const request = action === 'approve'
        ? harness.service.approveSettlement(draft.id, 'admin-1')
        : harness.service.markPaid(draft.id, 'admin-1');

      await expect(request).rejects.toThrow('利润补差');
      expect(harness.tx.orderProfitAdjustmentDraft.findFirst).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          order: {
            paidAt: {
              gte: new Date('2026-05-31T16:00:00.000Z'),
              lt: new Date('2026-06-30T16:00:00.000Z'),
            },
          },
          targetSnapshot: {
            ruleSnapshot: {
              path: ['captain', 'directCaptainUserId'],
              equals: 'captain-1',
            },
          },
        },
        select: { id: true },
      });
    },
  );

  it.each(['approve', 'pay'])(
    'blocks %s for a same-month reconciliation snapshot that never created an attribution',
    async (action) => {
      const harness = createHarness({ attributions: [makeAttribution()] });
      const [draft] = await harness.service.createDraftSettlements('2026-06');
      harness.reconciliationTasks.push({
        id: 'reconciliation-without-attribution', orderId: 'order-without-attribution',
        directCaptainUserId: 'captain-1',
        paidAt: new Date('2026-06-20T08:00:00.000Z'), status: 'PENDING',
      });
      if (action === 'pay') draft.status = 'APPROVED';

      const request = action === 'approve'
        ? harness.service.approveSettlement(draft.id, 'admin-1')
        : harness.service.markPaid(draft.id, 'admin-1');

      await expect(request).rejects.toThrow('对账');
      expect(harness.tx.orderProfitReconciliationTask.findFirst).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          order: {
            paidAt: {
              gte: new Date('2026-05-31T16:00:00.000Z'),
              lt: new Date('2026-06-30T16:00:00.000Z'),
            },
          },
          sourceSnapshot: {
            ruleSnapshot: {
              path: ['captain', 'directCaptainUserId'],
              equals: 'captain-1',
            },
          },
        },
        select: { id: true },
      });
    },
  );
});

describe('CaptainMonthlySettlementService V2 compatibility', () => {
  it.each([
    ['enabled persisted V2', makeV2Config(true)],
    ['disabled persisted V2', makeV2Config(false)],
    ['disabled V3', makeV3Config({ enabled: false })],
  ])('creates no new monthly metrics or drafts for %s', async (_label, config) => {
    const { service, prisma, tx } = createHarness({ config });

    await expect(service.calculateMetrics('2026-06')).resolves.toEqual([]);
    await expect(service.createDraftSettlements('2026-06')).resolves.toEqual([]);

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.captainMonthlyMetric.upsert).not.toHaveBeenCalled();
  });

  it('preserves approval of an existing V2 settlement and its idempotent reward ledgers', async () => {
    const harness = createHarness({ config: makeV2Config() });
    harness.settlements.push({
      id: 'settlement-1',
      captainUserId: 'captain-1',
      month: '2026-06',
      programCode: 'SEAFOOD_PREPACKAGED',
      status: 'DRAFT',
      baseManagementAmount: 550,
      growthBonusAmount: 175,
      cultivationBonusAmount: 0,
      teamPoolAmount: 280,
      totalAmount: 1005,
      configSnapshot: makeV2Config(),
      meta: {
        performanceBonusSummary: { amount: 280, recipientUserId: 'captain-1' },
      },
    });

    await harness.service.approveSettlement('settlement-1', 'admin-1');

    expect(harness.createdLedgers.map((item) => item.idempotencyKey)).toEqual([
      'captain:month:2026-06:captain-1:management',
      'captain:month:2026-06:captain-1:growth',
      'captain:month:2026-06:captain-1:performance',
    ]);
  });

  it('preserves payment of an existing approved V2 settlement', async () => {
    const harness = createHarness({ config: makeV2Config() });
    harness.settlements.push({
      id: 'settlement-1',
      month: '2026-06',
      status: 'APPROVED',
      totalAmount: 650,
    });
    harness.createdLedgers.push(
      { settlementId: 'settlement-1', accountId: 'account-captain-1', amount: 550, status: 'AVAILABLE' },
      { settlementId: 'settlement-1', accountId: 'account-captain-1', amount: 100, status: 'AVAILABLE' },
    );

    await harness.service.markPaid('settlement-1', 'admin-1');

    expect(harness.tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-captain-1' },
      data: {
        balance: { decrement: 650 },
        withdrawn: { increment: 650 },
      },
    });
  });

  it('rejects payment when available ledgers do not match the settlement total', async () => {
    const harness = createHarness({ config: makeV2Config() });
    harness.settlements.push({
      id: 'settlement-1',
      month: '2026-06',
      status: 'APPROVED',
      totalAmount: 650,
    });
    harness.createdLedgers.push({
      settlementId: 'settlement-1',
      accountId: 'account-captain-1',
      amount: 550,
      status: 'AVAILABLE',
    });

    await expect(harness.service.markPaid('settlement-1', 'admin-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects recalculation of an existing V2 draft without changing historical data', async () => {
    const harness = createHarness({ config: makeV2Config() });
    harness.settlements.push({
      id: 'settlement-2',
      captainUserId: 'captain-2',
      month: '2026-06',
      programCode: 'SEAFOOD_PREPACKAGED',
      status: 'DRAFT',
      configSnapshot: makeV2Config(),
    });

    await expect(harness.service.recalculateSettlement('settlement-2', 'admin-1'))
      .rejects.toThrow('V2');
    expect(harness.tx.captainMonthlyMetric.upsert).not.toHaveBeenCalled();
  });
});
