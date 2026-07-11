import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG } from '../../captain/captain.constants';
import { AdminCaptainService } from './admin-captain.service';

function createHarness() {
  const safetyTx: any = {
    ruleConfig: {
      upsert: jest.fn(),
    },
    ruleVersion: {
      create: jest.fn(),
    },
  };
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
    getReviewBlockReason: jest.fn().mockResolvedValue(null),
    createDraftSettlements: jest.fn().mockResolvedValue([{ id: 'settlement-1', status: 'DRAFT' }]),
    approveSettlement: jest.fn().mockResolvedValue({ id: 'settlement-1', status: 'APPROVED' }),
    markPaid: jest.fn().mockResolvedValue({ id: 'settlement-1', status: 'PAID' }),
    recalculateSettlement: jest.fn().mockResolvedValue({ id: 'settlement-1', status: 'DRAFT' }),
  };
  const applicationService = {
    listAdmin: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getAdmin: jest.fn().mockResolvedValue({ id: 'application-1', status: 'PENDING' }),
    approve: jest.fn().mockResolvedValue({ id: 'application-1', status: 'APPROVED' }),
    reject: jest.fn().mockResolvedValue({ id: 'application-1', status: 'REJECTED' }),
  };
  const profitSafetyService = {
    withCandidateChange: jest.fn(async (_change: any, write: any) => ({
      result: await write(safetyTx),
      ruleVersion: { id: 'version-1', isComplete: true },
    })),
  };

  return {
    prisma,
    relationService,
    configService,
    monthlySettlementService,
    applicationService,
    profitSafetyService,
    safetyTx,
    service: new (AdminCaptainService as any)(
      prisma,
      relationService as any,
      configService as any,
      monthlySettlementService as any,
      applicationService as any,
      profitSafetyService as any,
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

  it('queries direct customers only and does not return operational levels', async () => {
    const { service, prisma } = createHarness();
    prisma.captainRelation.findMany.mockResolvedValue([
      { buyerUserId: 'buyer-1', directCaptainUserId: 'captain-1', legacyIndirectCaptainUserId: null },
    ]);

    const result = await service.getTeam('captain-1');

    expect(prisma.captainRelation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        programCode: 'SEAFOOD_PREPACKAGED',
        status: 'ACTIVE',
        directCaptainUserId: 'captain-1',
      },
    }));
    expect(result.items).toEqual([
      expect.objectContaining({ buyerUserId: 'buyer-1', directCaptainUserId: 'captain-1' }),
    ]);
    expect(result.items[0]).not.toHaveProperty('legacyIndirectCaptainUserId');
    expect(JSON.stringify(result)).not.toContain('level');
  });

  it('queries order attributions, commission ledgers and monthly settlements', async () => {
    const { service, prisma, monthlySettlementService } = createHarness();
    prisma.captainMonthlySettlement.findMany.mockResolvedValue([{
      id: 'settlement-1',
      month: '2026-06',
      captainUserId: 'captain-1',
      configSnapshot: { schemaVersion: 3 },
    }]);
    monthlySettlementService.getReviewBlockReason.mockResolvedValue(
      '结算订单存在未解决的利润对账任务，不可审核或支付',
    );

    await service.listOrders({ captainUserId: 'captain-1', month: '2026-06' });
    await service.listLedgers({ userId: 'captain-1', status: 'AVAILABLE' });
    const settlements = await service.listSettlements({ month: '2026-06', status: 'DRAFT' });

    expect(prisma.captainOrderAttribution.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        directCaptainUserId: 'captain-1',
      }),
    }));
    expect(prisma.captainCommissionLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'captain-1', status: 'AVAILABLE' }),
    }));
    expect(prisma.captainMonthlySettlement.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ month: '2026-06', status: 'DRAFT' }),
    }));
    expect(settlements.items[0].reviewBlockedReason).toContain('未解决的利润对账');
  });

  it('delegates settlement approval operations to monthly settlement service', async () => {
    const { service, monthlySettlementService } = createHarness();

    await service.generateSettlements('2026-06');
    await service.approveSettlement('settlement-1', 'admin-1');
    await service.markSettlementPaid('settlement-1', 'admin-1');
    await service.recalculateSettlement('settlement-1', 'admin-1');

    expect(monthlySettlementService.createDraftSettlements).toHaveBeenCalledWith('2026-06');
    expect(monthlySettlementService.approveSettlement).toHaveBeenCalledWith('settlement-1', 'admin-1');
    expect(monthlySettlementService.markPaid).toHaveBeenCalledWith('settlement-1', 'admin-1');
    expect(monthlySettlementService.recalculateSettlement).toHaveBeenCalledWith('settlement-1', 'admin-1');
  });

  it('rejects invalid month when generating settlements', async () => {
    const { service, monthlySettlementService } = createHarness();

    expect(() => service.generateSettlements('2026-6')).toThrow(BadRequestException);

    expect(monthlySettlementService.createDraftSettlements).not.toHaveBeenCalled();
  });

  it('delegates captain application list and review operations to application service', async () => {
    const { service, applicationService } = createHarness();

    await service.listApplications({ status: 'PENDING', keyword: 'AIMM' });
    await service.getApplication('application-1');
    await service.approveApplication('application-1', 'admin-1', { captainCode: 'SEA001' });
    await service.rejectApplication('application-1', 'admin-1', { reason: '资料不足' });

    expect(applicationService.listAdmin).toHaveBeenCalledWith({ status: 'PENDING', keyword: 'AIMM' });
    expect(applicationService.getAdmin).toHaveBeenCalledWith('application-1');
    expect(applicationService.approve).toHaveBeenCalledWith('application-1', 'admin-1', { captainCode: 'SEA001' });
    expect(applicationService.reject).toHaveBeenCalledWith('application-1', 'admin-1', { reason: '资料不足' });
  });

  it('updates captain settings through the profit safety coordinator without a second version', async () => {
    const { service, configService, profitSafetyService, safetyTx } = createHarness();
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
    await expect(service.updateSettings(enabledConfig, 'admin-1')).resolves.toEqual(enabledConfig);

    expect(profitSafetyService.withCandidateChange).toHaveBeenCalledWith({
      captainConfig: enabledConfig,
      createdByAdminId: 'admin-1',
      changeNote: '更新预包装海鲜团长经营激励配置',
    }, expect.any(Function));
    expect(safetyTx.ruleConfig.upsert).toHaveBeenCalledWith({
      where: { key: 'CAPTAIN_SEAFOOD_CONFIG' },
      update: { value: enabledConfig },
      create: {
        key: 'CAPTAIN_SEAFOOD_CONFIG',
        value: enabledConfig,
      },
    });
    expect(safetyTx.ruleVersion.create).not.toHaveBeenCalled();
  });

  it('writes nothing when profit safety rejects captain settings', async () => {
    const { service, prisma, profitSafetyService, safetyTx } = createHarness();
    profitSafetyService.withCandidateChange.mockRejectedValueOnce(new Error('unsafe'));

    await expect(service.updateSettings(DEFAULT_CAPTAIN_SEAFOOD_CONFIG, 'admin-1'))
      .rejects.toThrow('unsafe');

    expect(safetyTx.ruleConfig.upsert).not.toHaveBeenCalled();
    expect(safetyTx.ruleVersion.create).not.toHaveBeenCalled();
    expect(prisma.ruleConfig.upsert).not.toHaveBeenCalled();
    expect(prisma.ruleVersion.create).not.toHaveBeenCalled();
  });

  it('keeps strict local captain config validation before safety evaluation', async () => {
    const { service, profitSafetyService } = createHarness();
    const enabledConfig = {
      ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
      enabled: true,
      scope: {
        ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG.scope,
        productIds: ['product-1'],
      },
    };

    await expect(service.updateSettings({
      ...enabledConfig,
      perOrderCommission: { ...enabledConfig.perOrderCommission, indirectRate: 0.02 },
    }, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(profitSafetyService.withCandidateChange).not.toHaveBeenCalled();
  });
});
