import { BadRequestException } from '@nestjs/common';
import { AfterSaleOperatorType } from '@prisma/client';
import { AfterSaleRefundService } from './after-sale-refund.service';
import { AfterSaleStatusHistoryService } from './after-sale-status-history.service';

describe('AfterSaleRefundService', () => {
  const tx = {
    afterSaleRequest: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refund: {
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    refundStatusHistory: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    afterSaleStatusHistory: {
      create: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
    $executeRaw: jest.fn(),
  };

  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
    refund: {
      findMany: jest.fn(),
    },
  };

  const paymentService = {
    initiateRefund: jest.fn(),
  };

  const rewardService = {
    voidRewardsForOrder: jest.fn(),
    checkAndMarkOrderRefunded: jest.fn(),
  };

  const inboxService = {
    send: jest.fn(),
  };

  let service: AfterSaleRefundService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'RECEIVED_BY_SELLER',
      refundAmount: 88,
      reason: '质量问题',
    });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
    });
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.afterSaleRequest.update.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundId: 'refund_001',
    });
    tx.refund.update.mockResolvedValue({
      id: 'refund_001',
      status: 'REFUNDED',
    });
    tx.refund.updateMany.mockResolvedValue({ count: 1 });
    tx.refundStatusHistory.findFirst.mockResolvedValue(null);
    tx.order.findUnique.mockResolvedValue({ userId: 'user_001' });
    paymentService.initiateRefund.mockResolvedValue({
      success: true,
      providerRefundId: 'provider_refund_001',
      message: 'OK',
    });
    rewardService.voidRewardsForOrder.mockResolvedValue(undefined);
    rewardService.checkAndMarkOrderRefunded.mockResolvedValue(undefined);
    inboxService.send.mockResolvedValue(undefined);

    service = new AfterSaleRefundService(
      prisma as any,
      paymentService as any,
      rewardService as any,
      new AfterSaleStatusHistoryService(),
      inboxService as any,
    );
  });

  it('startRefund/createOrGetRefund uses stable AS-afterSaleId merchantRefundNo and upserts by merchantRefundNo', async () => {
    tx.refund.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'refund_001',
        orderId: 'order_001',
        afterSaleId: 'as_001',
        amount: 88,
        status: 'REFUNDING',
        merchantRefundNo: 'AS-as_001',
        providerRefundId: null,
      });

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(tx.refund.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { merchantRefundNo: 'AS-as_001' },
      create: expect.objectContaining({
        afterSaleId: 'as_001',
        merchantRefundNo: 'AS-as_001',
        status: 'REFUNDING',
      }),
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        refundId: 'refund_001',
      }),
    }));
    expect(paymentService.initiateRefund).toHaveBeenCalledWith(
      'order_001',
      88,
      'AS-as_001',
    );
  });

  it('startRefund does not call provider again for an existing REFUNDING refund', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
      reason: '质量问题',
    });

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        refundId: 'refund_001',
      }),
    }));
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('handleRefundFailure sets Refund FAILED and keeps AfterSaleRequest out of FAILED', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      status: 'REFUNDING',
    });

    await service.handleRefundFailure('refund_001', '支付宝失败');

    expect(tx.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001', status: 'REFUNDING' },
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(tx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'refund_001',
        fromStatus: 'REFUNDING',
        toStatus: 'FAILED',
        remark: '支付宝失败',
      }),
    }));
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });

  it('handleRefundFailure does not downgrade a REFUNDED refund', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      status: 'REFUNDED',
    });

    await service.handleRefundFailure('refund_001', '迟到的失败回调');

    expect(tx.refund.update).not.toHaveBeenCalled();
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
    expect(tx.refundStatusHistory.create).not.toHaveBeenCalled();
  });

  it('handleRefundSuccess sets REFUNDED statuses and creates AfterSaleStatusHistory once', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDING',
      providerRefundId: null,
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.refund.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'refund_001' },
      data: expect.objectContaining({
        status: 'REFUNDED',
        providerRefundId: 'provider_refund_001',
      }),
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDED',
        refundId: 'refund_001',
      }),
    }));
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        afterSaleId: 'as_001',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDED',
      }),
    }));
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
    expect(rewardService.checkAndMarkOrderRefunded).toHaveBeenCalledWith('order_001');
  });

  it('handleRefundSuccess closes after-sale when refund is already REFUNDED but request is still REFUNDING', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDED',
      providerRefundId: 'provider_existing',
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.refund.update).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({
        status: 'REFUNDED',
        refundId: 'refund_001',
      }),
    }));
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
    expect(rewardService.checkAndMarkOrderRefunded).toHaveBeenCalledWith('order_001');
  });

  it('handleRefundSuccess does nothing when refund and after-sale are already REFUNDED', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      afterSaleId: 'as_001',
      orderId: 'order_001',
      amount: 88,
      status: 'REFUNDED',
      providerRefundId: 'provider_existing',
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDED',
      refundAmount: 88,
      refundId: 'refund_001',
    });

    await service.handleRefundSuccess('refund_001', 'provider_refund_001');

    expect(tx.refund.update).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalled();
    expect(tx.afterSaleStatusHistory.create).not.toHaveBeenCalled();
    expect(rewardService.voidRewardsForOrder).not.toHaveBeenCalled();
  });

  it('startRefund routes existing REFUNDED refund through success closure', async () => {
    tx.refund.findUnique
      .mockResolvedValueOnce({
        id: 'refund_001',
        afterSaleId: 'as_001',
        orderId: 'order_001',
        amount: 88,
        status: 'REFUNDED',
        merchantRefundNo: 'AS-as_001',
        providerRefundId: 'provider_existing',
      })
      .mockResolvedValueOnce({
        id: 'refund_001',
        afterSaleId: 'as_001',
        orderId: 'order_001',
        amount: 88,
        status: 'REFUNDED',
        merchantRefundNo: 'AS-as_001',
        providerRefundId: 'provider_existing',
      });
    tx.refund.upsert.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      afterSaleId: 'as_001',
      amount: 88,
      status: 'REFUNDED',
      merchantRefundNo: 'AS-as_001',
      providerRefundId: 'provider_existing',
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      orderId: 'order_001',
      userId: 'user_001',
      status: 'REFUNDING',
      refundAmount: 88,
      refundId: 'refund_001',
      reason: '质量问题',
    });

    await service.startRefund('as_001', { type: AfterSaleOperatorType.SYSTEM });

    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        afterSaleId: 'as_001',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDED',
      }),
    }));
    expect(rewardService.voidRewardsForOrder).toHaveBeenCalledWith('order_001');
  });

  it('retryRefund uses refund-retry advisory lock and 30-second throttle through RefundStatusHistory', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      afterSaleId: 'as_001',
    });

    await service.retryRefund('refund_001', {
      type: AfterSaleOperatorType.ADMIN,
      id: 'admin_001',
    });

    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.refundStatusHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        refundId: 'refund_001',
        toStatus: 'REFUNDING',
        remark: { contains: '手动重试' },
        createdAt: { gte: expect.any(Date) },
      }),
    }));
    expect(tx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'refund_001',
        fromStatus: 'FAILED',
        toStatus: 'REFUNDING',
        remark: '管理员手动重试开始',
        operatorId: 'admin_001',
      }),
    }));
    expect(paymentService.initiateRefund).toHaveBeenCalledWith(
      'order_001',
      88,
      'AS-as_001',
    );
  });

  it('retryRefund rejects recent manual retry within 30 seconds', async () => {
    tx.refund.findUnique.mockResolvedValue({
      id: 'refund_001',
      orderId: 'order_001',
      amount: 88,
      status: 'FAILED',
      merchantRefundNo: 'AS-as_001',
      afterSaleId: 'as_001',
    });
    tx.refundStatusHistory.findFirst.mockResolvedValue({ id: 'hist_recent' });

    await expect(service.retryRefund('refund_001', {
      type: AfterSaleOperatorType.ADMIN,
      id: 'admin_001',
    })).rejects.toThrow(BadRequestException);

    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });
});
