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
    const wechatPayService = {
      isAvailable: jest.fn(),
      refund: jest.fn(),
    };
    const service = new PaymentService(
      prisma as any,
      {} as any,
      alipayService as any,
      undefined,
      undefined,
      undefined,
      wechatPayService as any,
    );
    return { service, prisma, alipayService, wechatPayService };
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
      pending: false,
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

  it('WECHAT_PAY SDK 未初始化时返回失败且不调用微信退款', async () => {
    const { service, prisma, wechatPayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue({
      orderId: 'o1',
      channel: 'WECHAT_PAY',
      merchantOrderNo: 'WX-ORDER-1',
      amount: 120,
    });
    wechatPayService.isAvailable.mockReturnValue(false);

    const result = await service.initiateRefund('o1', 65, 'WX-REFUND-1');

    expect(result).toEqual({
      success: false,
      pending: false,
      message: '微信支付 SDK 未初始化',
    });
    expect(wechatPayService.refund).not.toHaveBeenCalled();
  });

  it('WECHAT_PAY Payment 行退款成功时返回商户退款单号且 pending false', async () => {
    const { service, prisma, wechatPayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue({
      orderId: 'o1',
      channel: 'WECHAT_PAY',
      merchantOrderNo: 'WX-ORDER-1',
      amount: 120,
    });
    wechatPayService.isAvailable.mockReturnValue(true);
    wechatPayService.refund.mockResolvedValue({
      success: true,
      pending: false,
      providerRefundId: 'wx-provider-refund-1',
      message: '退款成功',
    });

    const result = await service.initiateRefund('o1', 65, 'WX-REFUND-1');

    expect(result).toEqual({
      success: true,
      pending: false,
      providerRefundId: 'WX-REFUND-1',
      message: '退款成功',
    });
    expect(wechatPayService.refund).toHaveBeenCalledWith({
      outTradeNo: 'WX-ORDER-1',
      outRefundNo: 'WX-REFUND-1',
      refundAmount: 65,
      totalAmount: 120,
      reason: '用户退款',
    });
  });

  it('WECHAT_PAY Payment 行退款受理中时返回 pending true', async () => {
    const { service, prisma, wechatPayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue({
      orderId: 'o1',
      channel: 'WECHAT_PAY',
      merchantOrderNo: 'WX-ORDER-1',
      amount: 120,
    });
    wechatPayService.isAvailable.mockReturnValue(true);
    wechatPayService.refund.mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'wx-provider-refund-1',
      message: '退款受理中，等待结果通知',
    });

    const result = await service.initiateRefund('o1', 65, 'WX-REFUND-1');

    expect(result).toEqual({
      success: true,
      pending: true,
      providerRefundId: 'WX-REFUND-1',
      message: '退款受理中，等待结果通知',
    });
    expect(wechatPayService.refund).toHaveBeenCalledWith({
      outTradeNo: 'WX-ORDER-1',
      outRefundNo: 'WX-REFUND-1',
      refundAmount: 65,
      totalAmount: 120,
      reason: '用户退款',
    });
  });

  it('WECHAT_PAY 无 Payment 行时通过 CheckoutSession 支付凭据发起退款并用退款金额作为总额兜底', async () => {
    const { service, prisma, wechatPayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ checkoutSessionId: 'cs1' });
    prisma.checkoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'WX-ORDER-SESSION-1',
      paymentChannel: 'WECHAT_PAY',
      status: 'COMPLETED',
    });
    wechatPayService.isAvailable.mockReturnValue(true);
    wechatPayService.refund.mockResolvedValue({
      success: true,
      pending: false,
      message: '退款成功',
    });

    const result = await service.initiateRefund('o1', 65, 'WX-REFUND-SESSION-1');

    expect(result).toEqual({
      success: true,
      pending: false,
      providerRefundId: 'WX-REFUND-SESSION-1',
      message: '退款成功',
    });
    expect(wechatPayService.refund).toHaveBeenCalledWith({
      outTradeNo: 'WX-ORDER-SESSION-1',
      outRefundNo: 'WX-REFUND-SESSION-1',
      refundAmount: 65,
      totalAmount: 65,
      reason: '用户退款',
    });
  });

  it('非支付宝和微信支付退款渠道仍抛未实现异常', async () => {
    const { service, prisma } = makeService();
    prisma.payment.findFirst.mockResolvedValue({
      orderId: 'o1',
      channel: 'UNIONPAY',
      merchantOrderNo: 'UP-ORDER-1',
      amount: 120,
    });

    await expect(service.initiateRefund('o1', 65, 'UP-REFUND-1'))
      .rejects
      .toThrow('退款渠道 UNIONPAY 暂未接入');
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
    expect(claimTx.refundStatusHistory.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        refundId: 'r1',
        toStatus: 'REFUNDING',
        remark: { contains: '重试开始' },
        createdAt: { gte: expect.any(Date) },
      }),
    }));
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

  it('AUTO-CANCEL 退款补偿成功后返还消费积分抵扣', async () => {
    const { service, prisma } = makeService();
    const rewardDeductionService = {
      refundDeduction: jest.fn(),
    };
    service.setRewardDeductionService(rewardDeductionService as any);
    jest.spyOn(service, 'initiateRefund').mockResolvedValue({
      success: true,
      providerRefundId: 'provider_auto_001',
      message: 'OK',
    });
    prisma.refund.findMany.mockResolvedValue([{
      id: 'r_auto_1',
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
          id: 'r_auto_1',
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
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'r_auto_1', status: 'REFUNDING' })
          .mockResolvedValueOnce({
            id: 'r_auto_1',
            merchantRefundNo: 'AUTO-CANCEL-o1',
            order: {
              id: 'o1',
              checkoutSessionId: 'cs1',
              goodsAmount: 60,
              discountAmount: 8,
            },
          }),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { order: { goodsAmount: 60 } },
        ]),
      },
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue({
          deductionGroupId: 'DG-1',
          goodsAmount: 60,
          discountAmount: 8,
        }),
      },
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(claimTx))
      .mockImplementationOnce(async (callback: any) => callback(updateTx));

    await service.retryStaleAutoRefunds();

    expect(rewardDeductionService.refundDeduction).toHaveBeenCalledWith(updateTx, expect.objectContaining({
      refundId: 'r_auto_1',
      orderId: 'o1',
      originalGoodsAmount: 60,
      originalGoodsRefundAmount: 60,
      originalDeductAmount: 8,
      deductionGroupId: 'DG-1',
      isFinalRefund: true,
    }));
  });

  it('自动退款补偿遇到微信退款 pending 时保持 REFUNDING 且不触发售后成功闭环', async () => {
    const { service, prisma } = makeService();
    const afterSaleRefundService = {
      handleRefundSuccess: jest.fn(),
      handleRefundFailure: jest.fn(),
    };
    service.setAfterSaleRefundService(afterSaleRefundService as any);
    jest.spyOn(service, 'initiateRefund').mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'AUTO-CANCEL-o1',
      message: '退款受理中，等待结果通知',
    });
    const updateAutoRefundRecord = jest
      .spyOn(service as any, 'updateAutoRefundRecord')
      .mockResolvedValue(true);
    jest
      .spyOn(service as any, 'claimAutoRefundRetry')
      .mockResolvedValueOnce({
        orderId: 'o1',
        amount: 65,
        merchantRefundNo: 'AUTO-CANCEL-o1',
      })
      .mockResolvedValueOnce({
        orderId: 'o2',
        amount: 32,
        merchantRefundNo: 'AS-as_001',
      });
    prisma.refund.findMany.mockResolvedValue([
      {
        id: 'r_auto_1',
        orderId: 'o1',
        amount: 65,
        status: 'REFUNDING',
        merchantRefundNo: 'AUTO-CANCEL-o1',
        updatedAt: new Date(Date.now() - 600_000),
      },
      {
        id: 'r_as_1',
        orderId: 'o2',
        amount: 32,
        status: 'REFUNDING',
        merchantRefundNo: 'AS-as_001',
        updatedAt: new Date(Date.now() - 600_000),
      },
    ]);

    await service.retryStaleAutoRefunds();

    expect(updateAutoRefundRecord).not.toHaveBeenCalledWith(expect.objectContaining({
      toStatus: 'REFUNDED',
    }));
    expect(afterSaleRefundService.handleRefundSuccess).not.toHaveBeenCalled();
    expect(afterSaleRefundService.handleRefundFailure).not.toHaveBeenCalled();
  });
});
