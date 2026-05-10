import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    service: new AdminAfterSaleService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      afterSaleRefundService as any,
      afterSaleStatusHistory as any,
    ),
  };
}

describe('AdminAfterSaleService.arbitrate', () => {
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
    const { service, afterSaleRefundService } = makeService(tx);

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
    };
    const { service, afterSaleRefundService } = makeService(tx);

    await service.retryRefund('after-sale-1', 'refund-1', 'admin-1');

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
