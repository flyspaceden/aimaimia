import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CAPTAIN_SEAFOOD_PROGRAM_CODE } from './captain.constants';
import { CaptainApplicationService } from './captain-application.service';

const submitDto = {
  realName: '林小海',
  contact: 'wx:linxiaohai',
  city: '杭州',
  communityScale: 'BETWEEN_50_200',
  expectedMonthlyGmv: 'BETWEEN_10000_30000',
  resourceTypes: ['WECHAT_GROUP', 'COMMUNITY'],
  promotionPlan: '小区团购和老客复购结合推广',
  seafoodExperience: 'SOLD_BEFORE',
  complianceAccepted: true,
};

function createHarness(overrides: Record<string, any> = {}) {
  const tx: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'buyer-1',
        buyerNo: 'AIMM202607080001',
        status: 'ACTIVE',
        profile: { nickname: '小海', city: '杭州' },
        authIdentities: [{ provider: 'PHONE', identifier: '13800000000', verified: true }],
        memberProfile: { tier: 'NORMAL' },
      }),
    },
    captainProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    captainApplication: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({
        id: 'application-1',
        userId: 'buyer-1',
        status: 'PENDING',
      }),
      create: jest.fn().mockResolvedValue({
        id: 'application-1',
        userId: 'buyer-1',
        status: 'PENDING',
        ...submitDto,
      }),
      update: jest.fn().mockResolvedValue({
        id: 'application-1',
        userId: 'buyer-1',
        status: 'APPROVED',
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    captainRelation: {
      findUnique: jest.fn().mockResolvedValue({
        directCaptainUserId: 'captain-1',
        directCaptain: {
          id: 'captain-1',
          buyerNo: 'AIMM202607080002',
          profile: { nickname: '上级团长' },
        },
      }),
    },
    order: {
      count: jest.fn().mockResolvedValue(3),
      aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 588 } }),
    },
    refund: {
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 88 } }),
    },
    ...overrides.tx,
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
    captainProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    captainApplication: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ...overrides.prisma,
  };
  const relationService = {
    createCaptainProfileInTx: jest.fn().mockResolvedValue({
      userId: 'buyer-1',
      captainCode: 'SEA001',
      status: 'ACTIVE',
    }),
    ...overrides.relationService,
  };

  return {
    tx,
    prisma,
    relationService,
    service: new CaptainApplicationService(prisma, relationService as any),
  };
}

describe('CaptainApplicationService', () => {
  it('submits a pending captain application and captures the audit snapshot', async () => {
    const { prisma, tx, service } = createHarness();

    await expect(service.submit('buyer-1', submitDto)).resolves.toMatchObject({
      id: 'application-1',
      status: 'PENDING',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.captainApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'buyer-1',
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        status: 'PENDING',
        realName: '林小海',
        complianceAccepted: true,
        resourceTypes: ['WECHAT_GROUP', 'COMMUNITY'],
        systemSnapshot: expect.objectContaining({
          buyerNo: 'AIMM202607080001',
          phone: '13800000000',
          isVip: false,
          orderCount: 3,
          paidAmount: 588,
          refundCount: 1,
          refundAmount: 88,
          refundRate: expect.any(Number),
          boundCaptain: expect.objectContaining({
            userId: 'captain-1',
            buyerNo: 'AIMM202607080002',
          }),
        }),
      }),
    });
  });

  it('blocks duplicate submit while a pending application exists', async () => {
    const { service, tx } = createHarness({
      tx: {
        captainApplication: {
          findFirst: jest.fn().mockResolvedValue({ id: 'application-1', status: 'PENDING' }),
          create: jest.fn(),
        },
      },
    });

    await expect(service.submit('buyer-1', submitDto)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.captainApplication.create).not.toHaveBeenCalled();
  });

  it('allows resubmission after a previous rejected application', async () => {
    const { tx, service } = createHarness({
      tx: {
        captainApplication: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            id: 'application-2',
            status: 'PENDING',
          }),
        },
      },
    });

    await expect(service.submit('buyer-1', submitDto)).resolves.toMatchObject({
      id: 'application-2',
      status: 'PENDING',
    });
    expect(tx.captainApplication.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'buyer-1',
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        status: 'PENDING',
      },
    });
  });

  it('returns already-captain status for active captains', async () => {
    const { service } = createHarness({
      prisma: {
        captainProfile: {
          findUnique: jest.fn().mockResolvedValue({
            userId: 'captain-1',
            status: 'ACTIVE',
            captainCode: 'SEA001',
          }),
        },
      },
    });

    await expect(service.getMyApplication('captain-1')).resolves.toMatchObject({
      isCaptain: true,
      canSubmit: false,
      profile: { captainCode: 'SEA001' },
    });
  });

  it('approves pending application and opens captain profile in the same transaction', async () => {
    const { prisma, tx, relationService, service } = createHarness();

    await expect(
      service.approve('application-1', 'admin-1', {
        captainCode: 'SEA001',
        displayName: '林团长',
      }),
    ).resolves.toMatchObject({
      status: 'APPROVED',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(relationService.createCaptainProfileInTx).toHaveBeenCalledWith(
      tx,
      {
        userId: 'buyer-1',
        captainCode: 'SEA001',
        displayName: '林团长',
        adminUserId: 'admin-1',
      },
    );
    expect(tx.captainApplication.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: expect.objectContaining({
        status: 'APPROVED',
        reviewedByAdminId: 'admin-1',
        reviewedAt: expect.any(Date),
        captainProfileUserId: 'buyer-1',
      }),
      include: expect.any(Object),
    });
  });

  it('rejects only pending applications and requires a reason', async () => {
    const { tx, service } = createHarness({
      tx: {
        captainApplication: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'application-1',
            userId: 'buyer-1',
            status: 'PENDING',
          }),
          update: jest.fn().mockResolvedValue({
            id: 'application-1',
            userId: 'buyer-1',
            status: 'REJECTED',
          }),
        },
      },
    });

    await expect(service.reject('application-1', 'admin-1', { reason: '资料不完整' })).resolves.toMatchObject({
      status: 'REJECTED',
    });
    expect(tx.captainApplication.update).toHaveBeenCalledWith({
      where: { id: 'application-1' },
      data: expect.objectContaining({
        status: 'REJECTED',
        reviewedByAdminId: 'admin-1',
        rejectReason: '资料不完整',
      }),
      include: expect.any(Object),
    });

    await expect(service.reject('application-1', 'admin-1', { reason: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws not found for missing applications during review', async () => {
    const { service } = createHarness({
      tx: {
        captainApplication: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      },
    });

    await expect(service.approve('missing', 'admin-1', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});
