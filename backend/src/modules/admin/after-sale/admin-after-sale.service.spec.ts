import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AdminAfterSaleController } from './admin-after-sale.controller';
import { AdminAfterSaleService } from './admin-after-sale.service';

function makeService(tx: any) {
  const transactionState = { completed: false };
  const afterSaleRefundService = {
    startRefund: jest.fn().mockImplementation(() => {
      if (!transactionState.completed) {
        throw new Error('startRefund must run after transaction commit');
      }
      return Promise.resolve(undefined);
    }),
    retryRefund: jest.fn().mockResolvedValue({ id: 'refund-1', status: 'FAILED' }),
  };
  const afterSaleStatusHistory = {
    create: jest.fn().mockResolvedValue({ id: 'history-1' }),
  };
  const notificationService = {
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: any) => {
      const result = await callback(tx);
      expect(afterSaleRefundService.startRefund).not.toHaveBeenCalled();
      transactionState.completed = true;
      return result;
    }),
  };

  return {
    prisma,
    afterSaleRefundService,
    afterSaleStatusHistory,
    notificationService,
    service: new AdminAfterSaleService(
      prisma as any,
      {} as any,
      {} as any,
      notificationService as any,
      afterSaleRefundService as any,
      afterSaleStatusHistory as any,
      { queryRoutes: jest.fn().mockResolvedValue(null) } as any,
    ),
  };
}

describe('AdminAfterSaleService.arbitrate', () => {
  it('emits returnRequired when admin approves a request that requires buyer return shipping', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-admin-return',
            status: 'PENDING_ARBITRATION',
            arbitrationSourceStatus: null,
            arbitrationSource: null,
            afterSaleType: 'QUALITY_RETURN',
            requiresReturn: true,
            userId: 'buyer-1',
            orderId: 'order-1',
            order: { items: [{ companyId: 'company-1' }] },
          })
          .mockResolvedValueOnce({
            id: 'after-sale-admin-return',
            status: 'APPROVED',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, notificationService } = makeService(tx);

    await service.arbitrate(
      'after-sale-admin-return',
      { status: 'APPROVED', reason: '平台仲裁支持买家退货' } as any,
      'admin-1',
    );

    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'afterSale.returnRequired',
        aggregateType: 'afterSale',
        aggregateId: 'after-sale-admin-return',
        idempotencyKey: 'after-sale:after-sale-admin-return:return-required',
        actor: { kind: 'admin', id: 'admin-1' },
        payload: expect.objectContaining({
          afterSaleId: 'after-sale-admin-return',
          userId: 'buyer-1',
          orderId: 'order-1',
          companyId: 'company-1',
        }),
      }),
      tx,
    );
  });

  it('actively intervenes on current SELLER_REJECTED_RETURN return type to REFUNDING and starts refund after transaction', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-current-return',
            status: 'SELLER_REJECTED_RETURN',
            arbitrationSourceStatus: null,
            arbitrationSource: null,
            afterSaleType: 'NO_REASON_RETURN',
            requiresReturn: true,
            order: { items: [] },
          })
          .mockResolvedValueOnce({
            id: 'after-sale-current-return',
            status: 'REFUNDING',
          })
          .mockResolvedValueOnce({
            id: 'after-sale-current-return',
            status: 'REFUNDING',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, afterSaleRefundService, notificationService } = makeService(tx);

    await service.arbitrate(
      'after-sale-current-return',
      { status: 'APPROVED', reason: '平台主动支持退款' } as any,
      'admin-1',
    );

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'after-sale-current-return', status: 'SELLER_REJECTED_RETURN' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        reviewerId: 'admin-1',
        reviewNote: '平台主动支持退款',
      }),
    });
    expect(afterSaleRefundService.startRefund).toHaveBeenCalledWith(
      'after-sale-current-return',
      { type: 'ADMIN', id: 'admin-1' },
    );
    expect(notificationService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'afterSale.arbitrationResolved',
        aggregateType: 'afterSale',
        aggregateId: 'after-sale-current-return',
        idempotencyKey: 'after-sale:after-sale-current-return:arbitration-resolved',
        actor: { kind: 'admin', id: 'admin-1' },
        payload: expect.objectContaining({
          afterSaleId: 'after-sale-current-return',
        }),
      }),
      tx,
    );
  });

  it('actively intervenes on current SELLER_REJECTED_RETURN exchange type to RECEIVED_BY_SELLER', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-current-exchange',
            status: 'SELLER_REJECTED_RETURN',
            arbitrationSourceStatus: null,
            arbitrationSource: null,
            afterSaleType: 'NO_REASON_EXCHANGE',
            requiresReturn: true,
            order: { items: [] },
          })
          .mockResolvedValueOnce({
            id: 'after-sale-current-exchange',
            status: 'RECEIVED_BY_SELLER',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, afterSaleRefundService } = makeService(tx);

    await service.arbitrate(
      'after-sale-current-exchange',
      { status: 'APPROVED', reason: '平台主动支持换货' } as any,
      'admin-1',
    );

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'after-sale-current-exchange', status: 'SELLER_REJECTED_RETURN' },
      data: expect.objectContaining({
        status: 'RECEIVED_BY_SELLER',
        reviewerId: 'admin-1',
        reviewNote: '平台主动支持换货',
      }),
    });
    expect(afterSaleRefundService.startRefund).not.toHaveBeenCalled();
  });

  it('routes buyer-escalated seller rejected return arbitration directly to refunding for return types', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            status: 'PENDING_ARBITRATION',
            arbitrationSourceStatus: 'SELLER_REJECTED_RETURN',
            arbitrationSource: 'BUYER',
            afterSaleType: 'QUALITY_RETURN',
            requiresReturn: true,
            order: { items: [] },
          })
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            status: 'REFUNDING',
          })
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            status: 'REFUNDING',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const {
      service,
      afterSaleRefundService,
      afterSaleStatusHistory,
    } = makeService(tx);

    await service.arbitrate(
      'after-sale-1',
      { status: 'APPROVED', reason: '平台仲裁支持买家' } as any,
      'admin-1',
    );

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'after-sale-1', status: 'PENDING_ARBITRATION' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        reviewerId: 'admin-1',
        reviewNote: '平台仲裁支持买家',
      }),
    });
    expect(afterSaleStatusHistory.create).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        afterSaleId: 'after-sale-1',
        fromStatus: 'PENDING_ARBITRATION',
        toStatus: 'REFUNDING',
        operatorType: 'ADMIN',
        operatorId: 'admin-1',
      }),
    );
    expect(afterSaleRefundService.startRefund).toHaveBeenCalledWith(
      'after-sale-1',
      { type: 'ADMIN', id: 'admin-1' },
    );
  });

  it('keeps legacy arbitrationSource fallback for seller rejected return rows', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-legacy',
            status: 'PENDING_ARBITRATION',
            arbitrationSourceStatus: null,
            arbitrationSource: 'SELLER_REJECTED_RETURN',
            afterSaleType: 'NO_REASON_RETURN',
            requiresReturn: true,
            order: { items: [] },
          })
          .mockResolvedValueOnce({
            id: 'after-sale-legacy',
            status: 'REFUNDING',
          })
          .mockResolvedValueOnce({
            id: 'after-sale-legacy',
            status: 'REFUNDING',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service, afterSaleRefundService } = makeService(tx);

    await service.arbitrate(
      'after-sale-legacy',
      { status: 'APPROVED', reason: '旧数据仲裁支持买家' } as any,
      'admin-1',
    );

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'after-sale-legacy', status: 'PENDING_ARBITRATION' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        reviewNote: '旧数据仲裁支持买家',
      }),
    });
    expect(afterSaleRefundService.startRefund).toHaveBeenCalledWith(
      'after-sale-legacy',
      { type: 'ADMIN', id: 'admin-1' },
    );
  });

  it('routes buyer-escalated seller rejected exchange arbitration to RECEIVED_BY_SELLER', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-escalated-exchange',
            status: 'PENDING_ARBITRATION',
            arbitrationSourceStatus: 'SELLER_REJECTED_RETURN',
            arbitrationSource: 'BUYER',
            afterSaleType: 'QUALITY_EXCHANGE',
            requiresReturn: true,
            order: { items: [] },
          })
          .mockResolvedValueOnce({
            id: 'after-sale-escalated-exchange',
            status: 'RECEIVED_BY_SELLER',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { service } = makeService(tx);

    await service.arbitrate(
      'after-sale-escalated-exchange',
      { status: 'APPROVED', reason: '平台仲裁支持换货' } as any,
      'admin-1',
    );

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'after-sale-escalated-exchange', status: 'PENDING_ARBITRATION' },
      data: expect.objectContaining({
        status: 'RECEIVED_BY_SELLER',
        reviewerId: 'admin-1',
        reviewNote: '平台仲裁支持换货',
      }),
    });
  });
});

describe('AdminAfterSaleService.findAll', () => {
  it('filters pending manual review requests', async () => {
    const tx = {
      afterSaleRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const { service } = makeService(tx);

    await service.findAll(1, 20, undefined, undefined, undefined, undefined, 'pending');

    expect(tx.afterSaleRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          manualReviewReason: { not: null },
          manualReviewResolvedAt: null,
        },
      }),
    );
    expect(tx.afterSaleRequest.count).toHaveBeenCalledWith({
      where: {
        manualReviewReason: { not: null },
        manualReviewResolvedAt: null,
      },
    });
  });

  it('returns linked refund summary so admin rows can expose retry action', async () => {
    const tx = {
      afterSaleRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'after-sale-1',
            order: null,
            orderItem: null,
            user: null,
            refundByRefundId: null,
            refundByAfterSaleId: {
              id: 'refund-1',
              amount: 88,
              status: 'FAILED',
              merchantRefundNo: 'AS-after-sale-1',
              providerRefundId: null,
            },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const { service } = makeService(tx);

    const result = await service.findAll();

    expect(tx.afterSaleRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          refundByAfterSaleId: {
            select: {
              id: true,
              amount: true,
              status: true,
              merchantRefundNo: true,
              providerRefundId: true,
            },
          },
          refundByRefundId: {
            select: {
              id: true,
              amount: true,
              status: true,
              merchantRefundNo: true,
              providerRefundId: true,
            },
          },
        }),
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        refund: {
          id: 'refund-1',
          amount: 88,
          status: 'FAILED',
          merchantRefundNo: 'AS-after-sale-1',
          providerRefundId: null,
        },
      }),
    );
    expect((result.items[0] as any).refundByAfterSaleId).toBeUndefined();
    expect((result.items[0] as any).refundByRefundId).toBeUndefined();
  });

  it('prefers afterSaleId-linked refund when dual refund relations disagree', async () => {
    const tx = {
      afterSaleRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'after-sale-1',
            order: null,
            orderItem: null,
            user: null,
            refundByRefundId: {
              id: 'refund-legacy',
              amount: 66,
              status: 'REFUNDING',
              merchantRefundNo: 'LEGACY-after-sale-1',
              providerRefundId: null,
            },
            refundByAfterSaleId: {
              id: 'refund-canonical',
              amount: 88,
              status: 'FAILED',
              merchantRefundNo: 'AS-after-sale-1',
              providerRefundId: 'provider-1',
            },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const { service } = makeService(tx);

    const result = await service.findAll();

    expect(result.items[0].refund).toEqual({
      id: 'refund-canonical',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-after-sale-1',
      providerRefundId: 'provider-1',
    });
  });
});

describe('AdminAfterSaleService.findById', () => {
  it('returns refund and status histories for admin detail', async () => {
    const refundCreatedAt = new Date('2026-05-10T01:00:00.000Z');
    const statusCreatedAt = new Date('2026-05-10T00:30:00.000Z');
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'after-sale-1',
          order: { id: 'order-1', addressSnapshot: null },
          orderItem: null,
          user: null,
          returnWaybillNo: 'SF123456789',
          replacementWaybillNo: null,
          refundByRefundId: null,
          refundByAfterSaleId: {
            id: 'refund-1',
            amount: 88,
            status: 'FAILED',
            merchantRefundNo: 'AS-after-sale-1',
            providerRefundId: null,
            statusHistory: [
              {
                id: 'refund-history-1',
                fromStatus: 'REFUNDING',
                toStatus: 'FAILED',
                remark: '渠道返回失败',
                createdAt: refundCreatedAt,
              },
            ],
          },
          statusHistory: [
            {
              id: 'status-history-1',
              fromStatus: 'APPROVED',
              toStatus: 'REFUNDING',
              reason: '卖家确认退款',
              operatorType: 'SELLER',
              createdAt: statusCreatedAt,
            },
          ],
        }),
      },
    };
    const { service } = makeService(tx);

    const result = await service.findById('after-sale-1');

    expect(tx.afterSaleRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'after-sale-1' },
      include: expect.objectContaining({
        refundByAfterSaleId: {
          select: expect.objectContaining({
            id: true,
            statusHistory: expect.objectContaining({
              orderBy: { createdAt: 'asc' },
            }),
          }),
        },
        refundByRefundId: {
          select: expect.objectContaining({
            id: true,
            statusHistory: expect.objectContaining({
              orderBy: { createdAt: 'asc' },
            }),
          }),
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            reason: true,
            operatorType: true,
            createdAt: true,
          },
        },
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        refund: expect.objectContaining({
          id: 'refund-1',
          status: 'FAILED',
          merchantRefundNo: 'AS-after-sale-1',
        }),
        refundHistory: [
          {
            id: 'refund-history-1',
            fromStatus: 'REFUNDING',
            toStatus: 'FAILED',
            remark: '渠道返回失败',
            createdAt: refundCreatedAt,
          },
        ],
        statusHistory: [
          {
            id: 'status-history-1',
            fromStatus: 'APPROVED',
            toStatus: 'REFUNDING',
            reason: '卖家确认退款',
            operatorType: 'SELLER',
            createdAt: statusCreatedAt,
          },
        ],
      }),
    );
    expect((result as any).refundByAfterSaleId).toBeUndefined();
    expect((result as any).refundByRefundId).toBeUndefined();
  });
});

describe('AdminAfterSaleService.retryRefund', () => {
  it('delegates to AfterSaleRefundService.retryRefund with ADMIN operator', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'after-sale-1',
          refundId: 'refund-1',
          refundByAfterSaleId: null,
        }),
      },
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refund-1',
          amount: 88,
          status: 'REFUNDING',
          merchantRefundNo: 'AS-after-sale-1',
          providerRefundId: null,
        }),
      },
    };
    const { service, afterSaleRefundService } = makeService(tx);

    const result = await service.retryRefund('after-sale-1', 'refund-1', 'admin-1');

    expect(tx.afterSaleRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'after-sale-1' },
      select: {
        id: true,
        refundId: true,
        refundByAfterSaleId: { select: { id: true } },
      },
    });
    expect(afterSaleRefundService.retryRefund).toHaveBeenCalledWith(
      'refund-1',
      { type: 'ADMIN', id: 'admin-1' },
    );
    expect(tx.refund.findUnique).toHaveBeenCalledWith({
      where: { id: 'refund-1' },
      select: {
        id: true,
        amount: true,
        status: true,
        merchantRefundNo: true,
        providerRefundId: true,
      },
    });
    expect(result).toEqual({
      id: 'refund-1',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-after-sale-1',
      providerRefundId: null,
    });
    expect((result as any).rawNotifyPayload).toBeUndefined();
  });

  it('rejects refund retry when refund does not belong to the after-sale request', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'after-sale-1',
          refundId: 'refund-owned',
          refundByAfterSaleId: null,
        }),
      },
    };
    const { service, afterSaleRefundService } = makeService(tx);

    await expect(
      service.retryRefund('after-sale-1', 'refund-other', 'admin-1'),
    ).rejects.toThrow(BadRequestException);
    expect(afterSaleRefundService.retryRefund).not.toHaveBeenCalled();
  });

  it('rejects refund retry for missing after-sale request without delegating', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const { service, afterSaleRefundService } = makeService(tx);

    await expect(
      service.retryRefund('missing-after-sale', 'refund-1', 'admin-1'),
    ).rejects.toThrow(NotFoundException);
    expect(afterSaleRefundService.retryRefund).not.toHaveBeenCalled();
  });
});

describe('AdminAfterSaleService.getTimeline', () => {
  it('returns status history sorted ascending for admin visibility', async () => {
    const createdAt = new Date('2026-05-10T00:00:00.000Z');
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'after-sale-1' }),
      },
      afterSaleStatusHistory: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'history-1',
            fromStatus: 'REQUESTED',
            toStatus: 'APPROVED',
            reason: '平台仲裁通过',
            operatorType: 'ADMIN',
            createdAt,
          },
        ]),
      },
    };
    const { service } = makeService(tx);

    await expect(service.getTimeline('after-sale-1')).resolves.toEqual({
      items: [
        {
          id: 'history-1',
          fromStatus: 'REQUESTED',
          toStatus: 'APPROVED',
          reason: '平台仲裁通过',
          operatorType: 'ADMIN',
          createdAt,
        },
      ],
    });
    expect(tx.afterSaleRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'after-sale-1' },
      select: { id: true },
    });
    expect(tx.afterSaleStatusHistory.findMany).toHaveBeenCalledWith({
      where: { afterSaleId: 'after-sale-1' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        operatorType: true,
        createdAt: true,
      },
    });
  });

  it('rejects timeline requests for missing after-sale request', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      afterSaleStatusHistory: {
        findMany: jest.fn(),
      },
    };
    const { service } = makeService(tx);

    await expect(service.getTimeline('missing-after-sale')).rejects.toThrow(NotFoundException);
    expect(tx.afterSaleStatusHistory.findMany).not.toHaveBeenCalled();
  });
});

describe('AdminAfterSaleController timeline route', () => {
  it('declares GET :id/timeline before GET :id and delegates to service', async () => {
    const methodNames = Object.getOwnPropertyNames(AdminAfterSaleController.prototype);
    const timelineIndex = methodNames.indexOf('getTimeline');
    const detailIndex = methodNames.indexOf('findById');

    expect(timelineIndex).toBeGreaterThan(-1);
    expect(timelineIndex).toBeLessThan(detailIndex);
    expect(Reflect.getMetadata(
      PATH_METADATA,
      (AdminAfterSaleController.prototype as any).getTimeline,
    )).toBe(':id/timeline');

    const service = {
      getTimeline: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new AdminAfterSaleController(service as any);

    await expect((controller as any).getTimeline('after-sale-1')).resolves.toEqual({ items: [] });
    expect(service.getTimeline).toHaveBeenCalledWith('after-sale-1');
  });
});
