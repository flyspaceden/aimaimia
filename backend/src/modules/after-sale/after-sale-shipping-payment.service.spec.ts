import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AfterSaleShippingPaymentService } from './after-sale-shipping-payment.service';
import { AFTER_SALE_CONFIG_KEYS } from './after-sale.constants';

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

  let service: AfterSaleShippingPaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.ruleConfig.findUnique.mockResolvedValue({ value: 18.126 });
    tx.afterSaleRequest.findFirst.mockResolvedValue({
      id: 'as_001',
      userId: 'user_001',
      status: 'APPROVED',
      requiresReturn: true,
      returnShippingPayer: 'BUYER',
    });
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      userId: 'user_001',
      status: 'APPROVED',
      requiresReturn: true,
      returnShippingPayer: 'BUYER',
    });
    tx.afterSaleShippingPayment.upsert.mockResolvedValue({
      id: 'ship_pay_001',
      afterSaleId: 'as_001',
      amount: 18.13,
      status: 'UNPAID',
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
    });
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      id: 'ship_pay_001',
      afterSaleId: 'as_001',
      amount: 18.13,
      status: 'UNPAID',
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      providerPaymentNo: null,
    });
    tx.afterSaleShippingPayment.update.mockResolvedValue({
      id: 'ship_pay_001',
      status: 'PAID',
    });
    tx.afterSaleShippingPayment.updateMany.mockResolvedValue({ count: 1 });
    tx.afterSaleRequest.update.mockResolvedValue({ id: 'as_001' });

    service = new AfterSaleShippingPaymentService(prisma as any);
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

  it('createOrGetPaymentForBuyer creates a single payment using AS_SHIP_PAY_afterSaleId', async () => {
    const result = await service.createOrGetPaymentForBuyer('user_001', 'as_001');

    expect(result.merchantPaymentNo).toBe('AS_SHIP_PAY_as_001');
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

  it('rejects buyer wrapper when the after-sale request belongs to another user', async () => {
    tx.afterSaleRequest.findFirst.mockResolvedValue(null);

    await expect(service.createOrGetPaymentForBuyer('user_other', 'as_001'))
      .rejects.toThrow(NotFoundException);

    expect(tx.afterSaleShippingPayment.upsert).not.toHaveBeenCalled();
  });

  it('only creates payment for buyer-paid required-return after-sale requests', async () => {
    tx.afterSaleRequest.findFirst.mockResolvedValue({
      id: 'as_001',
      userId: 'user_001',
      status: 'APPROVED',
      requiresReturn: false,
      returnShippingPayer: 'BUYER',
    });

    await expect(service.createOrGetPaymentForBuyer('user_001', 'as_001'))
      .rejects.toThrow(BadRequestException);

    expect(tx.afterSaleShippingPayment.upsert).not.toHaveBeenCalled();
  });

  it.each(['REQUESTED', 'UNDER_REVIEW', 'CANCELED', 'RETURN_SHIPPING'])(
    'rejects buyer shipping payment creation when after-sale status is %s',
    async (status) => {
      tx.afterSaleRequest.findFirst.mockResolvedValue({
        id: 'as_001',
        userId: 'user_001',
        status,
        requiresReturn: true,
        returnShippingPayer: 'BUYER',
      });

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
        status: { in: ['UNPAID', 'PENDING', 'FAILED'] },
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
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      id: 'ship_pay_001',
      afterSaleId: 'as_001',
      amount: 18.13,
      status: 'PAID',
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      providerPaymentNo: 'trade_old',
      paidAt,
    });

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', new Date());

    expect(tx.afterSaleShippingPayment.update).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalled();
  });

  it('handlePaymentFailure does not overwrite PAID as FAILED', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      id: 'ship_pay_001',
      afterSaleId: 'as_001',
      status: 'PAID',
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
    });

    await service.handlePaymentFailure('AS_SHIP_PAY_as_001', '支付失败');

    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
  });

  it.each(['CLOSED', 'REFUNDING', 'REFUNDED'])(
    'handlePaymentSuccess ignores late success when shipping payment is %s',
    async (status) => {
      tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
        id: 'ship_pay_001',
        afterSaleId: 'as_001',
        amount: 18.13,
        status,
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      });

      await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', paidAt);

      expect(tx.afterSaleShippingPayment.update).not.toHaveBeenCalled();
      expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
      expect(tx.afterSaleRequest.update).not.toHaveBeenCalled();
    },
  );

  it('handlePaymentSuccess does not mark paid when linked after-sale request is no longer approved', async () => {
    tx.afterSaleRequest.findUnique.mockResolvedValue({
      id: 'as_001',
      status: 'CLOSED',
    });

    await service.handlePaymentSuccess('AS_SHIP_PAY_as_001', 'trade_late', paidAt);

    expect(tx.afterSaleShippingPayment.update).not.toHaveBeenCalled();
    expect(tx.afterSaleShippingPayment.updateMany).not.toHaveBeenCalled();
    expect(tx.afterSaleRequest.update).not.toHaveBeenCalled();
  });

  it('refundShippingPayment keeps PAID payment paid and records manual refund note', async () => {
    tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
      id: 'ship_pay_001',
      afterSaleId: 'as_001',
      status: 'PAID',
      merchantPaymentNo: 'AS_SHIP_PAY_as_001',
    });

    await service.refundShippingPayment('as_001', '面单取消');

    expect(tx.afterSaleShippingPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { afterSaleId: 'as_001' },
      data: expect.objectContaining({
        status: 'PAID',
        failureReason: '需人工退还退货运费: 面单取消',
      }),
    }));
  });

  it.each(['UNPAID', 'FAILED'])(
    'refundShippingPayment closes %s payment because no money was collected',
    async (status) => {
      tx.afterSaleShippingPayment.findUnique.mockResolvedValue({
        id: 'ship_pay_001',
        afterSaleId: 'as_001',
        status,
        merchantPaymentNo: 'AS_SHIP_PAY_as_001',
      });

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
