import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from '../../captain/captain.constants';
import { AdminCaptainService } from './admin-captain.service';

function createHarness() {
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
    captainProfile: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    captainAccount: {
      findUnique: jest.fn(),
    },
    captainRelation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    captainOrderAttribution: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    captainCommissionLedger: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    captainMonthlySettlement: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ruleConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    ruleVersion: {
      create: jest.fn(),
    },
  };
  const relationService = {
    createCaptainProfile: jest.fn().mockResolvedValue({ userId: 'captain-1' }),
  };
  const configService = {
    getSnapshot: jest.fn().mockResolvedValue(DEFAULT_CAPTAIN_SEAFOOD_CONFIG),
  };
  const monthlySettlementService = {
    approveSettlement: jest.fn().mockResolvedValue({ id: 'settlement-1', status: 'APPROVED' }),
    markPaid: jest.fn().mockResolvedValue({ id: 'settlement-1', status: 'PAID' }),
    recalculateSettlement: jest.fn().mockResolvedValue({ id: 'settlement-1', status: 'DRAFT' }),
  };

  return {
    prisma,
    relationService,
    configService,
    monthlySettlementService,
    service: new AdminCaptainService(
      prisma,
      relationService as any,
      configService as any,
      monthlySettlementService as any,
    ),
  };
}

describe('AdminCaptainService', () => {
  it('lists captain profiles with keyword, status and month metric filter', async () => {
    const { service, prisma, configService } = createHarness();

    await service.listProfiles({
      page: 2,
      pageSize: 10,
      keyword: 'AIMM0001',
      status: 'ACTIVE',
      month: '2026-06',
    });

    expect(prisma.captainProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'ACTIVE',
        OR: expect.any(Array),
      }),
      include: expect.objectContaining({
        user: expect.objectContaining({
          include: expect.objectContaining({
            captainMonthlyMetrics: expect.objectContaining({
              where: { month: '2026-06', programCode: 'SEAFOOD_PREPACKAGED' },
            }),
          }),
        }),
      }),
      skip: 10,
      take: 10,
    }));
    expect(prisma.captainProfile.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'ACTIVE' }),
    }));
  });

  it('opens a captain through relation service and updates profile status', async () => {
    const { service, relationService, prisma } = createHarness();
    prisma.captainProfile.findUnique.mockResolvedValue({
      userId: 'captain-1',
      status: 'ACTIVE',
    });
    prisma.captainProfile.update.mockResolvedValue({
      userId: 'captain-1',
      status: 'PAUSED',
    });

    await service.createProfile({
      userId: 'captain-1',
      captainCode: 'SEA001',
      displayName: '团长一',
    }, 'admin-1');
    await service.updateProfileStatus('captain-1', { status: 'PAUSED', reason: '休整' }, 'admin-1');

    expect(relationService.createCaptainProfile).toHaveBeenCalledWith({
      userId: 'captain-1',
      captainCode: 'SEA001',
      displayName: '团长一',
      adminUserId: 'admin-1',
    });
    expect(prisma.captainProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'captain-1' },
      data: expect.objectContaining({
        status: 'PAUSED',
        pausedAt: expect.any(Date),
        statusReason: '休整',
      }),
    }));
  });

  it('queries team members with direct and indirect levels only', async () => {
    const { service, prisma } = createHarness();
    prisma.captainRelation.findMany.mockResolvedValue([
      { buyerUserId: 'buyer-1', directCaptainUserId: 'captain-1', indirectCaptainUserId: null },
      { buyerUserId: 'buyer-2', directCaptainUserId: 'member-1', indirectCaptainUserId: 'captain-1' },
    ]);

    const result = await service.getTeam('captain-1');

    expect(prisma.captainRelation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        programCode: 'SEAFOOD_PREPACKAGED',
        status: 'ACTIVE',
        OR: [
          { directCaptainUserId: 'captain-1' },
          { indirectCaptainUserId: 'captain-1' },
        ],
      },
    }));
    expect(result.items.map((item: any) => item.level)).toEqual([1, 2]);
    expect(JSON.stringify(result)).not.toContain('level":3');
  });

  it('queries order attributions, commission ledgers and monthly settlements', async () => {
    const { service, prisma } = createHarness();

    await service.listOrders({ captainUserId: 'captain-1', month: '2026-06' });
    await service.listLedgers({ userId: 'captain-1', status: 'AVAILABLE' });
    await service.listSettlements({ month: '2026-06', status: 'DRAFT' });

    expect(prisma.captainOrderAttribution.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { directCaptainUserId: 'captain-1' },
          { indirectCaptainUserId: 'captain-1' },
        ],
      }),
    }));
    expect(prisma.captainCommissionLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'captain-1', status: 'AVAILABLE' }),
    }));
    expect(prisma.captainMonthlySettlement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ month: '2026-06', status: 'DRAFT' }),
    }));
  });

  it('delegates settlement approval operations to monthly settlement service', async () => {
    const { service, monthlySettlementService } = createHarness();

    await service.approveSettlement('settlement-1', 'admin-1');
    await service.markSettlementPaid('settlement-1', 'admin-1');
    await service.recalculateSettlement('settlement-1', 'admin-1');

    expect(monthlySettlementService.approveSettlement).toHaveBeenCalledWith('settlement-1', 'admin-1');
    expect(monthlySettlementService.markPaid).toHaveBeenCalledWith('settlement-1', 'admin-1');
    expect(monthlySettlementService.recalculateSettlement).toHaveBeenCalledWith('settlement-1', 'admin-1');
  });

  it('reads and updates captain config with strict validation', async () => {
    const { service, prisma, configService } = createHarness();
    const enabledConfig = {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
      enabled: true,
      scope: {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
        productIds: ['product-1'],
      },
    };
    configService.getSnapshot.mockResolvedValueOnce(enabledConfig);

    await expect(service.getSettings()).resolves.toMatchObject({ enabled: true });
    await service.updateSettings(enabledConfig, 'admin-1');

    expect(prisma.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'CAPTAIN_SEAFOOD_CONFIG' },
      update: { value: enabledConfig },
      create: {
        key: 'CAPTAIN_SEAFOOD_CONFIG',
        value: enabledConfig,
        description: '预包装海鲜团长经营激励配置',
      },
    });
    await expect(service.updateSettings({
      ...enabledConfig,
      perOrderCommission: { ...enabledConfig.perOrderCommission, maxLevels: 3 },
    }, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
