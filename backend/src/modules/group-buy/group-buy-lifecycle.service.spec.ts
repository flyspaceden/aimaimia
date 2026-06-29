import { ConflictException } from '@nestjs/common';

import { GroupBuyLifecycleService } from './group-buy-lifecycle.service';

describe('GroupBuyLifecycleService', () => {
  const expiredAt = new Date('2026-06-01T00:00:00.000Z');
  const futureAt = new Date('2099-06-01T00:00:00.000Z');

  const buildInstance = (overrides: Record<string, any> = {}) => ({
    id: 'instance_1',
    status: 'QUALIFICATION_PENDING',
    initiatorOrderId: 'order_1',
    activityId: 'activity_1',
    activity: {
      id: 'activity_1',
      status: 'ACTIVE',
      startAt: null,
      endAt: futureAt,
      deletedAt: null,
    },
    code: null,
    initiatorOrder: {
      id: 'order_1',
      status: 'RECEIVED',
      returnWindowExpiresAt: expiredAt,
      afterSaleRequests: [],
      refunds: [],
    },
    ...overrides,
  });

  const buildPrisma = () => {
    const tx = {
      groupBuyInstance: {
        findUnique: jest.fn().mockResolvedValue(buildInstance()),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'instance_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      groupBuyCode: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ code: 'GB12345678' }),
        update: jest.fn().mockResolvedValue({ id: 'code_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      groupBuyActivity: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      groupBuyReferral: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
      groupBuyInstance: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      groupBuyReferral: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const rebateService = {
      releaseReferralByOrderIfValid: jest.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
    };
    return {
      prisma,
      tx,
      rebateService,
      service: new (GroupBuyLifecycleService as any)(prisma, rebateService) as GroupBuyLifecycleService,
    };
  };

  it('activates a paid group-buy instance immediately without return-window wait', async () => {
    const eligibleStatuses = ['PAID', 'SHIPPED', 'DELIVERED', 'RECEIVED'];

    for (const status of eligibleStatuses) {
      const { tx, service } = buildPrisma();
      tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
        buildInstance({
          id: `instance_${status}`,
          initiatorOrder: {
            ...buildInstance().initiatorOrder,
            status,
            returnWindowExpiresAt: futureAt,
          },
        }),
      );

      const result = await service.evaluateInitiatorOrder('order_1');

      expect(result).toEqual({ status: 'ACTIVATED', code: expect.any(String) });
      expect(tx.groupBuyCode.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          instanceId: `instance_${status}`,
          code: expect.any(String),
          status: 'ACTIVE',
        }),
      }));
      expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: `instance_${status}` },
        data: expect.objectContaining({
          status: 'SHARING',
          activatedAt: expect.any(Date),
        }),
      }));
    }
  });

  it('uses an existing active code when a pending paid instance already has one', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
      buildInstance({
        code: {
          id: 'code_1',
          code: 'EXISTING123',
          status: 'ACTIVE',
        },
        initiatorOrder: {
          ...buildInstance().initiatorOrder,
          status: 'PAID',
          returnWindowExpiresAt: futureAt,
        },
      }),
    );

    const result = await service.evaluateInitiatorOrder('order_1');

    expect(result).toEqual({ status: 'ACTIVATED', code: 'EXISTING123' });
    expect(tx.groupBuyCode.findUnique).not.toHaveBeenCalled();
    expect(tx.groupBuyCode.create).not.toHaveBeenCalled();
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: expect.objectContaining({
        status: 'SHARING',
      }),
    }));
  });

  it('expires pending qualification instead of generating a share code after the activity ends', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
      buildInstance({
        activity: {
          id: 'activity_1',
          status: 'ACTIVE',
          startAt: null,
          endAt: new Date('2026-05-31T23:59:59.000Z'),
          deletedAt: null,
        },
      }),
    );

    const result = await service.evaluateInitiatorOrder('order_1', expiredAt);

    expect(result).toEqual({ status: 'EXPIRED' });
    expect(tx.groupBuyCode.create).not.toHaveBeenCalled();
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: expect.objectContaining({
        status: 'EXPIRED',
        expiredAt,
        invalidReason: 'ACTIVITY_ENDED',
      }),
    }));
  });

  it('keeps a paid qualification pending while the activity is temporarily paused', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
      buildInstance({
        activity: {
          id: 'activity_1',
          status: 'PAUSED',
          startAt: null,
          endAt: futureAt,
          deletedAt: null,
        },
      }),
    );

    const result = await service.evaluateInitiatorOrder('order_1', expiredAt);

    expect(result).toEqual({ status: 'WAITING_ACTIVITY_ACTIVE' });
    expect(tx.groupBuyCode.create).not.toHaveBeenCalled();
    expect(tx.groupBuyInstance.update).not.toHaveBeenCalled();
  });

  it('invalidates only when the paid order has refund or after-sale records', async () => {
    const invalidCases = [
      { afterSaleRequests: [{ id: 'as_1' }], refunds: [] },
      { afterSaleRequests: [], refunds: [{ id: 'refund_1' }] },
    ];

    for (const invalidCase of invalidCases) {
      const { tx, service } = buildPrisma();
      tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
        buildInstance({
          initiatorOrder: {
            ...buildInstance().initiatorOrder,
            status: 'PAID',
            returnWindowExpiresAt: futureAt,
            ...invalidCase,
          },
        }),
      );

      const result = await service.evaluateInitiatorOrder('order_1');

      expect(result).toEqual({ status: 'INVALIDATED' });
      expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'instance_1' },
        data: expect.objectContaining({
          status: 'QUALIFICATION_INVALID',
          invalidReason: 'OWN_ORDER_AFTER_SALE_OR_REFUND',
        }),
      }));
      expect(tx.groupBuyCode.create).not.toHaveBeenCalled();
    }
  });

  it('evaluates both initiator qualification and referred purchase rebate after receive', async () => {
    const { service, rebateService } = buildPrisma();

    const result = await service.evaluateOrderAfterReceive('order_1', expiredAt);

    expect(result).toEqual({
      initiator: expect.objectContaining({ status: 'ACTIVATED' }),
      referral: { status: 'NOT_FOUND' },
    });
    expect(rebateService.releaseReferralByOrderIfValid).toHaveBeenCalledWith('order_1', expiredAt);
  });

  it('skips abandoned qualifications', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
      buildInstance({ status: 'QUALIFICATION_ABANDONED' }),
    );

    const result = await service.evaluateInitiatorOrder('order_1');

    expect(result).toEqual({ status: 'SKIPPED' });
    expect(tx.groupBuyCode.create).not.toHaveBeenCalled();
  });

  it('abandons the specified pending qualification for the current user', async () => {
    const { prisma, tx, service } = buildPrisma();
    tx.groupBuyInstance.findFirst.mockResolvedValueOnce({
      id: 'instance_1',
      status: 'QUALIFICATION_PENDING',
    });

    const result = await service.abandonCurrent('user_1', 'instance_1');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.groupBuyInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'instance_1',
        userId: 'user_1',
        status: 'QUALIFICATION_PENDING',
      },
    }));
    expect(result).toEqual({ status: 'ABANDONED' });
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: expect.objectContaining({
        status: 'QUALIFICATION_ABANDONED',
        abandonedAt: expect.any(Date),
      }),
    }));
  });

  it('rejects abandon when the instance id does not match the current user', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findFirst.mockResolvedValueOnce(null);

    await expect(service.abandonCurrent('user_1', 'other_instance'))
      .rejects.toBeInstanceOf(ConflictException);

    expect(tx.groupBuyInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'other_instance',
        userId: 'user_1',
        status: 'QUALIFICATION_PENDING',
      },
    }));
    expect(tx.groupBuyInstance.update).not.toHaveBeenCalled();
  });

  it('rejects terminate when there is no active sharing instance', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findFirst.mockResolvedValueOnce(null);

    await expect(service.terminateCurrent('user_1'))
      .rejects.toBeInstanceOf(ConflictException);

    expect(tx.groupBuyInstance.update).not.toHaveBeenCalled();
    expect(tx.groupBuyCode.update).not.toHaveBeenCalled();
  });

  it('terminates the current sharing instance and disables its code', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findFirst.mockResolvedValueOnce({
      id: 'instance_1',
      status: 'SHARING',
      code: { id: 'code_1', status: 'ACTIVE' },
    });
    tx.groupBuyReferral.findMany.mockResolvedValueOnce([
      { id: 'referral_1', instanceId: 'instance_1' },
      { id: 'referral_2', instanceId: 'instance_1' },
    ]);
    tx.groupBuyReferral.updateMany.mockResolvedValueOnce({ count: 2 });

    const result = await service.terminateCurrent('user_1');

    expect(result).toEqual({ status: 'TERMINATED', referralsInvalidated: 2 });
    expect(tx.groupBuyReferral.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        instanceId: 'instance_1',
        status: 'CANDIDATE',
      },
      select: { id: true },
    }));
    expect(tx.groupBuyReferral.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { in: ['referral_1', 'referral_2'] },
        status: 'CANDIDATE',
      },
      data: expect.objectContaining({
        status: 'INVALID',
        invalidReason: 'USER_TERMINATED',
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: expect.objectContaining({
        status: 'TERMINATED',
        terminatedAt: expect.any(Date),
        candidateCount: 0,
      }),
    }));
    expect(tx.groupBuyCode.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'code_1' },
      data: expect.objectContaining({
        status: 'DISABLED',
        disabledAt: expect.any(Date),
      }),
    }));
  });

  it('rescans matured group-buy orders after the return window expires', async () => {
    const { prisma, service, rebateService } = buildPrisma();
    prisma.groupBuyInstance.findMany.mockResolvedValueOnce([
      { initiatorOrderId: 'own_order_1' },
      { initiatorOrderId: 'own_order_2' },
    ]);
    prisma.groupBuyReferral.findMany.mockResolvedValueOnce([
      { referredOrderId: 'referred_order_1' },
    ]);
    const evaluateInitiatorSpy = jest
      .spyOn(service, 'evaluateInitiatorOrder')
      .mockResolvedValue({ status: 'ACTIVATED', code: 'GB12345678' } as any);

    const result = await (service as any).processMaturedOrders(expiredAt, 20);

    expect(prisma.groupBuyInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'QUALIFICATION_PENDING' }),
      take: 20,
    }));
    expect(prisma.groupBuyReferral.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'CANDIDATE' }),
      take: 20,
    }));
    expect(evaluateInitiatorSpy).toHaveBeenCalledWith('own_order_1', expiredAt);
    expect(evaluateInitiatorSpy).toHaveBeenCalledWith('own_order_2', expiredAt);
    expect(rebateService.releaseReferralByOrderIfValid).toHaveBeenCalledWith('referred_order_1', expiredAt);
    expect(result).toEqual({ initiatorScanned: 2, referralScanned: 1 });
  });

  it('expires ended active or paused activities and invalidates only unfinished sharing records', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyActivity.findMany.mockResolvedValueOnce([
      { id: 'activity_ended_1' },
    ]);
    tx.groupBuyReferral.findMany.mockResolvedValueOnce([
      { id: 'referral_1', instanceId: 'instance_1' },
      { id: 'referral_2', instanceId: 'instance_1' },
      { id: 'referral_3', instanceId: 'instance_2' },
    ]);
    tx.groupBuyActivity.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.groupBuyCode.updateMany.mockResolvedValueOnce({ count: 2 });
    tx.groupBuyInstance.updateMany.mockResolvedValueOnce({ count: 4 });
    tx.groupBuyReferral.updateMany.mockResolvedValueOnce({ count: 3 });

    const result = await (service as any).expireEndedActivities(expiredAt, 20);

    expect(tx.groupBuyActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['ACTIVE', 'PAUSED'] },
        deletedAt: null,
        endAt: { lte: expiredAt },
      }),
      take: 20,
    }));
    expect(tx.groupBuyActivity.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { in: ['activity_ended_1'] },
      },
      data: expect.objectContaining({
        status: 'ENDED',
        updatedAt: expiredAt,
      }),
    }));
    expect(tx.groupBuyCode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'ACTIVE',
        instance: { activityId: { in: ['activity_ended_1'] } },
      },
      data: expect.objectContaining({
        status: 'EXPIRED',
        expiredAt,
      }),
    }));
    expect(tx.groupBuyInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        activityId: { in: ['activity_ended_1'] },
        status: { in: ['QUALIFICATION_PENDING', 'SHARING'] },
      },
      data: expect.objectContaining({
        status: 'EXPIRED',
        expiredAt,
        invalidReason: 'ACTIVITY_ENDED',
      }),
    }));
    expect(tx.groupBuyReferral.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { in: ['referral_1', 'referral_2', 'referral_3'] },
        status: 'CANDIDATE',
      },
      data: expect.objectContaining({
        status: 'INVALID',
        invalidReason: 'ACTIVITY_ENDED',
        invalidatedAt: expiredAt,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: { candidateCount: { decrement: 2 } },
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_2' },
      data: { candidateCount: { decrement: 1 } },
    }));
    expect(result).toEqual({
      activitiesExpired: 1,
      codesExpired: 2,
      instancesExpired: 4,
      referralsInvalidated: 3,
    });
  });
});
