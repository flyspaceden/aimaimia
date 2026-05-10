import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentService } from './payment.service';

/**
 * P5 第三轮 active-query 4 场景必覆盖测试
 *
 * 1. TRADE_SUCCESS → 建单成功，返回 COMPLETED + orderIds
 * 2. WAIT_BUYER_PAY → 不建单，session 状态保持 ACTIVE
 * 3. 金额不一致 → 拒绝建单 + 抛 BadRequestException
 * 4. 已 COMPLETED 的 session 重复调用 → 直接返现有 orderIds（幂等）
 */
describe('PaymentService.confirmAlipayCheckout', () => {
  const userId = 'user-1';
  const sessionId = 'cs-test-1';
  const merchantOrderNo = 'CS-1234567890-abc';

  const buildService = (overrides: {
    session: any;
    shippingPayment?: any;
    queryResult?: any;
    queryOrderShouldThrow?: boolean;
    handlePaymentCallback?: jest.Mock;
  }) => {
    const sessionFindUnique = jest.fn().mockResolvedValue(overrides.session);
    const shippingPaymentFindUnique = jest.fn().mockResolvedValue(overrides.shippingPayment ?? null);
    const queryOrder = overrides.queryOrderShouldThrow
      ? jest.fn().mockRejectedValue(new Error('支付宝网关异常'))
      : jest.fn().mockResolvedValue(overrides.queryResult ?? null);
    const handlePaymentCallback = overrides.handlePaymentCallback ?? jest.fn().mockResolvedValue(undefined);

    const prisma = {
      checkoutSession: { findUnique: sessionFindUnique },
      afterSaleShippingPayment: { findUnique: shippingPaymentFindUnique },
    };
    const config = { get: jest.fn() };
    const alipayService = { queryOrder };
    const checkoutService = {} as any;

    const service = new PaymentService(
      prisma as any,
      config as any,
      alipayService as any,
      checkoutService,
    );
    // monkey-patch handlePaymentCallback for test isolation
    (service as any).handlePaymentCallback = handlePaymentCallback;
    return { service, sessionFindUnique, shippingPaymentFindUnique, queryOrder, handlePaymentCallback };
  };

  it('Scene 1: TRADE_SUCCESS 应建单并返回 COMPLETED + orderIds', async () => {
    const session = {
      id: sessionId,
      userId,
      status: 'ACTIVE',
      paymentChannel: 'ALIPAY',
      merchantOrderNo,
      expectedTotal: 100.5,
      orders: [],
    };
    const refreshedSession = {
      ...session,
      status: 'COMPLETED',
      orders: [{ id: 'ord-aaa' }, { id: 'ord-bbb' }],
    };

    const { service, sessionFindUnique, handlePaymentCallback } = buildService({
      session,
      queryResult: { tradeStatus: 'TRADE_SUCCESS', tradeNo: 'alipay-tx-1', totalAmount: '100.50' },
    });
    // 第二次 findUnique 返回更新后的 session
    sessionFindUnique.mockResolvedValueOnce(session).mockResolvedValueOnce(refreshedSession);

    const result = await service.confirmAlipayCheckout(sessionId, userId);

    expect(handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo,
        providerTxnId: 'alipay-tx-1',
        status: 'SUCCESS',
        skipSignatureVerification: true,
      }),
    );
    expect(result.status).toBe('COMPLETED');
    expect(result.orderIds).toEqual(['ord-aaa', 'ord-bbb']);
    expect(result.confirmedBy).toBe('active-query-success');
  });

  it('Scene 2: WAIT_BUYER_PAY 不应建单 / 不标失败', async () => {
    const session = {
      id: sessionId,
      userId,
      status: 'ACTIVE',
      paymentChannel: 'ALIPAY',
      merchantOrderNo,
      expectedTotal: 100,
      orders: [],
    };
    const { service, handlePaymentCallback } = buildService({
      session,
      queryResult: { tradeStatus: 'WAIT_BUYER_PAY', tradeNo: '', totalAmount: '100.00' },
    });

    const result = await service.confirmAlipayCheckout(sessionId, userId);

    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result.status).toBe('ACTIVE'); // session 状态保持
    expect(result.confirmedBy).toBe('alipay-wait_buyer_pay');
  });

  it('Scene 3: 金额不一致应拒绝建单并抛 BadRequestException', async () => {
    const session = {
      id: sessionId,
      userId,
      status: 'ACTIVE',
      paymentChannel: 'ALIPAY',
      merchantOrderNo,
      expectedTotal: 100,
      orders: [],
    };
    // 支付宝返回的金额比 session.expectedTotal 少（恶意篡改场景）
    const { service, handlePaymentCallback } = buildService({
      session,
      queryResult: { tradeStatus: 'TRADE_SUCCESS', tradeNo: 'tx', totalAmount: '0.01' },
    });

    await expect(service.confirmAlipayCheckout(sessionId, userId))
      .rejects.toThrow(BadRequestException);
    expect(handlePaymentCallback).not.toHaveBeenCalled();
  });

  it('Scene 4: 已 COMPLETED 的 session 应直接返现有订单（幂等）', async () => {
    const session = {
      id: sessionId,
      userId,
      status: 'COMPLETED',
      paymentChannel: 'ALIPAY',
      merchantOrderNo,
      expectedTotal: 100,
      orders: [{ id: 'ord-xxx' }],
    };
    const { service, queryOrder, handlePaymentCallback } = buildService({ session });

    const result = await service.confirmAlipayCheckout(sessionId, userId);

    expect(queryOrder).not.toHaveBeenCalled(); // 不再查支付宝
    expect(handlePaymentCallback).not.toHaveBeenCalled(); // 不再建单
    expect(result.status).toBe('COMPLETED');
    expect(result.orderIds).toEqual(['ord-xxx']);
    expect(result.confirmedBy).toBe('already-completed');
  });

  it('附加：session 不存在应抛 NotFoundException', async () => {
    const { service } = buildService({ session: null });
    await expect(service.confirmAlipayCheckout(sessionId, userId))
      .rejects.toThrow(NotFoundException);
  });

  it('附加：session 不属于当前用户应抛 NotFoundException', async () => {
    const session = { id: sessionId, userId: 'other-user', status: 'ACTIVE', paymentChannel: 'ALIPAY' };
    const { service } = buildService({ session });
    await expect(service.confirmAlipayCheckout(sessionId, userId))
      .rejects.toThrow(NotFoundException);
  });

  it('附加：非 ALIPAY 渠道应拒绝', async () => {
    const session = {
      id: sessionId, userId, status: 'ACTIVE',
      paymentChannel: 'WECHAT_PAY', merchantOrderNo, expectedTotal: 100, orders: [],
    };
    const { service } = buildService({ session });
    await expect(service.confirmAlipayCheckout(sessionId, userId))
      .rejects.toThrow(BadRequestException);
  });

  it('附加：支付宝查询异常应返回当前状态而非抛错', async () => {
    const session = {
      id: sessionId, userId, status: 'ACTIVE',
      paymentChannel: 'ALIPAY', merchantOrderNo, expectedTotal: 100, orders: [],
    };
    const { service, handlePaymentCallback } = buildService({ session, queryOrderShouldThrow: true });

    const result = await service.confirmAlipayCheckout(sessionId, userId);

    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result.status).toBe('ACTIVE');
    expect(result.confirmedBy).toBe('query-error');
  });

  it('active-query routes AS_SHIP_PAY success before CheckoutSession lookup', async () => {
    const shippingMerchantNo = 'AS_SHIP_PAY_as_001';
    const shippingPayment = {
      id: 'ship_pay_001',
      amount: 18.13,
      status: 'UNPAID',
      merchantPaymentNo: shippingMerchantNo,
      afterSale: { userId },
    };
    const { service, sessionFindUnique, queryOrder, handlePaymentCallback } = buildService({
      session: null,
      shippingPayment,
      queryResult: {
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'alipay-ship-tx-1',
        totalAmount: '18.13',
      },
    });

    const result = await service.confirmAlipayCheckout(shippingMerchantNo, userId);

    expect(sessionFindUnique).not.toHaveBeenCalled();
    expect(queryOrder).toHaveBeenCalledWith(shippingMerchantNo);
    expect(handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: shippingMerchantNo,
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

  it('active-query rejects AS_SHIP_PAY amount mismatch before callback', async () => {
    const shippingMerchantNo = 'AS_SHIP_PAY_as_001';
    const { service, sessionFindUnique, handlePaymentCallback } = buildService({
      session: null,
      shippingPayment: {
        id: 'ship_pay_001',
        amount: 18.13,
        status: 'UNPAID',
        merchantPaymentNo: shippingMerchantNo,
        afterSale: { userId },
      },
      queryResult: {
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'alipay-ship-tx-1',
        totalAmount: '18.12',
      },
    });

    await expect(service.confirmAlipayCheckout(shippingMerchantNo, userId))
      .rejects.toThrow(BadRequestException);

    expect(sessionFindUnique).not.toHaveBeenCalled();
    expect(handlePaymentCallback).not.toHaveBeenCalled();
  });

  it('active-query returns current AS_SHIP_PAY state for WAIT_BUYER_PAY without callback', async () => {
    const shippingMerchantNo = 'AS_SHIP_PAY_as_001';
    const { service, sessionFindUnique, handlePaymentCallback } = buildService({
      session: null,
      shippingPayment: {
        id: 'ship_pay_001',
        amount: 18.13,
        status: 'UNPAID',
        merchantPaymentNo: shippingMerchantNo,
        afterSale: { userId },
      },
      queryResult: {
        tradeStatus: 'WAIT_BUYER_PAY',
        tradeNo: '',
        totalAmount: '18.13',
      },
    });

    const result = await service.confirmAlipayCheckout(shippingMerchantNo, userId);

    expect(sessionFindUnique).not.toHaveBeenCalled();
    expect(handlePaymentCallback).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'UNPAID',
      orderIds: [],
      expectedTotal: 18.13,
      confirmedBy: 'alipay-wait_buyer_pay',
    });
  });
});

describe('PaymentService after-sale shipping payment callback', () => {
  const merchantOrderNo = 'AS_SHIP_PAY_as_001';

  const buildService = () => {
    const prisma = {
      afterSaleShippingPayment: {
        findUnique: jest.fn(),
      },
    };
    const checkoutService = {
      findByMerchantOrderNo: jest.fn(),
      handlePaymentSuccess: jest.fn(),
    };
    const service = new PaymentService(
      prisma as any,
      {} as any,
      {} as any,
      checkoutService as any,
    );
    const shippingPaymentService = {
      handlePaymentSuccess: jest.fn().mockResolvedValue(undefined),
      handlePaymentFailure: jest.fn().mockResolvedValue(undefined),
    };
    service.setAfterSaleShippingPaymentService(shippingPaymentService as any);
    return { service, prisma, checkoutService, shippingPaymentService };
  };

  it('routes AS_SHIP_PAY success before normal CheckoutSession/order flow', async () => {
    const { service, checkoutService, shippingPaymentService } = buildService();
    const paidAt = '2026-05-09T00:00:00.000Z';

    const result = await service.handlePaymentCallback({
      merchantOrderNo,
      providerTxnId: 'trade_001',
      status: 'SUCCESS',
      paidAt,
      rawPayload: {},
      skipSignatureVerification: true,
    });

    expect(result).toEqual({ code: 'SUCCESS', message: '售后退货运费支付成功' });
    expect(shippingPaymentService.handlePaymentSuccess).toHaveBeenCalledWith(
      merchantOrderNo,
      'trade_001',
      new Date(paidAt),
    );
    expect(checkoutService.findByMerchantOrderNo).not.toHaveBeenCalled();
    expect(checkoutService.handlePaymentSuccess).not.toHaveBeenCalled();
  });

  it('routes AS_SHIP_PAY failure without downgrading ordinary order state', async () => {
    const { service, checkoutService, shippingPaymentService } = buildService();

    const result = await service.handlePaymentCallback({
      merchantOrderNo,
      providerTxnId: 'trade_001',
      status: 'FAILED',
      rawPayload: {},
      skipSignatureVerification: true,
    });

    expect(result).toEqual({ code: 'SUCCESS', message: '售后退货运费支付失败已记录' });
    expect(shippingPaymentService.handlePaymentFailure).toHaveBeenCalledWith(
      merchantOrderNo,
      '支付失败',
    );
    expect(checkoutService.findByMerchantOrderNo).not.toHaveBeenCalled();
  });

  it('assertAfterSaleShippingPaymentAmountMatches compares rounded cents', async () => {
    const { service, prisma } = buildService();
    prisma.afterSaleShippingPayment.findUnique.mockResolvedValue({
      amount: 18.126,
      status: 'UNPAID',
    });

    await expect(service.assertAfterSaleShippingPaymentAmountMatches(
      merchantOrderNo,
      '18.13',
    )).resolves.toBeUndefined();
  });

  it('assertAfterSaleShippingPaymentAmountMatches rejects missing or mismatched payments', async () => {
    const { service, prisma } = buildService();
    prisma.afterSaleShippingPayment.findUnique.mockResolvedValue(null);

    await expect(service.assertAfterSaleShippingPaymentAmountMatches(
      merchantOrderNo,
      '18.13',
    )).rejects.toThrow(BadRequestException);

    prisma.afterSaleShippingPayment.findUnique.mockResolvedValue({ amount: 18.12 });
    await expect(service.assertAfterSaleShippingPaymentAmountMatches(
      merchantOrderNo,
      '18.13',
    )).rejects.toThrow(BadRequestException);
  });
});
