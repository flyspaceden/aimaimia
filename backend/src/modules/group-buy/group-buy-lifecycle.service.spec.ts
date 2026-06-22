import { GroupBuyLifecycleService } from './group-buy-lifecycle.service';

describe('GroupBuyLifecycleService', () => {
  const expiredAt = new Date('2026-06-01T00:00:00.000Z');
  const futureAt = new Date('2099-06-01T00:00:00.000Z');

  const buildInstance = (overrides: Record<string, any> = {}) => ({
    id: 'instance_1',
    status: 'QUALIFICATION_PENDING',
    initiatorOrderId: 'order_1',
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
        update: jest.fn().mockResolvedValue({ id: 'instance_1' }),
      },
      groupBuyCode: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ code: 'GB12345678' }),
        update: jest.fn().mockResolvedValue({ id: 'code_1' }),
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

  it('does not generate a share code before the return window expires', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
      buildInstance({
        initiatorOrder: {
          ...buildInstance().initiatorOrder,
          returnWindowExpiresAt: futureAt,
        },
      }),
    );

    const result = await service.evaluateInitiatorOrder('order_1');

    expect(result).toEqual({ status: 'WAITING_RETURN_WINDOW' });
    expect(tx.groupBuyCode.create).not.toHaveBeenCalled();
  });

  it('generates an active share code after the return window expires with no after-sale', async () => {
    const { tx, service } = buildPrisma();

    const result = await service.evaluateInitiatorOrder('order_1');

    expect(result).toEqual({ status: 'ACTIVATED', code: expect.any(String) });
    expect(tx.groupBuyCode.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        instanceId: 'instance_1',
        code: expect.any(String),
        status: 'ACTIVE',
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: expect.objectContaining({
        status: 'SHARING',
        activatedAt: expect.any(Date),
      }),
    }));
  });

  it('invalidates qualification when the own order has any after-sale or refund record', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
      buildInstance({
        initiatorOrder: {
          ...buildInstance().initiatorOrder,
          afterSaleRequests: [{ id: 'as_1' }],
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

  it('abandons the current pending qualification', async () => {
    const { prisma, tx, service } = buildPrisma();
    tx.groupBuyInstance.findFirst.mockResolvedValueOnce({
      id: 'instance_1',
      status: 'QUALIFICATION_PENDING',
    });

    const result = await service.abandonCurrent('user_1');

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result).toEqual({ status: 'ABANDONED' });
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: expect.objectContaining({
        status: 'QUALIFICATION_ABANDONED',
        abandonedAt: expect.any(Date),
      }),
    }));
  });

  it('terminates the current sharing instance and disables its code', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findFirst.mockResolvedValueOnce({
      id: 'instance_1',
      status: 'SHARING',
      code: { id: 'code_1', status: 'ACTIVE' },
    });
    const result = await service.terminateCurrent('user_1');

    expect(result).toEqual({ status: 'TERMINATED' });
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'instance_1' },
      data: expect.objectContaining({
        status: 'TERMINATED',
        terminatedAt: expect.any(Date),
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
});
