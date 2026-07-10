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

function makeV3Config(enabled = true) {
  return {
    ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
    enabled,
  };
}

function createHarness(config: any = makeV2Config()) {
  const createdLedgers: any[] = [];
  const tx: any = {
    captainProfile: { findMany: jest.fn() },
    captainOrderAttribution: { findMany: jest.fn() },
    captainMonthlyMetric: { upsert: jest.fn() },
    captainMonthlySettlement: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
    configService,
    createdLedgers,
    service: new CaptainMonthlySettlementService(prisma, configService as any),
  };
}

describe('CaptainMonthlySettlementService', () => {
  it.each([
    ['enabled persisted V2', makeV2Config(true)],
    ['disabled persisted V2', makeV2Config(false)],
    ['enabled V3 before the V3 monthly path is installed', makeV3Config(true)],
    ['disabled V3', makeV3Config(false)],
  ])('creates no new legacy monthly metrics or drafts for %s', async (_label, config) => {
    const { service, prisma, tx } = createHarness(config);

    await expect(service.calculateMetrics('2026-06')).resolves.toEqual([]);
    await expect(service.createDraftSettlements('2026-06')).resolves.toEqual([]);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.captainProfile.findMany).not.toHaveBeenCalled();
    expect(tx.captainOrderAttribution.findMany).not.toHaveBeenCalled();
    expect(tx.captainMonthlyMetric.upsert).not.toHaveBeenCalled();
    expect(tx.captainMonthlySettlement.create).not.toHaveBeenCalled();
  });

  it('preserves approval of an existing V2 settlement and its idempotent reward ledgers', async () => {
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
      configSnapshot: makeV2Config(),
      meta: {
        performanceBonusSummary: { amount: 280, recipientUserId: 'captain-1' },
      },
    });
    tx.captainMonthlySettlement.update.mockResolvedValue({
      id: 'settlement-1',
      status: 'APPROVED',
    });

    await service.approveSettlement('settlement-1', 'admin-1');

    expect(createdLedgers.map((item) => item.idempotencyKey)).toEqual([
      'captain:month:2026-06:captain-1:management',
      'captain:month:2026-06:captain-1:growth',
      'captain:month:2026-06:captain-1:performance',
    ]);
    expect(tx.captainMonthlySettlement.update).toHaveBeenCalledWith({
      where: { id: 'settlement-1' },
      data: expect.objectContaining({
        status: 'APPROVED',
        reviewedByAdminId: 'admin-1',
      }),
    });
  });

  it('preserves payment of an existing approved V2 settlement', async () => {
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
    tx.captainMonthlySettlement.update.mockResolvedValue({
      id: 'settlement-1',
      status: 'PAID',
    });

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

  it('rejects payment when available ledgers do not match the settlement total', async () => {
    const { service, tx } = createHarness();
    tx.captainMonthlySettlement.findUnique.mockResolvedValue({
      id: 'settlement-1',
      status: 'APPROVED',
      totalAmount: 650,
    });
    tx.captainCommissionLedger.findMany.mockResolvedValue([
      { accountId: 'account-captain-1', amount: 550 },
    ]);

    await expect(service.markPaid('settlement-1', 'admin-1'))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(tx.captainAccount.update).not.toHaveBeenCalled();
    expect(tx.captainCommissionLedger.updateMany).not.toHaveBeenCalled();
  });

  it('rejects recalculation of an existing V2 draft without changing historical data', async () => {
    const { service, tx } = createHarness();
    tx.captainMonthlySettlement.findUnique.mockResolvedValue({
      id: 'settlement-2',
      captainUserId: 'captain-2',
      month: '2026-06',
      programCode: 'SEAFOOD_PREPACKAGED',
      status: 'DRAFT',
    });

    await expect(service.recalculateSettlement('settlement-2', 'admin-1'))
      .rejects.toThrow('V2');
    expect(tx.captainMonthlySettlement.update).not.toHaveBeenCalled();
    expect(tx.captainMonthlyMetric.upsert).not.toHaveBeenCalled();
  });
});
