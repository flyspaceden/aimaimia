import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from './captain.constants';
import { CaptainMonthlySettlementService } from './captain-monthly-settlement.service';

function makeConfig(overrides: any = {}) {
  return {
    schemaVersion: 2,
    enabled: true,
    programCode: 'SEAFOOD_PREPACKAGED',
    programName: '预包装海鲜团长经营激励',
    effectiveFrom: null,
    scope: {
      categoryIds: [],
      productIds: ['product-1'],
      companyIds: [],
      excludedProductIds: [],
      includeVipPackage: false,
      includeGroupBuy: false,
      includePrize: false,
    },
    orderRules: {
      freezeDaysAfterReceived: 7,
      minCommissionBase: 0,
      includeShippingFee: false,
      includeCouponDiscount: false,
      includeRewardDeduction: false,
    },
    perOrderCommission: { directRate: 0.11 },
    monthlyRewards: {
      baseTierGmv: 25000,
      baseManagementRate: 0.022,
      growthTierGmv: 70000,
      growthBonusRate: 0.007,
      excellentTierGmv: 140000,
      cultivationBonusRate: 0.006,
      performanceBonusRate: 0.01,
    },
    monthlyQualification: {
      minDirectEffectiveBuyers: 0,
      minDirectMonthlyGmv: 8000,
      minNewEffectiveBuyers: 0,
    },
    caps: {
      maxTotalIncentiveRate: 0.155,
      targetNetProfitRate: 0.09,
      coldChainRiskReserveRate: 0.02,
    },
    tax: {
      enabled: true,
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

function makeV3Config(overrides: any = {}) {
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    enabled: true,
    scope: {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
      productIds: ['product-1'],
    },
    ...overrides,
  };
}

function makeAttribution(
  id: string,
  directCaptainUserId: string,
  commissionBase: number,
  overrides: any = {},
) {
  return {
    id,
    buyerUserId: `${id}-buyer`,
    directCaptainUserId,
    legacyIndirectCaptainUserId: null,
    commissionBase,
    refundAmount: 0,
    createdAt: new Date('2026-06-15T00:00:00.000Z'),
    ...overrides,
  };
}

function createHarness(options: {
  config?: any;
  captains?: string[];
  attributions?: any[];
  relations?: any[];
  existingSettlements?: Record<string, any>;
} = {}) {
  const config = options.config ?? makeConfig();
  const captains = options.captains ?? ['captain-1'];
  const attributions = options.attributions ?? [];
  const relations = options.relations ?? [];
  const existingSettlements = options.existingSettlements ?? {};
  const savedMetrics: any[] = [];
  const savedSettlements: any[] = [];
  const createdLedgers: any[] = [];
  const settlementKey = (captainUserId: string, month = '2026-06', programCode = config.programCode) => (
    `${captainUserId}|${month}|${programCode}`
  );

  const tx: any = {
    captainProfile: {
      findMany: jest.fn().mockResolvedValue(captains.map((userId) => ({ userId }))),
    },
    captainOrderAttribution: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        const directIds = new Set([
          where.directCaptainUserId,
          ...(where.OR ?? []).map((item: any) => item.directCaptainUserId),
        ].filter(Boolean));
        return Promise.resolve(attributions.filter((item) => (
          directIds.has(item.directCaptainUserId)
        )));
      }),
    },
    captainRelation: {
      findMany: jest.fn().mockResolvedValue(relations),
    },
    captainMonthlyMetric: {
      upsert: jest.fn(async ({ create, update }: any) => {
        const metric = { id: `metric-${savedMetrics.length + 1}`, ...create, ...update };
        savedMetrics.push(metric);
        return metric;
      }),
      findUnique: jest.fn(),
    },
    captainMonthlySettlement: {
      upsert: jest.fn(async ({ create, update }: any) => {
        const settlement = { id: `settlement-${savedSettlements.length + 1}`, ...create, ...update };
        savedSettlements.push(settlement);
        return settlement;
      }),
      create: jest.fn(async ({ data }: any) => {
        const settlement = { id: `settlement-${savedSettlements.length + 1}`, ...data };
        savedSettlements.push(settlement);
        return settlement;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where?.id) {
          return Object.values(existingSettlements).find((item: any) => item.id === where.id) ?? null;
        }
        const unique = where?.captainUserId_month_programCode;
        if (unique) {
          return existingSettlements[settlementKey(
            unique.captainUserId,
            unique.month,
            unique.programCode,
          )] ?? null;
        }
        return null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const unique = where?.captainUserId_month_programCode;
        const existing = unique
          ? existingSettlements[settlementKey(unique.captainUserId, unique.month, unique.programCode)]
          : Object.values(existingSettlements).find((item: any) => item.id === where?.id);
        const settlement = {
          id: existing?.id ?? `settlement-${savedSettlements.length + 1}`,
          ...existing,
          ...data,
        };
        savedSettlements.push(settlement);
        return settlement;
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
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: any) => {
        createdLedgers.push(data);
        return { id: `ledger-${createdLedgers.length}`, ...data };
      }),
      updateMany: jest.fn(),
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
    config,
    savedMetrics,
    savedSettlements,
    createdLedgers,
    settlementKey,
    service: new CaptainMonthlySettlementService(prisma, configService as any),
  };
}

describe('CaptainMonthlySettlementService', () => {
  it('skips enabled V3 in both legacy monthly entry points before starting a transaction', async () => {
    const { service, prisma, tx } = createHarness({ config: makeV3Config() });

    await expect(service.calculateMetrics('2026-06')).resolves.toEqual([]);
    await expect(service.createDraftSettlements('2026-06')).resolves.toEqual([]);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.captainOrderAttribution.findMany).not.toHaveBeenCalled();
    expect(tx.captainMonthlySettlement.create).not.toHaveBeenCalled();
  });

  it('grants qualification at 8000 direct GMV but creates no high-value monthly reward', async () => {
    const { service, tx, savedMetrics, savedSettlements } = createHarness({
      attributions: [
        makeAttribution('order-1', 'captain-1', 8000),
      ],
    });

    await service.createDraftSettlements('2026-06');

    const attributionQuery = tx.captainOrderAttribution.findMany.mock.calls[0][0];
    expect(attributionQuery.where).toMatchObject({ directCaptainUserId: 'captain-1' });
    expect(attributionQuery.select).not.toHaveProperty('indirectCaptainUserId');
    expect(savedMetrics[0]).toMatchObject({
      month: '2026-06',
      teamGmv: 8000,
      qualified: true,
      qualifiedTier: 'QUALIFIED',
    });
    expect(savedSettlements[0]).toMatchObject({
      baseManagementAmount: 0,
      growthBonusAmount: 0,
      cultivationBonusAmount: 0,
      teamPoolAmount: 0,
      totalAmount: 0,
      configSnapshot: expect.objectContaining({ programCode: 'SEAFOOD_PREPACKAGED' }),
    });
  });

  it('creates management allowance and direct-operation performance award at base tier', async () => {
    const { service, savedSettlements } = createHarness({
      attributions: [
        makeAttribution('order-1', 'captain-1', 25000),
      ],
    });

    await service.createDraftSettlements('2026-06');

    expect(savedSettlements[0]).toMatchObject({
      baseManagementAmount: 550,
      growthBonusAmount: 0,
      cultivationBonusAmount: 0,
      teamPoolAmount: 250,
      totalAmount: 800,
      taxAmount: 160,
      netAmount: 640,
    });
  });

  it('adds growth and cultivation bonuses at configured tiers', async () => {
    const { service, savedSettlements } = createHarness({
      attributions: [
        makeAttribution('order-1', 'captain-1', 140000),
      ],
    });

    await service.createDraftSettlements('2026-06');

    expect(savedSettlements[0]).toMatchObject({
      baseManagementAmount: 3080,
      growthBonusAmount: 980,
      cultivationBonusAmount: 840,
      teamPoolAmount: 1400,
      totalAmount: 6300,
    });
  });

  it('does not count legacy indirect sales or distribute a performance award to another captain', async () => {
    const { service, savedSettlements } = createHarness({
      attributions: [
        makeAttribution('order-1', 'captain-1', 25000),
        makeAttribution('order-2', 'member-1', 70000, { legacyIndirectCaptainUserId: 'captain-1' }),
      ],
    });

    await service.createDraftSettlements('2026-06');

    expect(savedSettlements[0]).toMatchObject({
      teamPoolAmount: 250,
      totalAmount: 800,
      meta: {
        performanceBonusSummary: {
          amount: 250,
          recipientUserId: 'captain-1',
        },
      },
    });
  });

  it('creates zero monthly rewards when monthly assessment fails', async () => {
    const { service, savedMetrics, savedSettlements } = createHarness({
      config: makeConfig({
      monthlyQualification: {
        ...makeConfig().monthlyQualification,
        minDirectEffectiveBuyers: 2,
        },
      }),
      attributions: [
        makeAttribution('order-1', 'captain-1', 140000),
      ],
    });

    await service.createDraftSettlements('2026-06');

    expect(savedMetrics[0].qualified).toBe(false);
    expect(savedSettlements[0]).toMatchObject({
      baseManagementAmount: 0,
      growthBonusAmount: 0,
      cultivationBonusAmount: 0,
      teamPoolAmount: 0,
      totalAmount: 0,
    });
  });

  it('does not count a newly bound direct customer without a valid direct order', async () => {
    const { service, savedMetrics } = createHarness({
      relations: [
        {
          buyerUserId: 'buyer-without-order',
          directCaptainUserId: 'captain-1',
          boundAt: new Date('2026-06-15T00:00:00.000Z'),
        },
      ],
    });

    await service.createDraftSettlements('2026-06');

    expect(savedMetrics[0]).toMatchObject({
      directEffectiveBuyers: 0,
      teamEffectiveMembers: 0,
      newEffectiveMembers: 0,
    });
  });

  it('approves settlement and creates monthly reward ledgers with idempotency keys', async () => {
    const { service, tx, createdLedgers } = createHarness();
    tx.captainMonthlySettlement.findUnique.mockResolvedValue({
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
      configSnapshot: makeConfig(),
      meta: {
        performanceBonusSummary: { amount: 280, recipientUserId: 'captain-1' },
      },
    });

    await service.approveSettlement('settlement-1', 'admin-1');

    expect(tx.captainMonthlySettlement.update).toHaveBeenCalledWith({
      where: { id: 'settlement-1' },
      data: expect.objectContaining({
        status: 'APPROVED',
        reviewedByAdminId: 'admin-1',
      }),
    });
    expect(createdLedgers.map((item) => item.idempotencyKey)).toEqual([
      'captain:month:2026-06:captain-1:management',
      'captain:month:2026-06:captain-1:growth',
      'captain:month:2026-06:captain-1:performance',
    ]);
    expect(createdLedgers.map((item) => item.amount)).toEqual([
      550,
      175,
      280,
    ]);
    expect(createdLedgers.map((item) => item.type)).toEqual([
      'MANAGEMENT_ALLOWANCE',
      'GROWTH_BONUS',
      'PERFORMANCE_BONUS',
    ]);
  });

  it('marks approved settlement paid and moves available ledger amounts from balance to withdrawn', async () => {
    const { service, tx } = createHarness();
    tx.captainMonthlySettlement.findUnique.mockResolvedValue({
      id: 'settlement-1',
      status: 'APPROVED',
      totalAmount: 650,
    });
    tx.captainCommissionLedger.findMany.mockResolvedValue([
      { accountId: 'account-captain-1', amount: 550 },
      { accountId: 'account-captain-1', amount: 100 },
    ]);
    tx.captainMonthlySettlement.update.mockResolvedValue({ id: 'settlement-1', status: 'PAID' });

    await service.markPaid('settlement-1', 'admin-1');

    expect(tx.captainAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-captain-1' },
      data: {
        balance: { decrement: 650 },
        withdrawn: { increment: 650 },
      },
    });
    expect(tx.captainCommissionLedger.updateMany).toHaveBeenCalledWith({
      where: {
        settlementId: 'settlement-1',
        status: 'AVAILABLE',
        deletedAt: null,
      },
      data: { status: 'WITHDRAWN' },
    });
  });

  it('rejects marking paid when available ledger total does not match settlement total', async () => {
    const { service, tx } = createHarness();
    tx.captainMonthlySettlement.findUnique.mockResolvedValue({
      id: 'settlement-1',
      status: 'APPROVED',
      totalAmount: 650,
    });
    tx.captainCommissionLedger.findMany.mockResolvedValue([
      { accountId: 'account-captain-1', amount: 550 },
    ]);

    await expect(service.markPaid('settlement-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.captainAccount.update).not.toHaveBeenCalled();
    expect(tx.captainCommissionLedger.updateMany).not.toHaveBeenCalled();
  });

  it('recalculates only the requested captain settlement', async () => {
    const { service } = createHarness({
      captains: ['captain-1', 'captain-2'],
      attributions: [
        makeAttribution('order-1', 'captain-1', 25000),
        makeAttribution('order-2', 'captain-2', 70000),
      ],
      existingSettlements: {
        'captain-2|2026-06|SEAFOOD_PREPACKAGED': {
          id: 'settlement-2',
          captainUserId: 'captain-2',
          month: '2026-06',
          programCode: 'SEAFOOD_PREPACKAGED',
          status: 'DRAFT',
        },
      },
    });

    const draft = await service.recalculateSettlement('settlement-2', 'admin-1');

    expect(draft).toMatchObject({
      captainUserId: 'captain-2',
      totalAmount: 2730,
    });
  });

  it('does not downgrade approved settlements during scheduled draft generation', async () => {
    const approvedSettlement = {
      id: 'settlement-1',
      captainUserId: 'captain-1',
      month: '2026-06',
      programCode: 'SEAFOOD_PREPACKAGED',
      status: 'APPROVED',
      totalAmount: 650,
    };
    const { service, tx } = createHarness({
      attributions: [
        makeAttribution('order-1', 'captain-1', 25000),
      ],
      existingSettlements: {
        'captain-1|2026-06|SEAFOOD_PREPACKAGED': approvedSettlement,
      },
    });

    const settlements = await service.createDraftSettlements('2026-06');

    expect(settlements[0]).toBe(approvedSettlement);
    expect(tx.captainMonthlySettlement.upsert).not.toHaveBeenCalled();
    expect(tx.captainMonthlySettlement.update).not.toHaveBeenCalled();
  });
});
