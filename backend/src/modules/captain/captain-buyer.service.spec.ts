import { DEFAULT_CAPTAIN_SEAFOOD_CONFIG, CAPTAIN_SEAFOOD_PROGRAM_CODE } from './captain.constants';
import { CaptainBuyerService } from './captain-buyer.service';

function createHarness(overrides: Record<string, any> = {}) {
  const prisma = {
    captainProfile: {
      findFirst: jest.fn().mockResolvedValue({
        userId: 'captain-1',
        captainCode: 'SEA001',
        displayName: '海鲜团长',
        status: 'ACTIVE',
        user: {
          id: 'captain-1',
          buyerNo: 'AIMM202607080001',
          profile: { nickname: '林团长', avatarUrl: 'https://img.test/avatar.png' },
        },
      }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'profile-1',
        userId: 'captain-1',
        captainCode: 'SEA001',
        displayName: '海鲜团长',
        status: 'ACTIVE',
        user: {
          id: 'captain-1',
          buyerNo: 'AIMM202607080001',
          profile: { nickname: '林团长', avatarUrl: null },
        },
      }),
    },
    captainAccount: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 'captain-1',
        balance: 120,
        frozen: 30,
        withdrawn: 10,
        clawback: 0,
      }),
    },
    captainMonthlyMetric: {
      findFirst: jest.fn().mockResolvedValue({
        captainUserId: 'captain-1',
        month: '2026-07',
        personalGmv: 2800,
        teamGmv: 25000,
        qualified: true,
        qualifiedTier: 'BASE',
      }),
    },
    captainRelation: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    captainCommissionLedger: {
      findMany: jest.fn().mockResolvedValue([{ id: 'ledger-1', userId: 'captain-1', amount: 9 }]),
      count: jest.fn().mockResolvedValue(1),
    },
    captainOrderAttribution: {
      findMany: jest.fn().mockResolvedValue([{ id: 'attr-1', directCaptainUserId: 'captain-1' }]),
      count: jest.fn().mockResolvedValue(1),
    },
    ...overrides.prisma,
  };
  const configService = {
    getConfig: jest.fn().mockResolvedValue(DEFAULT_CAPTAIN_SEAFOOD_CONFIG),
    ...overrides.configService,
  };
  const relationService = {
    bindBuyerToCaptainCode: jest.fn().mockResolvedValue({
      id: 'relation-1',
      buyerUserId: 'buyer-1',
      directCaptainUserId: 'captain-1',
      indirectCaptainUserId: null,
      codeUsed: 'SEA001',
    }),
    ...overrides.relationService,
  };
  return {
    prisma,
    configService,
    relationService,
    service: new CaptainBuyerService(prisma as any, configService as any, relationService as any),
  };
}

describe('CaptainBuyerService', () => {
  it('returns public landing info for an active captain code', async () => {
    const { prisma, service } = createHarness();

    await expect(service.getLanding('sea001')).resolves.toMatchObject({
      code: 'SEA001',
      valid: true,
      programName: DEFAULT_CAPTAIN_SEAFOOD_CONFIG.programName,
      captain: {
        userId: 'captain-1',
        captainCode: 'SEA001',
        displayName: '海鲜团长',
        nickname: '林团长',
        buyerNo: 'AIMM202607080001',
      },
    });
    expect(prisma.captainProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        captainCode: 'SEA001',
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        status: 'ACTIVE',
      },
    }));
  });

  it('returns invalid landing info instead of throwing for a missing code', async () => {
    const { service } = createHarness({
      prisma: {
        captainProfile: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      },
    });

    await expect(service.getLanding('bad001')).resolves.toMatchObject({
      code: 'BAD001',
      valid: false,
      captain: null,
      reason: '团长码无效或已停用',
    });
  });

  it('binds the current buyer through the independent captain relation path', async () => {
    const { relationService, service } = createHarness({
      configService: {
        getConfig: jest.fn().mockResolvedValue({
          ...DEFAULT_CAPTAIN_SEAFOOD_CONFIG,
          enabled: true,
        }),
      },
    });

    await expect(service.bindByCode('buyer-1', 'sea001')).resolves.toMatchObject({
      success: true,
      relation: {
        buyerUserId: 'buyer-1',
        directCaptainUserId: 'captain-1',
        codeUsed: 'SEA001',
      },
    });
    expect(relationService.bindBuyerToCaptainCode).toHaveBeenCalledWith({
      buyerUserId: 'buyer-1',
      captainCode: 'SEA001',
      source: 'APP_CAPTAIN_LINK',
    });
  });

  it('rejects buyer binding while the captain program is disabled', async () => {
    const { relationService, service } = createHarness();

    await expect(service.bindByCode('buyer-1', 'sea001')).rejects.toThrow('团长经营暂未开放');
    expect(relationService.bindBuyerToCaptainCode).not.toHaveBeenCalled();
  });

  it('returns my active captain profile, account, metric, and bound relation context', async () => {
    const { prisma, service } = createHarness({
      prisma: {
        captainRelation: {
          findUnique: jest.fn().mockResolvedValue({
            buyerUserId: 'captain-1',
            directCaptainUserId: 'root-captain',
          }),
        },
      },
    });

    await expect(service.getMyCaptainProfile('captain-1')).resolves.toMatchObject({
      isCaptain: true,
      profile: { captainCode: 'SEA001', status: 'ACTIVE' },
      account: { balance: 120, frozen: 30 },
      metric: { teamGmv: 25000, qualifiedTier: 'BASE' },
      boundRelation: { directCaptainUserId: 'root-captain' },
    });
    expect(prisma.captainProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'captain-1' },
    }));
  });

  it('lists only the current captain reward ledgers', async () => {
    const { prisma, service } = createHarness();

    await expect(service.listMyLedgers('captain-1', 2, 10)).resolves.toMatchObject({
      items: [{ id: 'ledger-1' }],
      total: 1,
      page: 2,
      pageSize: 10,
    });
    expect(prisma.captainCommissionLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'captain-1',
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        deletedAt: null,
      },
      skip: 10,
      take: 10,
    }));
  });

  it('lists captain order progress for direct and indirect captain roles only', async () => {
    const { prisma, service } = createHarness();

    await expect(service.listMyOrders('captain-1', 1, 20)).resolves.toMatchObject({
      items: [{ id: 'attr-1' }],
      total: 1,
    });
    expect(prisma.captainOrderAttribution.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        OR: [
          { directCaptainUserId: 'captain-1' },
          { indirectCaptainUserId: 'captain-1' },
        ],
      },
    }));
  });
});
