import { BadRequestException } from '@nestjs/common';
import { PaymentService } from '../payment.service';

describe('PaymentService.confirmCheckout after-sale shipping payment dispatch', () => {
  const userId = 'user-1';
  const merchantPaymentNo = 'AS_SHIP_PAY_after_sale_1';

  const baseShippingPayment = {
    id: 'ship-pay-1',
    amount: 18.13,
    status: 'UNPAID',
    merchantPaymentNo,
    afterSale: { userId },
  };

  const buildService = (overrides: {
    shippingPayment?: any;
    alipayQueryResult?: any;
    alipayQueryShouldThrow?: boolean;
    wechatAvailable?: boolean;
    wechatQueryResult?: any;
    wechatQueryShouldThrow?: boolean;
  } = {}) => {
    const shippingPaymentFindUnique = jest
      .fn()
      .mockResolvedValue(overrides.shippingPayment ?? {
        ...baseShippingPayment,
        provider: 'ALIPAY',
      });
    const prisma = {
      checkoutSession: { findUnique: jest.fn() },
      afterSaleShippingPayment: { findUnique: shippingPaymentFindUnique },
    };
    const alipayService = {
      queryOrder: overrides.alipayQueryShouldThrow
        ? jest.fn().mockRejectedValue(new Error('alipay gateway unavailable'))
        : jest.fn().mockResolvedValue(overrides.alipayQueryResult ?? null),
    };
    const wechatPayService = {
      isAvailable: jest.fn().mockReturnValue(overrides.wechatAvailable ?? true),
      queryOrder: overrides.wechatQueryShouldThrow
        ? jest.fn().mockRejectedValue(new Error('wechat gateway unavailable'))
        : jest.fn().mockResolvedValue(overrides.wechatQueryResult ?? null),
    };
    const handlePaymentCallback = jest.fn().mockResolvedValue({ code: 'SUCCESS' });

    const service = new PaymentService(
      prisma as any,
      { get: jest.fn() } as any,
      alipayService as any,
      {} as any,
      undefined,
      undefined,
      wechatPayService as any,
    );
    (service as any).handlePaymentCallback = handlePaymentCallback;

    return {
      service,
      prisma,
      alipayService,
      wechatPayService,
      handlePaymentCallback,
    };
  };

  it('keeps ALIPAY after-sale shipping active query behavior unchanged', async () => {
    const { service, prisma, alipayService, wechatPayService, handlePaymentCallback } = buildService({
      shippingPayment: {
        ...baseShippingPayment,
        provider: 'ALIPAY',
      },
      alipayQueryResult: {
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'alipay-ship-tx-1',
        totalAmount: '18.13',
      },
    });

    const result = await service.confirmCheckout(merchantPaymentNo, userId);

    expect(prisma.checkoutSession.findUnique).not.toHaveBeenCalled();
    expect(alipayService.queryOrder).toHaveBeenCalledWith(merchantPaymentNo);
    expect(wechatPayService.queryOrder).not.toHaveBeenCalled();
    expect(handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: merchantPaymentNo,
        providerTxnId: 'alipay-ship-tx-1',
        status: 'SUCCESS',
        skipSignatureVerification: true,
      }),
    );
    expect(result).toEqual({
      status: 'PAID',
      orderIds: [],
      expectedTotal: 18.13,
      confirmedBy: 'active-query-success',
    });
  });

  it('returns query-error for WECHAT_PAY after-sale shipping when unavailable without calling alipay', async () => {
    const { service, alipayService, wechatPayService, handlePaymentCallback } = buildService({
      shippingPayment: {
        ...baseShippingPayment,
        provider: 'WECHAT_PAY',
      },
      wechatAvailable: false,
    });

    const result = await service.confirmCheckout(merchantPaymentNo, userId);

    expect(wechatPayService.isAvailable).toHaveBeenCalled();
    expect(wechatPayService.queryOrder).not.toHaveBeenCalled();
    expect(alipayService.queryOrder).not.toHaveBeenCalled();
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'UNPAID',
      orderIds: [],
      expectedTotal: 18.13,
      confirmedBy: 'query-error',
    });
  });

  it('returns not-found for WECHAT_PAY after-sale shipping when provider has no order', async () => {
    const { service, alipayService, wechatPayService, handlePaymentCallback } = buildService({
      shippingPayment: {
        ...baseShippingPayment,
        provider: 'WECHAT_PAY',
      },
      wechatQueryResult: null,
    });

    const result = await service.confirmCheckout(merchantPaymentNo, userId);

    expect(wechatPayService.queryOrder).toHaveBeenCalledWith(merchantPaymentNo);
    expect(alipayService.queryOrder).not.toHaveBeenCalled();
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'UNPAID',
      orderIds: [],
      expectedTotal: 18.13,
      confirmedBy: 'not-found',
    });
  });

  it('returns provider state for WECHAT_PAY after-sale shipping non-success without callback', async () => {
    const { service, wechatPayService, handlePaymentCallback } = buildService({
      shippingPayment: {
        ...baseShippingPayment,
        provider: 'WECHAT_PAY',
      },
      wechatQueryResult: {
        tradeState: 'NOTPAY',
        outTradeNo: merchantPaymentNo,
        totalAmountFen: 1813,
      },
    });

    const result = await service.confirmCheckout(merchantPaymentNo, userId);

    expect(wechatPayService.queryOrder).toHaveBeenCalledWith(merchantPaymentNo);
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'UNPAID',
      orderIds: [],
      expectedTotal: 18.13,
      confirmedBy: 'wechat-notpay',
    });
  });

  it('returns query-error for WECHAT_PAY after-sale shipping SUCCESS missing transactionId', async () => {
    const { service, handlePaymentCallback } = buildService({
      shippingPayment: {
        ...baseShippingPayment,
        provider: 'WECHAT_PAY',
      },
      wechatQueryResult: {
        tradeState: 'SUCCESS',
        outTradeNo: merchantPaymentNo,
        totalAmountFen: 1813,
      },
    });

    const result = await service.confirmCheckout(merchantPaymentNo, userId);

    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'UNPAID',
      orderIds: [],
      expectedTotal: 18.13,
      confirmedBy: 'query-error',
    });
  });

  it('rejects WECHAT_PAY after-sale shipping SUCCESS amount mismatch before callback', async () => {
    const { service, handlePaymentCallback } = buildService({
      shippingPayment: {
        ...baseShippingPayment,
        provider: 'WECHAT_PAY',
      },
      wechatQueryResult: {
        tradeState: 'SUCCESS',
        transactionId: 'wx-ship-tx-1',
        outTradeNo: merchantPaymentNo,
        totalAmountFen: 1812,
      },
    });

    await expect(service.confirmCheckout(merchantPaymentNo, userId))
      .rejects.toThrow(BadRequestException);
    expect(handlePaymentCallback).not.toHaveBeenCalled();
  });

  it('returns query-error for WECHAT_PAY after-sale shipping SUCCESS missing fen amount', async () => {
    const { service, handlePaymentCallback } = buildService({
      shippingPayment: {
        ...baseShippingPayment,
        provider: 'WECHAT_PAY',
      },
      wechatQueryResult: {
        tradeState: 'SUCCESS',
        transactionId: 'wx-ship-tx-1',
        outTradeNo: merchantPaymentNo,
      },
    });

    const result = await service.confirmCheckout(merchantPaymentNo, userId);

    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'UNPAID',
      orderIds: [],
      expectedTotal: 18.13,
      confirmedBy: 'query-error',
    });
  });

  it('confirms WECHAT_PAY after-sale shipping SUCCESS with integer fen amount', async () => {
    const paidAt = new Date('2026-05-24T10:00:00.000Z');
    const { service, alipayService, wechatPayService, handlePaymentCallback } = buildService({
      shippingPayment: {
        ...baseShippingPayment,
        provider: 'WECHAT_PAY',
      },
      wechatQueryResult: {
        tradeState: 'SUCCESS',
        transactionId: 'wx-ship-tx-1',
        outTradeNo: merchantPaymentNo,
        totalAmountFen: 1813,
        paidAt,
      },
    });

    const result = await service.confirmCheckout(merchantPaymentNo, userId);

    expect(wechatPayService.queryOrder).toHaveBeenCalledWith(merchantPaymentNo);
    expect(alipayService.queryOrder).not.toHaveBeenCalled();
    expect(handlePaymentCallback).toHaveBeenCalledWith({
      merchantOrderNo: merchantPaymentNo,
      providerTxnId: 'wx-ship-tx-1',
      status: 'SUCCESS',
      paidAt: paidAt.toISOString(),
      rawPayload: expect.objectContaining({
        source: 'active-query',
        tradeState: 'SUCCESS',
        transactionId: 'wx-ship-tx-1',
        totalAmountFen: 1813,
      }),
      skipSignatureVerification: true,
    });
    expect(result).toEqual({
      status: 'PAID',
      orderIds: [],
      expectedTotal: 18.13,
      confirmedBy: 'active-query-success',
    });
  });
});
