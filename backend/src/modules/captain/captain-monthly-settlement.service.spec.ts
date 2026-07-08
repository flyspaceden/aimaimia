import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from './captain.constants';
import { CaptainMonthlySettlementService } from './captain-monthly-settlement.service';

function makeConfig(overrides: any = {}) {
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    enabled: true,
    scope: {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
      productIds: ['product-1'],
    },
    monthlyQualification: {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.monthlyQualification,
      minDirectEffectiveBuyers: 0,
      minPersonalMonthlyGmv: 0,
      minTeamEffectiveMembers: 0,
      minTeamMonthlyGmv: 8000,
      minNewEffectiveMembers: 0,
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
    indirectCaptainUserId: null,
    commissionBase,
    refundAmount: 0,
    createdAt: new Date('2026-06-15T00:00:00.000Z'),
    ...overrides,
  };
}

function createHarness(options: {
  config?: any;
  attributions?: any[];
  relations?: any[];
} = {}) {
  const config = options.config ?? makeConfig();
  const attributions = options.attributions ?? [];
  const relations = options.relations ?? [];
  const savedMetrics: any[] = [];
  const savedSettlements: any[] = [];
  const createdLedgers: any[] = [];

  const tx: any = {
    captainProfile: {
      findMany: jest.fn().mockResolvedValue([
        { userId: 'captain-1' },
      ]),
    },
    captainOrderAttribution: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        if (where.indirectCaptainUserId === 'captain-1') {
          return Promise.resolve(attributions.filter((item) => (
            item.indirectCaptainUserId === 'captain-1'
          )));
        }
        const direct = where.OR?.some((item: any) => item.directCaptainUserId === 'captain-1');
        const indirect = where.OR?.some((item: any) => item.indirectCaptainUserId === 'captain-1');
        return Promise.resolve(attributions.filter((item) => (
          (direct && item.directCaptainUserId === 'captain-1') ||
          (indirect && item.indirectCaptainUserId === 'captain-1')
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
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    captainAccount: {
      upsert: jest.fn(async ({ where }: any) => ({
        id: `account-${where.userId_programCode.userId}`,
        userId: where.userId_programCode.userId,
        balance: 0,
      })),
      update: jest.fn(),
    },
    captainCommissionLedger: {
      create: jest.fn(async ({ data }: any) => {
        createdLedgers.push(data);
        return { id: `ledger-${createdLedgers.length}`, ...data };
      }),
      updateMany: jest.fn(),
    },
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
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
    service: new CaptainMonthlySettlementService(prisma, configService as any),
  };
}

describe('CaptainMonthlySettlementService', () => {
  it('grants qualification at 8000 team GMV but creates no high-value monthly reward', async () => {
    const { service, savedMetrics, savedSettlements } = createHarness({
      attributions: [
        makeAttribution('order-1', 'captain-1', 8000),
      ],
    });

    await service.createDraftSettlements('2026-06');

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

  it('creates management allowance and team pool at base tier', async () => {
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
      teamPoolAmount: 100,
      totalAmount: 650,
      taxAmount: 130,
      netAmount: 520,
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
      teamPoolAmount: 560,
      totalAmount: 5460,
    });
  });

  it('splits team pool with captain 40 percent and members 60 percent by personal GMV', async () => {
    const { service, savedSettlements } = createHarness({
      attributions: [
        makeAttribution('order-1', 'member-1', 30000, { indirectCaptainUserId: 'captain-1' }),
        makeAttribution('order-2', 'member-2', 70000, { indirectCaptainUserId: 'captain-1' }),
      ],
      relations: [
        { buyerUserId: 'member-1', directCaptainUserId: 'captain-1', status: 'ACTIVE' },
        { buyerUserId: 'member-2', directCaptainUserId: 'captain-1', status: 'ACTIVE' },
      ],
    });

    await service.createDraftSettlements('2026-06');

    expect(savedSettlements[0].teamPoolAmount).toBe(400);
    expect(savedSettlements[0].meta.teamPoolDistribution).toEqual([
      { userId: 'member-1', personalGmv: 30000, amount: 180 },
      { userId: 'member-2', personalGmv: 70000, amount: 420 },
    ]);
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
      teamPoolAmount: 100,
      totalAmount: 825,
      configSnapshot: makeConfig(),
      meta: {
        teamPoolDistribution: [
          { userId: 'member-1', personalGmv: 30000, amount: 180 },
        ],
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
      'captain:month:2026-06:captain-1:team-pool',
      'captain:month:2026-06:member-1:team-pool:captain-1',
    ]);
  });
});
