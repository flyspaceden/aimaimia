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
});
