jest.mock('../delivery/payments/delivery-payments.service', () => ({
  DeliveryPaymentsService: class DeliveryPaymentsService {},
}));

import { PaymentService } from './payment.service';

describe('PaymentService captain auto-refund hook', () => {
  it('voids captain commission when an auto-cancel refund is finalized as refunded', async () => {
    const tx: any = {
      refund: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'refund-1',
            status: 'REFUNDING',
            orderId: 'order-1',
            amount: 80,
          })
          .mockResolvedValueOnce({
            id: 'refund-1',
            merchantRefundNo: 'AUTO-CANCEL-order-1',
            order: {
              id: 'order-1',
              checkoutSessionId: null,
              goodsAmount: 100,
              discountAmount: 0,
            },
          }),
        update: jest.fn().mockResolvedValue({}),
      },
      refundStatusHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const captainCommission = {
      voidForRefund: jest.fn().mockResolvedValue('voided'),
    };
    const service = new PaymentService(
      prisma,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      captainCommission as any,
    );

    await expect((service as any).finalizeAutoRefundRecord({
      refundId: 'refund-1',
      fromStatuses: ['REFUNDING'],
      toStatus: 'REFUNDED',
      remark: '微信退款成功',
      providerRefundId: 'provider-1',
    })).resolves.toBe(true);

    expect(captainCommission.voidForRefund).toHaveBeenCalledWith(
      'order-1',
      'refund-1',
      80,
    );
  });
});
