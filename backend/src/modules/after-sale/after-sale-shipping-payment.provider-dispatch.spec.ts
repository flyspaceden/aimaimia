import { Prisma } from '@prisma/client';
import { AfterSaleModule } from './after-sale.module';
import { AfterSaleShippingPaymentService } from './after-sale-shipping-payment.service';
import { AfterSaleService } from './after-sale.service';
import { AfterSaleRefundService } from './after-sale-refund.service';
import { PaymentService } from '../payment/payment.service';
import { WechatPayService } from '../payment/wechat-pay.service';
import { ShippingRuleService } from '../admin/shipping-rule/shipping-rule.service';
import { RewardDeductionService } from '../bonus/reward-deduction.service';

const baseAfterSaleRequest = {
  id: 'as_001',
  orderId: 'order_001',
  userId: 'user_001',
  status: 'APPROVED',
  requiresReturn: true,
  returnShippingPayer: 'BUYER',
  returnShippingFee: 18.13,
  returnShippingFeeDeducted: false,
};

const baseShippingPayment: any = {
  id: 'ship_pay_001',
  afterSaleId: 'as_001',
  amount: 18.13,
  status: 'UNPAID',
  merchantPaymentNo: 'AS_SHIP_PAY_as_001',
  providerPaymentNo: null,
  provider: 'WECHAT_PAY',
  paidAt: null,
  refundedAt: null,
  failureReason: null,
  createdAt: new Date('2026-05-24T00:00:00.000Z'),
  updatedAt: new Date('2026-05-24T00:00:00.000Z'),
};

function createHarness() {
  const tx = {
    afterSaleRequest: {
      findFirst: jest.fn().mockResolvedValue(baseAfterSaleRequest),
      findUnique: jest.fn().mockResolvedValue(baseAfterSaleRequest),
    },
    afterSaleShippingPayment: {
      upsert: jest.fn().mockResolvedValue(baseShippingPayment),
      findUnique: jest.fn((args: any) =>
        args?.where?.afterSaleId
          ? Promise.resolve(null)
          : Promise.resolve(baseShippingPayment),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      findUnique: jest.fn().mockResolvedValue({
        checkoutSession: { paymentChannel: 'WECHAT_PAY' },
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const alipayService = {
    createAppPayOrder: jest.fn().mockResolvedValue('alipay-order-str'),
    refund: jest.fn().mockResolvedValue({ success: true, message: 'Success' }),
  };
  const wechatPayService = {
    isAvailable: jest.fn().mockReturnValue(true),
    createAppOrder: jest.fn().mockResolvedValue({
      appId: 'wx-app',
      partnerId: 'mch-001',
      timestamp: '1716537600',
      nonceStr: 'nonce-001',
      prepayId: 'wx-prepay-001',
      packageVal: 'Sign=WXPay',
      signType: 'RSA',
      paySign: 'wx-sign',
    }),
    refund: jest.fn().mockResolvedValue({
      success: true,
      pending: true,
      providerRefundId: 'wx-refund-001',
      message: '退款受理中',
    }),
    queryRefund: jest.fn().mockResolvedValue({
      outRefundNo: 'AS_SHIP_REF_as_001',
      outTradeNo: 'AS_SHIP_PAY_as_001',
      providerRefundId: 'wx-refund-001',
      status: 'SUCCESS',
      refundAmountFen: 1813,
      totalAmountFen: 1813,
      refundAmount: 18.13,
      totalAmount: 18.13,
    }),
  };
  const service = new AfterSaleShippingPaymentService(prisma as any, alipayService as any);
  return { service, tx, prisma, alipayService, wechatPayService };
}

describe('AfterSaleShippingPaymentService provider dispatch', () => {
  it('creates WECHAT_PAY shipping payment params when original checkout used WeChat Pay', async () => {
    const { service, tx, alipayService, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);

    const result = await service.createOrGetPaymentForBuyer('user_001', 'as_001');

    expect(tx.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'order_001' },
      select: { checkoutSession: { select: { paymentChannel: true } } },
    });
    expect(tx.afterSaleShippingPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        provider: 'WECHAT_PAY',
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      }),
    }));
    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: 'AS_SHIP_PAY_as_001',
      amount: 18.13,
      description: '爱买买退货运费-as_001',
    });
    expect(alipayService.createAppPayOrder).not.toHaveBeenCalled();
    expect(result.paymentParams).toEqual({
      channel: 'wechat',
      appId: 'wx-app',
      partnerId: 'mch-001',
      timestamp: '1716537600',
      nonceStr: 'nonce-001',
      prepayId: 'wx-prepay-001',
      packageVal: 'Sign=WXPay',
      signType: 'RSA',
      paySign: 'wx-sign',
    });
  });

  it('keeps pending WeChat shipping refund in REFUNDING instead of marking REFUNDED', async () => {
    const { service, tx, alipayService, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    const merchantRefundNo = (service as any).getWechatMerchantRefundNo('as_001');
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      status: 'PAID',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.refundShippingPayment('as_001', '买家取消退货');

    expect(wechatPayService.refund).toHaveBeenCalledWith({
      outTradeNo: 'AS_SHIP_PAY_as_001',
      outRefundNo: merchantRefundNo,
      refundAmount: 18.13,
      totalAmount: 18.13,
      reason: '买家取消退货',
    });
    expect(alipayService.refund).not.toHaveBeenCalled();
    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { afterSaleId: 'as_001', status: { in: ['REFUNDING', 'FAILED'] } },
      data: expect.objectContaining({
        status: 'REFUNDING',
        failureReason: expect.stringContaining('退货运费微信退款处理中'),
      }),
    }));
  });

  it('does not reissue WeChat shipping refund when payment is already REFUNDING', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      status: 'REFUNDING',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.refundShippingPayment('as_001', '进程中断后重试');

    expect(wechatPayService.refund).not.toHaveBeenCalled();
    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith({
      where: { afterSaleId: 'as_001', status: 'REFUNDING' },
      data: { failureReason: '退货运费退款中: 进程中断后重试' },
    });
  });

  it('keeps synchronous WeChat SUCCESS refund in REFUNDING when verification fields are missing', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    wechatPayService.refund.mockResolvedValue({
      success: true,
      pending: false,
      providerRefundId: 'wx-refund-001',
      message: '退款成功',
    });
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      status: 'PAID',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.refundShippingPayment('as_001', '买家取消退货');

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { afterSaleId: 'as_001', status: { in: ['REFUNDING', 'FAILED'] } },
      data: expect.objectContaining({
        status: 'REFUNDING',
        failureReason: expect.stringContaining('退货运费微信退款处理中'),
      }),
    }));
  });

  it('queries stale WeChat shipping refunds and reuses notify state handling', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    const merchantRefundNo = (service as any).getWechatMerchantRefundNo('as_001');
    wechatPayService.queryRefund.mockResolvedValue({
      outRefundNo: merchantRefundNo,
      outTradeNo: 'AS_SHIP_PAY_as_001',
      providerRefundId: 'wx-refund-001',
      status: 'SUCCESS',
      refundAmountFen: 1813,
      totalAmountFen: 1813,
      refundAmount: 18.13,
      totalAmount: 18.13,
    });
    tx.afterSaleShippingPayment.findMany.mockResolvedValue([
      {
        ...baseShippingPayment,
        status: 'REFUNDING',
        updatedAt: new Date('2026-05-24T01:00:00.000Z'),
      },
    ]);

    await service.retryStaleWechatShippingRefunds();

    expect(tx.afterSaleShippingPayment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provider: 'WECHAT_PAY',
        status: 'REFUNDING',
      }),
      take: 20,
    }));
    expect(wechatPayService.queryRefund).toHaveBeenCalledWith(merchantRefundNo);
    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
        provider: 'WECHAT_PAY',
        status: { in: ['REFUNDING', 'FAILED'] },
      },
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });

  it('does not query stale WeChat shipping refunds when WeChat Pay is unavailable', async () => {
    const { service, tx, wechatPayService } = createHarness();
    wechatPayService.isAvailable.mockReturnValue(false);
    service.setWechatPayService(wechatPayService as any);

    await service.retryStaleWechatShippingRefunds();

    expect(tx.afterSaleShippingPayment.findMany).not.toHaveBeenCalled();
    expect(wechatPayService.queryRefund).not.toHaveBeenCalled();
  });

  it('ignores stale WeChat refund query results for another merchant payment number', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    const merchantRefundNo = (service as any).getWechatMerchantRefundNo('as_001');
    tx.afterSaleShippingPayment.findMany.mockResolvedValue([
      {
        ...baseShippingPayment,
        status: 'REFUNDING',
        updatedAt: new Date('2026-05-24T01:00:00.000Z'),
      },
    ]);
    wechatPayService.queryRefund.mockResolvedValue({
      outRefundNo: merchantRefundNo,
      outTradeNo: 'AS_SHIP_PAY_OTHER',
      providerRefundId: 'wx-refund-001',
      status: 'SUCCESS',
      refundAmountFen: 1813,
      totalAmountFen: 1813,
      refundAmount: 18.13,
      totalAmount: 18.13,
    });

    await service.retryStaleWechatShippingRefunds();

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
  });

  it('marks very stale WeChat shipping refund as FAILED when queryRefund keeps returning no result', async () => {
    const now = new Date('2026-05-24T08:00:00.000Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    const merchantRefundNo = (service as any).getWechatMerchantRefundNo('as_001');
    tx.afterSaleShippingPayment.findMany.mockResolvedValue([
      {
        ...baseShippingPayment,
        status: 'REFUNDING',
        updatedAt: new Date('2026-05-24T01:00:00.000Z'),
      },
    ]);
    wechatPayService.queryRefund.mockResolvedValue(null);

    try {
      await service.retryStaleWechatShippingRefunds();

      expect(wechatPayService.queryRefund).toHaveBeenCalledWith(merchantRefundNo);
      expect(wechatPayService.refund).not.toHaveBeenCalled();
      expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: 'ship_pay_001',
          provider: 'WECHAT_PAY',
          status: 'REFUNDING',
        },
        data: expect.objectContaining({
          status: 'FAILED',
          failureReason: expect.stringContaining('微信退货运费退款查单无结果'),
        }),
      }));
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not mark WeChat shipping refund as REFUNDED when notify refund number mismatches', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      status: 'REFUNDING',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.handleWechatRefundNotify({
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      outRefundNo: 'AS_SHIP_REF_OTHER',
      tradeState: 'SUCCESS',
      providerRefundId: 'wx-refund-001',
      refundAmountFen: 1813,
      totalAmountFen: 1813,
    } as any);

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });

  it('does not mark WeChat shipping refund as REFUNDED when notify amount mismatches', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      status: 'REFUNDING',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.handleWechatRefundNotify({
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      outRefundNo: (service as any).getWechatMerchantRefundNo('as_001'),
      tradeState: 'SUCCESS',
      providerRefundId: 'wx-refund-001',
      refundAmountFen: 1812,
      totalAmountFen: 1813,
    } as any);

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });

  it('does not mark WeChat shipping refund as REFUNDED when notify refund number is missing', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      status: 'REFUNDING',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.handleWechatRefundNotify({
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      tradeState: 'SUCCESS',
      providerRefundId: 'wx-refund-001',
      refundAmountFen: 1813,
      totalAmountFen: 1813,
    } as any);

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });

  it('ignores PROCESSING WeChat shipping refund notify when refund number mismatches', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      status: 'REFUNDING',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.handleWechatRefundNotify({
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      outRefundNo: 'AS_SHIP_REF_OTHER',
      tradeState: 'PROCESSING',
      providerRefundId: 'wx-refund-001',
      refundAmountFen: 1813,
      totalAmountFen: 1813,
    } as any);

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
  });

  it('ignores WeChat shipping refund notify for non-WeChat payment records', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      provider: 'ALIPAY',
      status: 'REFUNDING',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.handleWechatRefundNotify({
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      outRefundNo: (service as any).getWechatMerchantRefundNo('as_001'),
      tradeState: 'SUCCESS',
      providerRefundId: 'wx-refund-001',
      refundAmountFen: 1813,
      totalAmountFen: 1813,
    } as any);

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
  });

  it('does not mark WeChat shipping refund as REFUNDED when notify amount is missing', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      ...baseShippingPayment,
      status: 'REFUNDING',
      paidAt: new Date('2026-05-24T01:00:00.000Z'),
    });

    await service.handleWechatRefundNotify({
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      outRefundNo: (service as any).getWechatMerchantRefundNo('as_001'),
      tradeState: 'SUCCESS',
      providerRefundId: 'wx-refund-001',
    } as any);

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });

  it('does not mark stale WeChat refund query as REFUNDED when amount mismatches', async () => {
    const { service, tx, wechatPayService } = createHarness();
    service.setWechatPayService(wechatPayService as any);
    const merchantRefundNo = (service as any).getWechatMerchantRefundNo('as_001');
    tx.afterSaleShippingPayment.findMany.mockResolvedValue([
      {
        ...baseShippingPayment,
        status: 'REFUNDING',
        updatedAt: new Date('2026-05-24T01:00:00.000Z'),
      },
    ]);
    wechatPayService.queryRefund.mockResolvedValue({
      outRefundNo: merchantRefundNo,
      outTradeNo: 'AS_SHIP_PAY_as_001',
      providerRefundId: 'wx-refund-001',
      status: 'SUCCESS',
      refundAmountFen: 1812,
      totalAmountFen: 1813,
      refundAmount: 18.12,
      totalAmount: 18.13,
    });

    await service.retryStaleWechatShippingRefunds();

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
  });

  it('shortens long afterSale IDs for WeChat merchant payment and refund numbers', async () => {
    const { service } = createHarness();
    const longAfterSaleId = 'as_' + 'x'.repeat(80);

    const merchantPaymentNo = (service as any).getMerchantPaymentNo(longAfterSaleId, 'WECHAT_PAY');
    const merchantRefundNo = (service as any).getWechatMerchantRefundNo(longAfterSaleId);

    expect(merchantPaymentNo).toMatch(/^AS_SHIP_PAY_[0-9A-F]{16}$/);
    expect(merchantPaymentNo.length).toBeLessThanOrEqual(32);
    expect(merchantRefundNo).toMatch(/^AS_SHIP_REF_[0-9A-F]{16}$/);
    expect(merchantRefundNo.length).toBeLessThanOrEqual(32);
  });

  it('keeps legacy Alipay merchant payment number even when afterSaleId is longer than 32 chars', async () => {
    const { service, tx } = createHarness();
    const longAfterSaleId = 'as_' + 'x'.repeat(80);
    tx.order.findUnique.mockResolvedValue({
      checkoutSession: { paymentChannel: 'ALIPAY' },
    });

    const result = await (service as any).upsertPaymentInTx(tx, {
      ...baseAfterSaleRequest,
      id: longAfterSaleId,
    });

    expect(tx.afterSaleShippingPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { merchantPaymentNo: `AS_SHIP_PAY_${longAfterSaleId}` },
      create: expect.objectContaining({
        provider: 'ALIPAY',
        merchantPaymentNo: `AS_SHIP_PAY_${longAfterSaleId}`,
      }),
    }));
    expect(result).toBe(baseShippingPayment);
  });

  it('reuses existing legacy shipping payment by afterSaleId before creating shortened merchant number', async () => {
    const { service, tx } = createHarness();
    const longAfterSaleId = 'as_' + 'x'.repeat(80);
    const existingPayment = {
      ...baseShippingPayment,
      afterSaleId: longAfterSaleId,
      merchantPaymentNo: `AS_SHIP_PAY_${longAfterSaleId}`,
      provider: 'ALIPAY',
    };
    tx.afterSaleShippingPayment.findUnique.mockResolvedValueOnce(existingPayment);

    const result = await (service as any).upsertPaymentInTx(tx, {
      ...baseAfterSaleRequest,
      id: longAfterSaleId,
    });

    expect(result).toBe(existingPayment);
    expect(tx.afterSaleShippingPayment.upsert).not.toHaveBeenCalled();
  });
});

describe('AfterSaleModule provider wiring', () => {
  it('sets optional WeChat Pay service through ModuleRef without changing constructor injection', () => {
    const paymentService = { setAfterSaleRefundService: jest.fn(), setAfterSaleShippingPaymentService: jest.fn() };
    const afterSaleShippingPaymentService = {
      setShippingRuleService: jest.fn(),
      setWechatPayService: jest.fn(),
    };
    const shippingRuleService = {};
    const rewardDeductionService = {};
    const wechatPayService = {};
    const moduleRef = {
      get: jest.fn((token: any) => {
        if (token === PaymentService) return paymentService;
        if (token === ShippingRuleService) return shippingRuleService;
        if (token === RewardDeductionService) return rewardDeductionService;
        if (token === WechatPayService) return wechatPayService;
        return null;
      }),
    };
    const afterSaleService = { setShippingRuleService: jest.fn() };
    const afterSaleRefundService = { setRewardDeductionService: jest.fn() };
    const module = new AfterSaleModule(
      moduleRef as any,
      afterSaleService as any,
      afterSaleRefundService as any,
      afterSaleShippingPaymentService as any,
    );

    module.onModuleInit();

    expect(afterSaleShippingPaymentService.setWechatPayService)
      .toHaveBeenCalledWith(wechatPayService);
  });
});
