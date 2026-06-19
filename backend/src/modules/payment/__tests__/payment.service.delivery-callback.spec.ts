import { PaymentService } from '../payment.service';

describe('PaymentService delivery payment callback routing', () => {
  it('routes PSZF merchantOrderNo into DeliveryPaymentsService before normal checkout/payment handling', async () => {
    const deliveryPaymentsService = {
      handlePaymentCallback: jest.fn().mockResolvedValue({ code: 'SUCCESS', message: '配送支付处理成功' }),
    };
    const checkoutService = {
      findByMerchantOrderNo: jest.fn(),
    };
    const prisma = {
      payment: {
        findUnique: jest.fn(),
      },
    };

    const service = new PaymentService(
      prisma as any,
      { get: jest.fn() } as any,
      {} as any,
      checkoutService as any,
      undefined,
      undefined,
      undefined,
      undefined,
      deliveryPaymentsService as any,
    );

    const result = await service.handlePaymentCallback({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      status: 'SUCCESS',
      paymentChannel: 'ALIPAY',
      rawPayload: { total_amount: '49.00' },
      skipSignatureVerification: true,
    } as any);

    expect(deliveryPaymentsService.handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: 'PSZF0000000000001',
        providerTxnId: 'ALI_TXN_1',
        status: 'SUCCESS',
        paymentChannel: 'ALIPAY',
        claimedAmountCents: 4900,
        rawPayload: { total_amount: '49.00' },
        skipSignatureVerification: true,
      }),
    );
    expect(checkoutService.findByMerchantOrderNo).not.toHaveBeenCalled();
    expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    expect(result).toEqual({ code: 'SUCCESS', message: '配送支付处理成功' });
  });

  it('keeps PSZF failure callbacks out of normal payment/order lookups and writes', async () => {
    const deliveryPaymentsService = {
      handlePaymentCallback: jest.fn().mockResolvedValue({ code: 'SUCCESS', message: '配送支付失败已记录' }),
    };
    const checkoutService = {
      findByMerchantOrderNo: jest.fn(),
      handlePaymentSuccess: jest.fn(),
    };
    const prisma = {
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      rewardLedger: {
        create: jest.fn(),
      },
      couponInstance: {
        updateMany: jest.fn(),
      },
      digitalAssetLedger: {
        create: jest.fn(),
      },
      userReferralBinding: {
        updateMany: jest.fn(),
      },
    };

    const service = new PaymentService(
      prisma as any,
      { get: jest.fn() } as any,
      {} as any,
      checkoutService as any,
      undefined,
      undefined,
      undefined,
      undefined,
      deliveryPaymentsService as any,
    );

    const result = await service.handlePaymentCallback({
      merchantOrderNo: 'PSZF0000000000002',
      providerTxnId: 'ALI_TXN_2',
      status: 'FAILED',
      paymentChannel: 'ALIPAY',
      rawPayload: { trade_status: 'TRADE_CLOSED' },
      skipSignatureVerification: true,
    } as any);

    expect(deliveryPaymentsService.handlePaymentCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: 'PSZF0000000000002',
        providerTxnId: 'ALI_TXN_2',
        status: 'FAILED',
        paymentChannel: 'ALIPAY',
        rawPayload: { trade_status: 'TRADE_CLOSED' },
        skipSignatureVerification: true,
      }),
    );
    expect(checkoutService.findByMerchantOrderNo).not.toHaveBeenCalled();
    expect(checkoutService.handlePaymentSuccess).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(prisma.rewardLedger.create).not.toHaveBeenCalled();
    expect(prisma.couponInstance.updateMany).not.toHaveBeenCalled();
    expect(prisma.digitalAssetLedger.create).not.toHaveBeenCalled();
    expect(prisma.userReferralBinding.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ code: 'SUCCESS', message: '配送支付失败已记录' });
  });

  it('rejects generic PSZF success callbacks without explicit amount and channel', async () => {
    const deliveryPaymentsService = {
      handlePaymentCallback: jest.fn(),
    };
    const checkoutService = {
      findByMerchantOrderNo: jest.fn(),
    };
    const prisma = {
      payment: {
        findUnique: jest.fn(),
      },
    };

    const service = new PaymentService(
      prisma as any,
      { get: jest.fn() } as any,
      {} as any,
      checkoutService as any,
      undefined,
      undefined,
      undefined,
      undefined,
      deliveryPaymentsService as any,
    );

    await expect(
      service.handlePaymentCallback({
        merchantOrderNo: 'PSZF0000000000003',
        providerTxnId: 'ALI_TXN_3',
        status: 'SUCCESS',
        rawPayload: {},
        skipSignatureVerification: true,
      } as any),
    ).rejects.toThrow('配送支付成功回调缺少明确的支付渠道');

    expect(deliveryPaymentsService.handlePaymentCallback).not.toHaveBeenCalled();
    expect(checkoutService.findByMerchantOrderNo).not.toHaveBeenCalled();
    expect(prisma.payment.findUnique).not.toHaveBeenCalled();
  });
});
