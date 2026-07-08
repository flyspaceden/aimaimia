import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CAPTAIN_SEAFOOD_PROGRAM_CODE } from './captain.constants';
import { CaptainRelationService } from './captain-relation.service';

function createHarness(txOverrides: Record<string, any> = {}) {
  const tx = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
    },
    captainProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({
        userId: 'captain-1',
        captainCode: 'SEA001',
        status: 'ACTIVE',
      }),
      create: jest.fn().mockResolvedValue({
        id: 'profile-1',
        userId: 'user-1',
        captainCode: 'SEA001',
      }),
    },
    captainAccount: {
      upsert: jest.fn().mockResolvedValue({ id: 'account-1', userId: 'user-1' }),
    },
    captainRelation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'relation-1',
        buyerUserId: 'buyer-1',
        directCaptainUserId: 'captain-1',
        indirectCaptainUserId: null,
      }),
    },
    ...txOverrides,
  };
  const prisma = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  return {
    tx,
    prisma,
    service: new CaptainRelationService(prisma as any),
  };
}

describe('CaptainRelationService', () => {
  it('creates an active captain profile and an independent captain account', async () => {
    const { prisma, tx, service } = createHarness();

    await expect(
      service.createCaptainProfile({
        userId: 'user-1',
        captainCode: 'SEA001',
        displayName: '海鲜团长',
        adminUserId: 'admin-1',
      }),
    ).resolves.toMatchObject({
      userId: 'user-1',
      captainCode: 'SEA001',
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.captainProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        captainCode: 'SEA001',
        displayName: '海鲜团长',
        createdByAdminId: 'admin-1',
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
      }),
    });
    expect(tx.captainAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_programCode: {
          userId: 'user-1',
          programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        },
      },
      create: expect.objectContaining({
        userId: 'user-1',
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
      }),
    }));
  });

  it('rejects creating a captain profile for a missing user', async () => {
    const { service } = createHarness({
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.createCaptainProfile({ userId: 'missing-user', captainCode: 'SEA001' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('binds buyer to direct and indirect captains without storing a third level', async () => {
    const { tx, service } = createHarness({
      captainRelation: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            buyerUserId: 'captain-1',
            directCaptainUserId: 'captain-root',
            indirectCaptainUserId: 'ignored-third-level',
          }),
        create: jest.fn().mockResolvedValue({
          buyerUserId: 'buyer-1',
          directCaptainUserId: 'captain-1',
          indirectCaptainUserId: 'captain-root',
        }),
      },
    });

    await expect(
      service.bindBuyerToCaptainCode({
        buyerUserId: 'buyer-1',
        captainCode: 'SEA001',
        source: 'LANDING',
      }),
    ).resolves.toMatchObject({
      buyerUserId: 'buyer-1',
      directCaptainUserId: 'captain-1',
      indirectCaptainUserId: 'captain-root',
    });

    expect(tx.captainRelation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buyerUserId: 'buyer-1',
        directCaptainUserId: 'captain-1',
        indirectCaptainUserId: 'captain-root',
        programCode: CAPTAIN_SEAFOOD_PROGRAM_CODE,
        codeUsed: 'SEA001',
        source: 'LANDING',
      }),
    });
  });

  it('does not silently switch a buyer already bound to another captain', async () => {
    const { service } = createHarness({
      captainRelation: {
        findUnique: jest.fn().mockResolvedValue({
          buyerUserId: 'buyer-1',
          directCaptainUserId: 'captain-other',
        }),
      },
    });

    await expect(
      service.bindBuyerToCaptainCode({ buyerUserId: 'buyer-1', captainCode: 'SEA001' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects binding through an inactive or missing captain code', async () => {
    const { service } = createHarness({
      captainProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.bindBuyerToCaptainCode({ buyerUserId: 'buyer-1', captainCode: 'BAD001' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
