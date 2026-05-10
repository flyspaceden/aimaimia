import { PaymentService } from './payment.service';

describe('PaymentService.initiateRefund', () => {
  const makeService = () => {
    const prisma = {
      payment: { findFirst: jest.fn() },
      order: { findUnique: jest.fn() },
      checkoutSession: { findUnique: jest.fn() },
      refund: { findMany: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    const alipayService = {
      isAvailable: jest.fn(),
      refund: jest.fn(),
    };
    const service = new PaymentService(
      prisma as any,
      {} as any,
      alipayService as any,
    );
    return { service, prisma, alipayService };
  };

  it('无 Payment 行时通过 CheckoutSession 支付凭据发起支付宝退款', async () => {
    const { service, prisma, alipayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ checkoutSessionId: 'cs1' });
    prisma.checkoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'MO-123',
      paymentChannel: 'ALIPAY',
      status: 'COMPLETED',
    });
    alipayService.isAvailable.mockReturnValue(true);
    alipayService.refund.mockResolvedValue({ success: true, message: 'OK' });

    const result = await service.initiateRefund('o1', 65, 'AUTO-CANCEL-o1');

    expect(result).toEqual({
      success: true,
      providerRefundId: 'AUTO-CANCEL-o1',
      message: 'OK',
    });
    expect(alipayService.refund).toHaveBeenCalledWith({
      merchantOrderNo: 'MO-123',
      refundAmount: 65,
      merchantRefundNo: 'AUTO-CANCEL-o1',
      refundReason: '用户退款',
    });
  });

  it('拒绝使用非已支付 CheckoutSession 发起退款', async () => {
    const { service, prisma, alipayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ checkoutSessionId: 'cs-expired' });
    prisma.checkoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'MO-EXPIRED',
      paymentChannel: 'ALIPAY',
      status: 'EXPIRED',
    });

    const result = await service.initiateRefund('o1', 65, 'AUTO-CANCEL-o1');

    expect(result.success).toBe(false);
    expect(result.message).toContain('结算会话状态异常');
    expect(alipayService.refund).not.toHaveBeenCalled();
  });

  it('自动退款补偿在调用渠道退款前抢 refund-retry 锁并记录重试开始', async () => {
    const { service, prisma } = makeService();
    jest.spyOn(service, 'initiateRefund').mockResolvedValue({
      success: false,
      message: '渠道失败',
    });
    prisma.refund.findMany.mockResolvedValue([{
      id: 'r1',
      orderId: 'o1',
      amount: 65,
      status: 'REFUNDING',
      merchantRefundNo: 'AUTO-CANCEL-o1',
      updatedAt: new Date(Date.now() - 600_000),
    }]);
    const claimTx = {
      $executeRaw: jest.fn(),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          status: 'REFUNDING',
          orderId: 'o1',
          amount: 65,
          merchantRefundNo: 'AUTO-CANCEL-o1',
        }),
      },
      refundStatusHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const updateTx = {
      refund: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', status: 'REFUNDING' }),
        update: jest.fn(),
      },
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(claimTx))
      .mockImplementationOnce(async (callback: any) => callback(updateTx));

    await service.retryStaleAutoRefunds();

    expect(claimTx.$executeRaw).toHaveBeenCalled();
    expect(claimTx.refundStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        refundId: 'r1',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDING',
        remark: '自动退款补偿重试开始',
      }),
    }));
    expect(service.initiateRefund).toHaveBeenCalledWith('o1', 65, 'AUTO-CANCEL-o1');
  });

  it('AS 退款渠道成功后闭环异常不会把退款改回 FAILED', async () => {
    const { service, prisma } = makeService();
    const afterSaleRefundService = {
      handleRefundSuccess: jest.fn().mockRejectedValue(new Error('closure failed')),
      handleRefundFailure: jest.fn(),
    };
    service.setAfterSaleRefundService(afterSaleRefundService as any);
    jest.spyOn(service, 'initiateRefund').mockResolvedValue({
      success: true,
      providerRefundId: 'provider_as_001',
      message: 'OK',
    });
    prisma.refund.findMany.mockResolvedValue([{
      id: 'r_as_1',
      orderId: 'o1',
      amount: 65,
      status: 'REFUNDING',
      merchantRefundNo: 'AS-as_001',
      updatedAt: new Date(Date.now() - 600_000),
    }]);
    const claimTx = {
      $executeRaw: jest.fn(),
      refund: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r_as_1',
          status: 'REFUNDING',
          orderId: 'o1',
          amount: 65,
          merchantRefundNo: 'AS-as_001',
        }),
      },
      refundStatusHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(claimTx));

    await service.retryStaleAutoRefunds();

    expect(afterSaleRefundService.handleRefundSuccess).toHaveBeenCalledWith(
      'r_as_1',
      'provider_as_001',
    );
    expect(afterSaleRefundService.handleRefundFailure).not.toHaveBeenCalled();
  });
});
