import { BadRequestException } from '@nestjs/common';
import { PaymentController } from './payment.controller';

describe('PaymentController.handleAlipayNotify', () => {
  const notifyBody = {
    out_trade_no: 'CS-1234567890-abc',
    trade_no: '2026043022000000001',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '100.00',
    gmt_payment: '2026-04-30 13:50:00',
  };

  const buildController = (overrides?: {
    findByMerchantOrderNo?: jest.Mock;
    assertAlipayAmountMatchesSession?: jest.Mock;
    handlePaymentCallback?: jest.Mock;
  }) => {
    const paymentService = {
      handlePaymentCallback: overrides?.handlePaymentCallback ?? jest.fn().mockResolvedValue({ code: 'SUCCESS' }),
      assertAlipayAmountMatchesSession: overrides?.assertAlipayAmountMatchesSession ?? jest.fn(),
      getByOrderId: jest.fn(),
    };
    const alipayService = {
      verifyNotify: jest.fn().mockResolvedValue(true),
    };
    const checkoutService = {
      findByMerchantOrderNo: overrides?.findByMerchantOrderNo ?? jest.fn().mockResolvedValue({
        expectedTotal: 100,
        merchantOrderNo: notifyBody.out_trade_no,
      }),
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    return {
      controller: new PaymentController(paymentService as any, alipayService as any, checkoutService as any),
      paymentService,
      alipayService,
      checkoutService,
      res,
    };
  };

  it('returns failure when session lookup throws so Alipay can retry', async () => {
    const { controller, paymentService, checkoutService, res } = buildController({
      findByMerchantOrderNo: jest.fn().mockRejectedValue(new Error('database unavailable')),
    });

    await controller.handleAlipayNotify(notifyBody, res as any);

    expect(checkoutService.findByMerchantOrderNo).toHaveBeenCalledWith(notifyBody.out_trade_no);
    expect(paymentService.assertAlipayAmountMatchesSession).not.toHaveBeenCalled();
    expect(paymentService.handlePaymentCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('failure');
  });

  it('returns success without creating an order when amount validation fails', async () => {
    const { controller, paymentService, res } = buildController({
      assertAlipayAmountMatchesSession: jest.fn(() => {
        throw new BadRequestException('支付金额校验失败，请联系客服');
      }),
    });

    await controller.handleAlipayNotify(notifyBody, res as any);

    expect(paymentService.assertAlipayAmountMatchesSession).toHaveBeenCalledWith(
      { expectedTotal: 100, merchantOrderNo: notifyBody.out_trade_no },
      notifyBody.total_amount,
      'notify',
    );
    expect(paymentService.handlePaymentCallback).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('success');
  });

  it('validates amount then handles callback when notify is valid', async () => {
    const { controller, paymentService, res } = buildController();

    await controller.handleAlipayNotify(notifyBody, res as any);

    expect(paymentService.assertAlipayAmountMatchesSession).toHaveBeenCalled();
    expect(paymentService.handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: notifyBody.out_trade_no,
        providerTxnId: notifyBody.trade_no,
        status: 'SUCCESS',
        skipSignatureVerification: true,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('success');
  });
});
