import { BadRequestException } from '@nestjs/common';
import { PaymentController } from '../payment.controller';

describe('PaymentController.handleWechatNotify', () => {
  const rawBody = '{"id":"notify-1","event_type":"TRANSACTION.SUCCESS"}';
  const headers = {
    'wechatpay-signature': 'sig',
    'wechatpay-timestamp': '1716537600',
    'wechatpay-nonce': 'nonce',
    'wechatpay-serial': 'serial',
  };
  const paymentNotify = {
    type: 'payment',
    appId: 'wx_app_1',
    mchId: 'mch_1',
    outTradeNo: 'CS-1234567890-abc',
    providerTxnId: 'wx_txn_1',
    tradeState: 'SUCCESS',
    amount: 100,
    amountFen: 10000,
    paidAt: new Date('2026-05-23T10:00:00.000Z'),
  };
  const refundNotify = {
    type: 'refund',
    mchId: 'mch_1',
    outTradeNo: 'CS-1234567890-abc',
    outRefundNo: 'AS-after_sale_1',
    providerTxnId: 'wx_refund_1',
    tradeState: 'SUCCESS',
    amount: 65,
    amountFen: 6500,
    totalAmountFen: 6500,
  };

  const buildController = (overrides?: {
    parsedNotify?: any;
    parseNotify?: jest.Mock;
    findByMerchantOrderNo?: jest.Mock;
    assertWechatAmountMatchesSession?: jest.Mock;
    assertWechatPaymentAmountMatches?: jest.Mock;
    assertWechatAfterSaleShippingPaymentAmountMatches?: jest.Mock;
    assertWechatDeliveryAmountMatches?: jest.Mock;
    handlePaymentCallback?: jest.Mock;
    handleWechatRefundNotify?: jest.Mock;
    getAppId?: jest.Mock;
    getMchId?: jest.Mock;
  }) => {
    const paymentService = {
      getByOrderId: jest.fn(),
      handlePaymentCallback: overrides?.handlePaymentCallback ?? jest.fn().mockResolvedValue({ code: 'SUCCESS' }),
      assertWechatAmountMatchesSession: overrides?.assertWechatAmountMatchesSession ?? jest.fn(),
      assertWechatPaymentAmountMatches: overrides?.assertWechatPaymentAmountMatches ?? jest.fn().mockResolvedValue(undefined),
      assertWechatAfterSaleShippingPaymentAmountMatches:
        overrides?.assertWechatAfterSaleShippingPaymentAmountMatches ?? jest.fn().mockResolvedValue(undefined),
      handleWechatRefundNotify: overrides?.handleWechatRefundNotify ?? jest.fn().mockResolvedValue(undefined),
    };
    const alipayService = { verifyNotify: jest.fn() };
    const checkoutService = {
      findByMerchantOrderNo: overrides?.findByMerchantOrderNo ?? jest.fn().mockResolvedValue({
        expectedTotal: 100,
        merchantOrderNo: paymentNotify.outTradeNo,
      }),
    };
    const wechatPayService = {
      parseNotify: overrides?.parseNotify ?? jest.fn().mockResolvedValue(overrides?.parsedNotify ?? paymentNotify),
      getAppId: overrides?.getAppId ?? jest.fn().mockReturnValue('wx_app_1'),
      getMchId: overrides?.getMchId ?? jest.fn().mockReturnValue('mch_1'),
    };
    const deliveryPaymentsService = {
      assertWechatAmountMatchesCheckout:
        overrides?.assertWechatDeliveryAmountMatches ?? jest.fn().mockResolvedValue(undefined),
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    return {
      controller: new PaymentController(
        paymentService as any,
        alipayService as any,
        checkoutService as any,
        undefined,
        undefined,
        wechatPayService as any,
        deliveryPaymentsService as any,
      ),
      paymentService,
      checkoutService,
      deliveryPaymentsService,
      wechatPayService,
      res,
    };
  };

  it('returns 401 when WeChat signature parsing fails', async () => {
    const { controller, res } = buildController({
      parseNotify: jest.fn().mockRejectedValue(new Error('bad signature')),
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({ code: 'FAIL', message: 'bad signature' });
  });

  it('returns 401 when payment appid does not match configured appid', async () => {
    const { controller, paymentService, res } = buildController({
      parsedNotify: { ...paymentNotify, appId: 'wx_other' },
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(paymentService.handlePaymentCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({ code: 'FAIL', message: '微信支付通知身份不匹配' });
  });

  it('returns 401 when payment mchid does not match configured mchid', async () => {
    const { controller, paymentService, res } = buildController({
      parsedNotify: { ...paymentNotify, mchId: 'mch_other' },
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(paymentService.handlePaymentCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({ code: 'FAIL', message: '微信支付通知身份不匹配' });
  });

  it('acks 200 without callback when payment amount validation fails', async () => {
    const { controller, paymentService, res } = buildController({
      assertWechatAmountMatchesSession: jest.fn(() => {
        throw new BadRequestException('微信支付金额校验失败');
      }),
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(paymentService.assertWechatAmountMatchesSession).toHaveBeenCalledWith(
      { expectedTotal: 100, merchantOrderNo: paymentNotify.outTradeNo },
      paymentNotify.amountFen,
      'notify',
    );
    expect(paymentService.handlePaymentCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith();
  });

  it('validates amount and handles payment callback on payment success', async () => {
    const { controller, paymentService, res } = buildController();

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(paymentService.assertWechatAmountMatchesSession).toHaveBeenCalled();
    expect(paymentService.handlePaymentCallback).toHaveBeenCalledWith({
      merchantOrderNo: paymentNotify.outTradeNo,
      providerTxnId: paymentNotify.providerTxnId,
      status: 'SUCCESS',
      paidAt: paymentNotify.paidAt.toISOString(),
      rawPayload: {},
      skipSignatureVerification: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith();
  });

  it('validates legacy Payment amount when CheckoutSession is not found', async () => {
    const { controller, paymentService, res } = buildController({
      findByMerchantOrderNo: jest.fn().mockResolvedValue(null),
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(paymentService.assertWechatAmountMatchesSession).not.toHaveBeenCalled();
    expect(paymentService.assertWechatPaymentAmountMatches).toHaveBeenCalledWith(
      paymentNotify.outTradeNo,
      paymentNotify.amountFen,
    );
    expect(paymentService.handlePaymentCallback).toHaveBeenCalled();
  });

  it('acks 200 without callback when CheckoutSession and legacy Payment are missing', async () => {
    const { controller, paymentService, res } = buildController({
      findByMerchantOrderNo: jest.fn().mockResolvedValue(null),
      assertWechatPaymentAmountMatches: jest.fn().mockRejectedValue(new BadRequestException('支付记录不存在')),
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(paymentService.assertWechatPaymentAmountMatches).toHaveBeenCalled();
    expect(paymentService.handlePaymentCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith();
  });

  it('validates after-sale shipping payment amount without CheckoutSession lookup', async () => {
    const shippingNotify = {
      ...paymentNotify,
      outTradeNo: 'AS_SHIP_PAY_after_sale_1',
      amount: 18.13,
      amountFen: 1813,
    };
    const { controller, paymentService, checkoutService, res } = buildController({
      parsedNotify: shippingNotify,
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(checkoutService.findByMerchantOrderNo).not.toHaveBeenCalled();
    expect(paymentService.assertWechatAfterSaleShippingPaymentAmountMatches).toHaveBeenCalledWith(
      'AS_SHIP_PAY_after_sale_1',
      1813,
    );
    expect(paymentService.handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: 'AS_SHIP_PAY_after_sale_1',
        providerTxnId: paymentNotify.providerTxnId,
        status: 'SUCCESS',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith();
  });

  it('validates delivery payment amount without normal CheckoutSession lookup', async () => {
    const deliveryNotify = {
      ...paymentNotify,
      outTradeNo: 'PSZF0000000000001',
      amount: 49,
      amountFen: 4900,
    };
    const { controller, paymentService, checkoutService, deliveryPaymentsService, res } =
      buildController({
        parsedNotify: deliveryNotify,
      });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(checkoutService.findByMerchantOrderNo).not.toHaveBeenCalled();
    expect(paymentService.assertWechatAmountMatchesSession).not.toHaveBeenCalled();
    expect(paymentService.assertWechatPaymentAmountMatches).not.toHaveBeenCalled();
    expect(deliveryPaymentsService.assertWechatAmountMatchesCheckout).toHaveBeenCalledWith(
      'PSZF0000000000001',
      4900,
    );
    expect(paymentService.handlePaymentCallback).toHaveBeenCalledWith({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: paymentNotify.providerTxnId,
      status: 'SUCCESS',
      paidAt: paymentNotify.paidAt.toISOString(),
      paymentChannel: 'WECHAT_PAY',
      claimedAmountCents: 4900,
      rawPayload: {},
      skipSignatureVerification: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith();
  });

  it.each(['SUCCESS', 'CLOSED'])('delegates refund %s notify to PaymentService', async (tradeState) => {
    const parsedNotify = {
      ...refundNotify,
      tradeState,
    };
    const { controller, paymentService, res } = buildController({
      parsedNotify,
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(paymentService.handleWechatRefundNotify).toHaveBeenCalledWith({
      outTradeNo: refundNotify.outTradeNo,
      outRefundNo: refundNotify.outRefundNo,
      providerRefundId: refundNotify.providerTxnId,
      tradeState,
      amountFen: refundNotify.amountFen,
      totalAmountFen: refundNotify.totalAmountFen,
      rawPayload: {},
    });
    expect(paymentService.handlePaymentCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith();
  });

  it('returns 401 when refund mchid does not match configured mchid', async () => {
    const { controller, paymentService, res } = buildController({
      parsedNotify: { ...refundNotify, mchId: 'mch_other' },
    });

    await controller.handleWechatNotify({}, { rawBody } as any, headers as any, res as any);

    expect(paymentService.handleWechatRefundNotify).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith({ code: 'FAIL', message: '微信支付通知身份不匹配' });
  });
});
