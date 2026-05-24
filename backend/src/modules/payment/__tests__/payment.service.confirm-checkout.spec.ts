import { BadRequestException } from '@nestjs/common';
import { PaymentService } from '../payment.service';

describe('PaymentService.confirmCheckout channel dispatch', () => {
  const userId = 'user-1';
  const sessionId = 'cs-test-1';
  const merchantOrderNo = 'CS-20260524-001';

  const baseSession = {
    id: sessionId,
    userId,
    status: 'ACTIVE',
    merchantOrderNo,
    expectedTotal: 128.5,
    orders: [],
  };

  const buildService = (overrides: {
    session: any;
    refreshedSession?: any;
    alipayQueryResult?: any;
    wechatQueryResult?: any;
    wechatAvailable?: boolean;
    wechatQueryShouldThrow?: boolean;
  }) => {
    const checkoutSessionFindUnique = jest
      .fn()
      .mockResolvedValueOnce(overrides.session)
      .mockResolvedValue(overrides.refreshedSession ?? {
        ...overrides.session,
        status: 'COMPLETED',
        orders: [{ id: 'ord-1' }],
      });

    const prisma = {
      checkoutSession: { findUnique: checkoutSessionFindUnique },
      afterSaleShippingPayment: { findUnique: jest.fn() },
    };
    const alipayService = {
      queryOrder: jest.fn().mockResolvedValue(overrides.alipayQueryResult ?? null),
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
      alipayService,
      wechatPayService,
      handlePaymentCallback,
    };
  };

  it('dispatches ALIPAY active query to alipay.queryOrder', async () => {
    const { service, alipayService, wechatPayService, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'ALIPAY' },
      alipayQueryResult: {
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'alipay-tx-1',
        totalAmount: '128.50',
      },
    });

    await service.confirmCheckout(sessionId, userId);

    expect(alipayService.queryOrder).toHaveBeenCalledWith(merchantOrderNo);
    expect(wechatPayService.queryOrder).not.toHaveBeenCalled();
    expect(handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo,
        providerTxnId: 'alipay-tx-1',
        status: 'SUCCESS',
        skipSignatureVerification: true,
      }),
    );
  });

  it('dispatches WECHAT_PAY active query to wechat.queryOrder', async () => {
    const { service, alipayService, wechatPayService, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'WECHAT_PAY' },
      wechatQueryResult: {
        tradeState: 'NOTPAY',
        outTradeNo: merchantOrderNo,
        totalAmountFen: 12850,
        totalAmount: 128.5,
      },
    });

    const result = await service.confirmCheckout(sessionId, userId);

    expect(wechatPayService.isAvailable).toHaveBeenCalled();
    expect(wechatPayService.queryOrder).toHaveBeenCalledWith(merchantOrderNo);
    expect(alipayService.queryOrder).not.toHaveBeenCalled();
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ACTIVE',
      orderIds: [],
      expectedTotal: 128.5,
      confirmedBy: 'wechat-notpay',
    });
  });

  it('keeps polling semantics when WECHAT_PAY active query is unavailable', async () => {
    const { service, wechatPayService, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'WECHAT_PAY' },
      wechatAvailable: false,
    });

    const result = await service.confirmCheckout(sessionId, userId);

    expect(wechatPayService.isAvailable).toHaveBeenCalled();
    expect(wechatPayService.queryOrder).not.toHaveBeenCalled();
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ACTIVE',
      orderIds: [],
      expectedTotal: 128.5,
      confirmedBy: 'query-error',
    });
  });

  it('returns not-found when WECHAT_PAY active query has no provider record yet', async () => {
    const { service, wechatPayService, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'WECHAT_PAY' },
      wechatQueryResult: null,
    });

    const result = await service.confirmCheckout(sessionId, userId);

    expect(wechatPayService.queryOrder).toHaveBeenCalledWith(merchantOrderNo);
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ACTIVE',
      orderIds: [],
      expectedTotal: 128.5,
      confirmedBy: 'not-found',
    });
  });

  it('keeps polling semantics when WECHAT_PAY active query throws', async () => {
    const { service, wechatPayService, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'WECHAT_PAY' },
      wechatQueryShouldThrow: true,
    });

    const result = await service.confirmCheckout(sessionId, userId);

    expect(wechatPayService.queryOrder).toHaveBeenCalledWith(merchantOrderNo);
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'ACTIVE',
      orderIds: [],
      expectedTotal: 128.5,
      confirmedBy: 'query-error',
    });
  });

  it('returns already-completed for completed WECHAT_PAY sessions without querying provider', async () => {
    const { service, wechatPayService, handlePaymentCallback } = buildService({
      session: {
        ...baseSession,
        status: 'COMPLETED',
        paymentChannel: 'WECHAT_PAY',
        orders: [{ id: 'ord-existing' }],
      },
    });

    const result = await service.confirmCheckout(sessionId, userId);

    expect(wechatPayService.queryOrder).not.toHaveBeenCalled();
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'COMPLETED',
      orderIds: ['ord-existing'],
      expectedTotal: 128.5,
      confirmedBy: 'already-completed',
    });
  });

  it('maps WECHAT_PAY SUCCESS to handlePaymentCallback with transactionId', async () => {
    const paidAt = new Date('2026-05-24T10:00:00.000Z');
    const { service, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'WECHAT_PAY' },
      wechatQueryResult: {
        tradeState: 'SUCCESS',
        transactionId: 'wechat-tx-1',
        outTradeNo: merchantOrderNo,
        totalAmountFen: 12850,
        totalAmount: 128.5,
        paidAt,
      },
    });

    const result = await service.confirmCheckout(sessionId, userId);

    expect(handlePaymentCallback).toHaveBeenCalledWith({
      merchantOrderNo,
      providerTxnId: 'wechat-tx-1',
      status: 'SUCCESS',
      paidAt: paidAt.toISOString(),
      rawPayload: expect.objectContaining({
        source: 'active-query',
        tradeState: 'SUCCESS',
        transactionId: 'wechat-tx-1',
        totalAmount: 128.5,
      }),
      skipSignatureVerification: true,
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.orderIds).toEqual(['ord-1']);
    expect(result.confirmedBy).toBe('active-query-success');
  });

  it('validates WECHAT_PAY SUCCESS with provider fen amount as the source of truth', async () => {
    const { service, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'WECHAT_PAY' },
      wechatQueryResult: {
        tradeState: 'SUCCESS',
        transactionId: 'wechat-tx-1',
        outTradeNo: merchantOrderNo,
        totalAmountFen: 12850,
        totalAmount: 0.01,
      },
    });

    await service.confirmCheckout(sessionId, userId);

    expect(handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        providerTxnId: 'wechat-tx-1',
        status: 'SUCCESS',
      }),
    );
  });

  it('rejects WECHAT_PAY SUCCESS when totalAmountFen does not match session expectedTotal', async () => {
    const { service, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'WECHAT_PAY' },
      wechatQueryResult: {
        tradeState: 'SUCCESS',
        transactionId: 'wechat-tx-1',
        outTradeNo: merchantOrderNo,
        totalAmountFen: 1,
        totalAmount: 0.01,
      },
    });

    await expect(service.confirmCheckout(sessionId, userId))
      .rejects.toThrow(BadRequestException);
    expect(handlePaymentCallback).not.toHaveBeenCalled();
  });

  it('rejects WECHAT_PAY SUCCESS when transactionId is missing', async () => {
    const { service, handlePaymentCallback } = buildService({
      session: { ...baseSession, paymentChannel: 'WECHAT_PAY' },
      wechatQueryResult: {
        tradeState: 'SUCCESS',
        outTradeNo: merchantOrderNo,
        totalAmountFen: 12850,
        totalAmount: 128.5,
      },
    });

    await expect(service.confirmCheckout(sessionId, userId))
      .rejects.toThrow(BadRequestException);
    expect(handlePaymentCallback).not.toHaveBeenCalled();
  });
});
