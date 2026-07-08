import { BadRequestException } from '@nestjs/common';
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
        if (where.indirectCaptainUserId) {
          return Promise.resolve(attributions.filter((item) => (
            item.indirectCaptainUserId === where.indirectCaptainUserId
          )));
        }
        const directIds = new Set(
          (where.OR ?? [])
            .map((item: any) => item.directCaptainUserId)
            .filter(Boolean),
        );
        const indirectIds = new Set(
          (where.OR ?? [])
            .map((item: any) => item.indirectCaptainUserId)
            .filter(Boolean),
        );
        return Promise.resolve(attributions.filter((item) => (
          directIds.has(item.directCaptainUserId) ||
          indirectIds.has(item.indirectCaptainUserId)
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

    expect(savedSettlements[0]).toMatchObject({
      teamPoolAmount: 1000,
      totalAmount: 3900,
      meta: {
        teamPoolSummary: {
          theoreticalAmount: 1000,
          captainAmount: 400,
          memberAmount: 600,
        },
      },
    });
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
      teamPoolAmount: 280,
      totalAmount: 1005,
      configSnapshot: makeConfig(),
      meta: {
        teamPoolSummary: {
          theoreticalAmount: 280,
          captainAmount: 100,
          memberAmount: 180,
        },
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
    expect(createdLedgers.map((item) => item.amount)).toEqual([
      550,
      175,
      100,
      180,
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
      totalAmount: 2310,
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
