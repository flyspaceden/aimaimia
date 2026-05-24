import { PaymentService } from './payment.service';

describe('PaymentService.initiateRefund', () => {
  const makeService = () => {
    const prisma = {
      payment: { findFirst: jest.fn(), findUnique: jest.fn() },
      order: { findUnique: jest.fn() },
      checkoutSession: { findUnique: jest.fn() },
      refund: { findMany: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
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
    const couponService = {
      restoreCouponsForOrder: jest.fn(),
    };
    const service = new PaymentService(
      prisma as any,
      {} as any,
      alipayService as any,
      undefined,
      couponService as any,
      undefined,
      wechatPayService as any,
    );
    return { service, prisma, alipayService, wechatPayService, couponService };
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

  it('WECHAT_PAY 无 Payment 行时通过 CheckoutSession expectedTotal 作为原交易总额发起退款', async () => {
    const { service, prisma, wechatPayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ checkoutSessionId: 'cs1' });
    prisma.checkoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'WX-ORDER-SESSION-1',
      paymentChannel: 'WECHAT_PAY',
      status: 'COMPLETED',
      expectedTotal: 120,
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
    expect(prisma.checkoutSession.findUnique).toHaveBeenCalledWith({
      where: { id: 'cs1' },
      select: {
        merchantOrderNo: true,
        paymentChannel: true,
        status: true,
        expectedTotal: true,
      },
    });
    expect(wechatPayService.refund).toHaveBeenCalledWith({
      outTradeNo: 'WX-ORDER-SESSION-1',
      outRefundNo: 'WX-REFUND-SESSION-1',
      refundAmount: 65,
      totalAmount: 120,
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

  it('AUTO-CANCEL 退款补偿成功后恢复平台红包并返还消费积分抵扣', async () => {
    const { service, prisma, couponService } = makeService();
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
      order: {
        findMany: jest.fn().mockResolvedValue([{ id: 'o1' }]),
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
    expect(couponService.restoreCouponsForOrder).toHaveBeenCalledWith('o1', updateTx);
  });

  it('AUTO-CANCEL 自动退款最终 REFUNDED 即使未注入积分服务也恢复平台红包', async () => {
    const { service, prisma, couponService } = makeService();
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
          { orderId: 'o1', status: 'REFUNDED' },
        ]),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([{ id: 'o1' }]),
      },
      checkoutSession: { findUnique: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(updateTx));

    const result = await (service as any).updateAutoRefundRecord({
      refundId: 'r_auto_1',
      toStatus: 'REFUNDED',
      fromStatuses: ['REFUNDING'],
      providerRefundId: 'provider_auto_001',
      remark: '自动退款成功',
    });

    expect(result).toBe(true);
    expect(updateTx.refund.update).toHaveBeenCalledWith({
      where: { id: 'r_auto_1' },
      data: {
        status: 'REFUNDED',
        providerRefundId: 'provider_auto_001',
        rawNotifyPayload: undefined,
      },
    });
    expect(couponService.restoreCouponsForOrder).toHaveBeenCalledWith('o1', updateTx);
  });

  it('AUTO-CANCEL 多订单 session 未全部 REFUNDED 时不提前恢复平台红包', async () => {
    const { service, prisma, couponService } = makeService();
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
              goodsAmount: 30,
              discountAmount: 8,
            },
          }),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { orderId: 'o1', status: 'REFUNDED' },
          { orderId: 'o2', status: 'REFUNDING' },
        ]),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]),
      },
      checkoutSession: { findUnique: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(updateTx));

    const result = await (service as any).updateAutoRefundRecord({
      refundId: 'r_auto_1',
      toStatus: 'REFUNDED',
      fromStatuses: ['REFUNDING'],
      providerRefundId: 'provider_auto_001',
      remark: '自动退款成功',
    });

    expect(result).toBe(true);
    expect(couponService.restoreCouponsForOrder).not.toHaveBeenCalled();
  });

  it('自动退款补偿遇到微信退款 pending 时保存 providerRefundId 且保持 REFUNDING', async () => {
    const { service, prisma, couponService } = makeService();
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
    ]);

    await service.retryStaleAutoRefunds();

    expect(updateAutoRefundRecord).toHaveBeenCalledWith(expect.objectContaining({
      refundId: 'r_auto_1',
      toStatus: 'REFUNDING',
      fromStatuses: ['REFUNDING'],
      providerRefundId: 'AUTO-CANCEL-o1',
      remark: '微信退款已受理，等待渠道通知',
    }));
    expect(afterSaleRefundService.handleRefundSuccess).not.toHaveBeenCalled();
    expect(afterSaleRefundService.handleRefundFailure).not.toHaveBeenCalled();
    expect(couponService.restoreCouponsForOrder).not.toHaveBeenCalled();
  });

  it('支付回调自动退款遇到微信 pending 时不写 REFUNDED 且不恢复抵扣', async () => {
    const { service, prisma, couponService } = makeService();
    const rewardDeductionService = {
      refundDeduction: jest.fn(),
    };
    service.setRewardDeductionService(rewardDeductionService as any);
    jest.spyOn(service, 'initiateRefund').mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'AUTO-WX-ORDER-1',
      message: '退款受理中，等待结果通知',
    });
    const updateAutoRefundRecord = jest
      .spyOn(service as any, 'updateAutoRefundRecord')
      .mockResolvedValue(true);

    prisma.payment.findUnique.mockResolvedValue({
      id: 'pay1',
      orderId: 'o1',
      amount: 65,
      status: 'PENDING',
      merchantOrderNo: 'WX-ORDER-1',
      order: { id: 'o1' },
    });
    const tx = {
      payment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'o1', status: 'CANCELED' }),
      },
      refund: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r_auto_1' }),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(tx));

    await service.handlePaymentCallback({
      merchantOrderNo: 'WX-ORDER-1',
      providerTxnId: 'wx_txn_1',
      status: 'SUCCESS',
      paidAt: '2026-05-23T00:00:00.000Z',
      rawPayload: { channel: 'WECHAT_PAY' },
      skipSignatureVerification: true,
    });

    expect(updateAutoRefundRecord).toHaveBeenCalledWith(expect.objectContaining({
      refundId: 'r_auto_1',
      toStatus: 'REFUNDING',
      fromStatuses: ['REFUNDING', 'FAILED'],
      providerRefundId: 'AUTO-WX-ORDER-1',
      rawNotifyPayload: { channel: 'WECHAT_PAY' },
      remark: '微信退款已受理，等待渠道通知',
    }));
    expect(updateAutoRefundRecord).not.toHaveBeenCalledWith(expect.objectContaining({
      toStatus: 'REFUNDED',
    }));
    expect(rewardDeductionService.refundDeduction).not.toHaveBeenCalled();
    expect(couponService.restoreCouponsForOrder).not.toHaveBeenCalled();
    expect(prisma.orderStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orderId: 'o1',
        reason: '订单取消后支付成功，微信退款已受理，等待渠道通知',
        meta: expect.objectContaining({
          autoRefund: true,
          providerRefundId: 'AUTO-WX-ORDER-1',
        }),
      }),
    }));
  });
});
