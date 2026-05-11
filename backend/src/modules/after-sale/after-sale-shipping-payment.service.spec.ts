import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AfterSaleRequest,
  AfterSaleShippingPayment,
  Prisma,
} from '@prisma/client';
import { AfterSaleShippingPaymentService } from './after-sale-shipping-payment.service';
import { AFTER_SALE_CONFIG_KEYS } from './after-sale.constants';
import { AfterSaleController } from './after-sale.controller';
import { AfterSaleService } from './after-sale.service';

const REQUEST_CREATED_AT = new Date('2026-05-08T00:00:00.000Z');
const REQUEST_UPDATED_AT = new Date('2026-05-08T00:10:00.000Z');
const REQUEST_APPROVED_AT = new Date('2026-05-08T00:05:00.000Z');

function afterSaleRequestFixture(
  overrides: Partial<AfterSaleRequest> = {},
): AfterSaleRequest {
  return {
    id: 'as_001',
    orderId: 'order_001',
    userId: 'user_001',
    orderItemId: 'order_item_001',
    afterSaleType: 'NO_REASON_EXCHANGE',
    reasonType: null,
    reason: '七天无理由换货',
    photos: ['https://example.test/after-sale.jpg'],
    status: 'APPROVED',
    isPostReplacement: false,
    arbitrationSource: null,
    arbitrationSourceStatus: null,
    targetSkuId: null,
    targetQuantity: null,
    requiresReturn: true,
    returnCarrierCode: null,
    returnCarrierName: null,
    returnWaybillNo: null,
    returnWaybillUrl: null,
    returnSfOrderId: null,
    returnLabelUrl: null,
    returnShippingFee: null,
    returnShippingPayer: 'BUYER',
    returnShippingPaidAt: null,
    returnShippingFeeDeducted: false,
    returnShippedAt: null,
    sellerRejectReason: null,
    sellerRejectPhotos: [],
    sellerReturnCarrierCode: null,
    sellerReturnCarrierName: null,
    sellerReturnWaybillNo: null,
    sellerReturnWaybillUrl: null,
    sellerReturnSfOrderId: null,
    refundAmount: 88,
    refundId: null,
    reviewerId: null,
    reviewNote: null,
    reviewedAt: null,
    approvedAt: REQUEST_APPROVED_AT,
    sellerReceivedAt: null,
    manualReviewReason: null,
    manualReviewRequestedAt: null,
    manualReviewResolvedAt: null,
    replacementCarrierCode: null,
    replacementCarrierName: null,
    replacementWaybillNo: null,
    replacementWaybillUrl: null,
    replacementSfOrderId: null,
    replacementShipmentId: null,
    returnTrackingEvents: null,
    replacementTrackingEvents: null,
    sellerReturnTrackingEvents: null,
    createdAt: REQUEST_CREATED_AT,
    updatedAt: REQUEST_UPDATED_AT,
    ...overrides,
  };
}

function shippingPaymentFixture(
  overrides: Partial<AfterSaleShippingPayment> = {},
): AfterSaleShippingPayment {
  return {
    id: 'ship_pay_001',
    afterSaleId: 'as_001',
    amount: 18.13,
    status: 'UNPAID',
    merchantPaymentNo: 'AS_SHIP_PAY_as_001',
    providerPaymentNo: null,
    provider: 'ALIPAY',
    paidAt: null,
    refundedAt: null,
    failureReason: null,
    createdAt: REQUEST_CREATED_AT,
    updatedAt: REQUEST_UPDATED_AT,
    ...overrides,
  };
}

describe('AfterSaleShippingPaymentService', () => {
  const paidAt = new Date('2026-05-09T00:00:00.000Z');
  const tx = {
    ruleConfig: {
      findUnique: jest.fn(),
    },
    afterSaleRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    afterSaleShippingPayment: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    checkoutSession: {
      findUnique: jest.fn(),
    },
    order: {
      create: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const alipayService = {
    createAppPayOrder: jest.fn(),
    refund: jest.fn(),
  };

  let service: AfterSaleShippingPaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    alipayService.createAppPayOrder.mockResolvedValue('alipay-order-str');
    alipayService.refund.mockResolvedValue({
      success: true,
      fundChange: 'Y',
      message: 'Success',
    });
    tx.ruleConfig.findUnique.mockResolvedValue({ value: 18.126 });
    tx.afterSaleRequest.findFirst.mockResolvedValue(afterSaleRequestFixture());
    tx.afterSaleRequest.findUnique.mockResolvedValue(afterSaleRequestFixture());
    tx.afterSaleShippingPayment.upsert.mockResolvedValue(shippingPaymentFixture());
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture());
    tx.afterSaleShippingPayment.update.mockResolvedValue(shippingPaymentFixture({
      status: 'PAID',
      paidAt,
    }));
    tx.afterSaleShippingPayment.updateMany.mockResolvedValue({ count: 1 });
    tx.afterSaleRequest.update.mockResolvedValue({ id: 'as_001' });
    tx.afterSaleRequest.updateMany.mockResolvedValue({ count: 1 });

    service = new AfterSaleShippingPaymentService(prisma as any, alipayService as any);
  });

  it('estimates buyer return shipping fee from RuleConfig rounded to cents', async () => {
    await expect(service.estimateReturnShippingFee('as_001')).resolves.toBe(18.13);

    expect(tx.ruleConfig.findUnique).toHaveBeenCalledWith({
      where: { key: AFTER_SALE_CONFIG_KEYS.RETURN_SHIPPING_FEE_DEFAULT },
    });
  });

  it('uses 10 yuan fallback when RuleConfig is missing', async () => {
    tx.ruleConfig.findUnique.mockResolvedValue(null);

    await expect(service.estimateReturnShippingFee('as_001')).resolves.toBe(10);
  });

  it('createOrGetPaymentForBuyer creates a single payment and returns Alipay app params', async () => {
    const result = await service.createOrGetPaymentForBuyer('user_001', 'as_001');

    expect(result.merchantPaymentNo).toBe('AS_SHIP_PAY_as_001');
    expect(result).toEqual(expect.objectContaining({
      id: 'ship_pay_001',
      afterSaleId: 'as_001',
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      amount: 18.13,
      status: 'UNPAID',
      paymentParams: {
        channel: 'alipay',
        orderStr: 'alipay-order-str',
      },
    }));
    expect(alipayService.createAppPayOrder).toHaveBeenCalledWith({
      merchantOrderNo: 'AS_SHIP_PAY_as_001',
      totalAmount: 18.13,
      subject: '爱买买退货运费-as_001',
    });
    expect(tx.afterSaleRequest.findFirst).toHaveBeenCalledWith({
      where: { id: 'as_001', userId: 'user_001' },
    });
    expect(tx.afterSaleShippingPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { merchantPaymentNo: 'AS_SHIP_PAY_as_001' },
      create: expect.objectContaining({
        afterSaleId: 'as_001',
        amount: 18.13,
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
        provider: 'ALIPAY',
        status: 'UNPAID',
      }),
      update: {},
    }));
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  it('locks payment amount to request returnShippingFee even when RuleConfig changes', async () => {
    tx.ruleConfig.findUnique.mockResolvedValue({ value: 99.99 });
    tx.afterSaleRequest.findFirst.mockResolvedValue(afterSaleRequestFixture({
      returnShippingFee: 12.34,
    }));
    tx.afterSaleShippingPayment.upsert.mockResolvedValue(shippingPaymentFixture({
      amount: 12.34,
    }));

    await expect(service.createOrGetPaymentForBuyer('user_001', 'as_001'))
      .resolves.toEqual(expect.objectContaining({ amount: 12.34 }));

    expect(tx.afterSaleShippingPayment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ amount: 12.34 }),
    }));
    expect(tx.ruleConfig.findUnique).not.toHaveBeenCalled();
  });

  it('does not create a new Alipay order string when payment is already paid', async () => {
    tx.afterSaleShippingPayment.upsert.mockResolvedValue(shippingPaymentFixture({
      status: 'PAID',
      paidAt,
    }));

    await expect(service.createOrGetPaymentForBuyer('user_001', 'as_001'))
      .resolves.toEqual(expect.objectContaining({
        status: 'PAID',
        paymentParams: {},
      }));

    expect(alipayService.createAppPayOrder).not.toHaveBeenCalled();
  });

  it('fillReturnShipping blocks buyer-paid return shipping until payment is recorded', async () => {
    tx.afterSaleRequest.findUnique.mockResolvedValue(afterSaleRequestFixture({
      returnShippingPaidAt: null,
    }));
    const afterSaleService = new AfterSaleService(prisma as any, {} as any, {} as any);

    await expect(afterSaleService.fillReturnShipping('user_001', 'as_001', {
      returnCarrierName: '顺丰',
      returnWaybillNo: 'SF123',
    })).rejects.toThrow('请先支付退货运费');

    expect(tx.afterSaleRequest.updateMany).not.toHaveBeenCalled();
  });

  it('rejects buyer wrapper when the after-sale request belongs to another user', async () => {
    tx.afterSaleRequest.findFirst.mockResolvedValue(null);

    await expect(service.createOrGetPaymentForBuyer('user_other', 'as_001'))
      .rejects.toThrow(NotFoundException);

    expect(tx.afterSaleShippingPayment.upsert).not.toHaveBeenCalled();
  });

  it('only creates payment for buyer-paid required-return after-sale requests', async () => {
    tx.afterSaleRequest.findFirst.mockResolvedValue(afterSaleRequestFixture({
      requiresReturn: false,
    }));

    await expect(service.createOrGetPaymentForBuyer('user_001', 'as_001'))
      .rejects.toThrow(BadRequestException);

    expect(tx.afterSaleShippingPayment.upsert).not.toHaveBeenCalled();
  });

  it.each(['REQUESTED', 'UNDER_REVIEW', 'CANCELED', 'RETURN_SHIPPING'])(
    'rejects buyer shipping payment creation when after-sale status is %s',
    async (status) => {
      tx.afterSaleRequest.findFirst.mockResolvedValue(afterSaleRequestFixture({
        status,
      } as Partial<AfterSaleRequest>));

      await expect(service.createOrGetPaymentForBuyer('user_001', 'as_001'))
        .rejects.toThrow(BadRequestException);

      expect(tx.afterSaleShippingPayment.upsert).not.toHaveBeenCalled();
    },
  );

  it('handlePaymentSuccess marks payment paid and does not call checkout/order build flow', async () => {
    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_001', paidAt);

    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
        status: { in: ['UNPAID', 'PENDING', 'FAILED', 'CLOSED'] },
      },
      data: expect.objectContaining({
        status: 'PAID',
        providerPaymentNo: 'trade_001',
        paidAt,
        failureReason: null,
      }),
    }));
    expect(tx.afterSaleRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'as_001' },
      data: expect.objectContaining({ returnShippingPaidAt: paidAt }),
    }));
    expect(tx.checkoutSession.findUnique).not.toHaveBeenCalled();
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('handlePaymentSuccess is idempotent for already paid payment', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'PAID',
      providerPaymentNo: 'trade_old',
      paidAt,
    }));

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', new Date());

    expect(tx.afterSaleShippingPayment.update).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalled();
  });

  it('handlePaymentFailure does not overwrite PAID as FAILED', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'PAID',
      paidAt,
    }));

    await service.handlePaymentFailure('AS_SHIP_PAY_as_001', '支付失败');

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
  });

  it.each(['CLOSED', 'REFUNDING', 'REFUNDED'])(
    'handlePaymentFailure ignores late failure when shipping payment is %s',
    async (status) => {
      tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
        status,
      } as Partial<AfterSaleShippingPayment>));

      await service.handlePaymentFailure('AS_SHIP_PAY_as_001', '支付失败');

      expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
    },
  );

  it('handlePaymentSuccess ignores late success when shipping payment is REFUNDED', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'REFUNDED',
      refundedAt: paidAt,
    }));

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', paidAt);

    expect(tx.afterSaleShippingPayment.update).not.toHaveBeenCalled();
    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalled();
  });

  it('handlePaymentSuccess retries refund when shipping payment is already REFUNDING', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'REFUNDING',
      paidAt,
      failureReason: '退货运费退款中: 支付回调重试',
    }));

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', paidAt);

    expect(alipayService.refund).toHaveBeenCalledWith(expect.objectContaining({
      merchantOrderNo: 'AS_SHIP_PAY_as_001',
      merchantRefundNo: 'AS_SHIP_REFUND_as_001',
      refundAmount: 18.13,
    }));
  });

  it('handlePaymentSuccess ignores FAILED payment that was already paid and failed during refund', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'FAILED',
      providerPaymentNo: 'trade_001',
      paidAt,
      failureReason: '退货运费退款失败: 余额不足',
    }));

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', new Date());

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalled();
  });

  it('handlePaymentSuccess refunds late CLOSED success through original Alipay trade', async () => {
    tx.afterSaleShippingPayment.findUnique
      .mockResolvedValueOnce(shippingPaymentFixture({
        status: 'CLOSED',
      }))
      .mockResolvedValueOnce(shippingPaymentFixture({
        status: 'PAID',
        providerPaymentNo: 'trade_late',
        paidAt,
      }));
    tx.afterSaleRequest.findUnique.mockResolvedValue(afterSaleRequestFixture({
      status: 'CLOSED',
    }));

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', paidAt);

    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
        status: { in: ['UNPAID', 'PENDING', 'FAILED', 'CLOSED'] },
      },
      data: expect.objectContaining({
        status: 'PAID',
        providerPaymentNo: 'trade_late',
        paidAt,
        failureReason: '售后单状态已变更为 CLOSED，准备原路退还退货运费',
      }),
    }));
    expect(alipayService.refund).toHaveBeenCalledWith({
      merchantOrderNo: 'AS_SHIP_PAY_as_001',
      refundAmount: 18.13,
      merchantRefundNo: 'AS_SHIP_REFUND_as_001',
      refundReason: '售后单状态已变更为 CLOSED，准备原路退还退货运费',
    });
    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { afterSaleId: 'as_001', status: { in: ['REFUNDING', 'FAILED'] } },
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ manualReviewRequestedAt: paidAt }),
    }));
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ returnShippingPaidAt: paidAt }),
    }));
  });

  it('handlePaymentSuccess retries refund for already PAID non-active shipping payment', async () => {
    tx.afterSaleShippingPayment.findUnique
      .mockResolvedValueOnce(shippingPaymentFixture({
        status: 'PAID',
        providerPaymentNo: 'trade_late',
        paidAt,
        failureReason: '售后单状态已变更为 CLOSED，准备原路退还退货运费',
      }))
      .mockResolvedValueOnce(shippingPaymentFixture({
        status: 'PAID',
        providerPaymentNo: 'trade_late',
        paidAt,
      }));
    tx.afterSaleRequest.findUnique.mockResolvedValue(afterSaleRequestFixture({
      status: 'CLOSED',
    }));

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', paidAt);

    expect(alipayService.refund).toHaveBeenCalledWith({
      merchantOrderNo: 'AS_SHIP_PAY_as_001',
      refundAmount: 18.13,
      merchantRefundNo: 'AS_SHIP_REFUND_as_001',
      refundReason: '售后单状态已变更为 CLOSED，准备原路退还退货运费',
    });
  });

  it('handlePaymentFailure does not overwrite a paid refund-failed shipping payment', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'FAILED',
      paidAt,
      failureReason: '退货运费退款失败: 余额不足',
    }));

    await service.handlePaymentFailure('AS_SHIP_PAY_as_001', '支付关闭');

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
  });

  it('refundShippingPayment refunds PAID return shipping fee through original Alipay trade', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'PAID',
      paidAt,
    }));
    tx.afterSaleShippingPayment.updateMany.mockResolvedValue({ count: 1 });

    await service.refundShippingPayment('as_001', '面单取消');

    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { afterSaleId: 'as_001', status: 'PAID' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        failureReason: '退货运费退款中: 面单取消',
      }),
    }));
    expect(alipayService.refund).toHaveBeenCalledWith({
      merchantOrderNo: 'AS_SHIP_PAY_as_001',
      refundAmount: 18.13,
      merchantRefundNo: 'AS_SHIP_REFUND_as_001',
      refundReason: '面单取消',
    });
    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { afterSaleId: 'as_001', status: { in: ['REFUNDING', 'FAILED'] } },
      data: expect.objectContaining({
        status: 'REFUNDED',
        refundedAt: expect.any(Date),
        failureReason: null,
      }),
    }));
  });

  it('refundShippingPayment marks paid shipping fee refund failed when Alipay rejects', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'PAID',
      paidAt,
    }));
    tx.afterSaleShippingPayment.updateMany.mockResolvedValue({ count: 1 });
    alipayService.refund.mockResolvedValue({
      success: false,
      fundChange: 'N',
      message: '余额不足',
    });

    await service.refundShippingPayment('as_001', '面单取消');

    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { afterSaleId: 'as_001', status: 'REFUNDING' },
      data: expect.objectContaining({
        status: 'FAILED',
        failureReason: '退货运费退款失败: 余额不足',
      }),
    }));
  });

  it('refundShippingPayment retries FAILED payment when it had already been paid', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'FAILED',
      paidAt,
      failureReason: '退货运费退款失败: 余额不足',
    }));
    tx.afterSaleShippingPayment.updateMany.mockResolvedValue({ count: 1 });

    await service.refundShippingPayment('as_001', '再次退款');

    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { afterSaleId: 'as_001', status: 'FAILED' },
      data: expect.objectContaining({
        status: 'REFUNDING',
        failureReason: '退货运费退款中: 再次退款',
      }),
    }));
    expect(alipayService.refund).toHaveBeenCalledWith(expect.objectContaining({
      merchantOrderNo: 'AS_SHIP_PAY_as_001',
      merchantRefundNo: 'AS_SHIP_REFUND_as_001',
    }));
  });

  it('refundShippingPayment retries REFUNDING payment with the idempotent refund number', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'REFUNDING',
      paidAt,
      failureReason: '退货运费退款中: 进程中断后重试',
    }));

    await service.refundShippingPayment('as_001', '进程中断后重试');

    expect(alipayService.refund).toHaveBeenCalledWith(expect.objectContaining({
      merchantOrderNo: 'AS_SHIP_PAY_as_001',
      merchantRefundNo: 'AS_SHIP_REFUND_as_001',
      refundAmount: 18.13,
    }));
  });

  it('refundShippingPayment lets a successful retry recover FAILED left by a concurrent retry', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
      status: 'REFUNDING',
      paidAt,
      failureReason: '退货运费退款中: 并发重试',
    }));

    await service.refundShippingPayment('as_001', '并发重试');

    expect(tx.afterSaleShippingPayment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        afterSaleId: 'as_001',
        status: { in: ['REFUNDING', 'FAILED'] },
      },
      data: expect.objectContaining({
        status: 'REFUNDED',
        failureReason: null,
      }),
    }));
  });

  it.each(['UNPAID', 'FAILED'])(
    'refundShippingPayment closes %s payment because no money was collected',
    async (status) => {
      tx.afterSaleShippingPayment.findUnique.mockResolvedValue(shippingPaymentFixture({
        status,
      } as Partial<AfterSaleShippingPayment>));

      await service.refundShippingPayment('as_001', '售后关闭');

      expect(tx.afterSaleShippingPayment.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { afterSaleId: 'as_001' },
        data: expect.objectContaining({
          status: 'CLOSED',
          failureReason: '售后关闭',
        }),
      }));
    },
  );
});

describe('AfterSaleController return shipping payment route', () => {
  it('starts buyer return shipping payment through the shipping payment service', async () => {
    const afterSaleService = {} as AfterSaleService;
    const shippingPaymentService = {
      createOrGetPaymentForBuyer: jest.fn().mockResolvedValue({
        id: 'ship_pay_001',
        afterSaleId: 'as_001',
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
        amount: 18.13,
        status: 'UNPAID',
        paymentParams: { channel: 'alipay', orderStr: 'alipay-order-str' },
      }),
    };
    const controller = new AfterSaleController(
      afterSaleService,
      shippingPaymentService as any,
      {} as any,
    );

    await expect(controller.createReturnShippingPayment('user_001', 'as_001'))
      .resolves.toEqual(expect.objectContaining({
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
        paymentParams: { channel: 'alipay', orderStr: 'alipay-order-str' },
      }));

    expect(shippingPaymentService.createOrGetPaymentForBuyer)
      .toHaveBeenCalledWith('user_001', 'as_001');
  });
});
