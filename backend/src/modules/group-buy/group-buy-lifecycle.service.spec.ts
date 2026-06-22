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
        update: jest.fn().mockResolvedValue({ id: 'instance_1' }),
      },
      groupBuyCode: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ code: 'GB12345678' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
    };
    return { prisma, tx, service: new (GroupBuyLifecycleService as any)(prisma) as GroupBuyLifecycleService };
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

  it('skips abandoned qualifications', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce(
      buildInstance({ status: 'QUALIFICATION_ABANDONED' }),
    );

    const result = await service.evaluateInitiatorOrder('order_1');

    expect(result).toEqual({ status: 'SKIPPED' });
    expect(tx.groupBuyCode.create).not.toHaveBeenCalled();
  });
});
