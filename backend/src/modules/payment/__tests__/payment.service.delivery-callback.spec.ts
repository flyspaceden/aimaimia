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
      rawPayload: { total_amount: '49.00' },
      skipSignatureVerification: true,
    });

    expect(deliveryPaymentsService.handlePaymentCallback).toHaveBeenCalledWith({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      status: 'SUCCESS',
      rawPayload: { total_amount: '49.00' },
      skipSignatureVerification: true,
    });
    expect(checkoutService.findByMerchantOrderNo).not.toHaveBeenCalled();
    expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    expect(result).toEqual({ code: 'SUCCESS', message: '配送支付处理成功' });
  });
});
