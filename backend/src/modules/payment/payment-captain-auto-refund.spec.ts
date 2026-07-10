jest.mock('../delivery/payments/delivery-payments.service', () => ({
  DeliveryPaymentsService: class DeliveryPaymentsService {},
}));

import { PaymentService } from './payment.service';

describe('PaymentService captain auto-refund hook', () => {
  it('preserves legacy captain voiding when an auto-cancel refund has no profit snapshot', async () => {
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    const profitRefund = {
      finalizeSuccessfulRefund: jest.fn().mockResolvedValue({ mode: 'LEGACY', orderId: 'order-1' }),
    };
    (service as any).setOrderProfitRefundService(profitRefund);

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
    expect(profitRefund.finalizeSuccessfulRefund).toHaveBeenCalledWith(tx, 'refund-1');
  });

  it('finalizes a V3 refund inside the refund CAS transaction and skips legacy whole-order voiding', async () => {
    const tx: any = {
      refund: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 'refund-1', status: 'REFUNDING', orderId: 'order-1', amount: 80 })
          .mockResolvedValueOnce({
            id: 'refund-1', merchantRefundNo: 'AUTO-CANCEL-order-1',
            order: { id: 'order-1', checkoutSessionId: null, goodsAmount: 100, discountAmount: 0 },
          }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refundStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = { $transaction: jest.fn(async (callback: any) => callback(tx)) };
    const captainCommission = { voidForRefund: jest.fn() };
    const profitRefund = {
      finalizeSuccessfulRefund: jest.fn().mockResolvedValue({ mode: 'V3', orderId: 'order-1' }),
    };
    const service = new PaymentService(
      prisma, {} as any, {} as any, undefined, undefined, undefined,
      undefined, undefined, captainCommission as any,
    );
    (service as any).setOrderProfitRefundService(profitRefund);

    await expect((service as any).finalizeAutoRefundRecord({
      refundId: 'refund-1', fromStatuses: ['REFUNDING'], toStatus: 'REFUNDED', remark: '退款成功',
    })).resolves.toBe(true);

    expect(profitRefund.finalizeSuccessfulRefund).toHaveBeenCalledWith(tx, 'refund-1');
    expect(captainCommission.voidForRefund).not.toHaveBeenCalled();
  });

  it('converges repeated provider success/query compensation on one V3 reversal', async () => {
    let status = 'REFUNDING';
    const tx: any = {
      refund: {
        findUnique: jest.fn(async () => ({
          id: 'refund-1', status, orderId: 'order-1', amount: 80,
          merchantRefundNo: 'AUTO-CANCEL-order-1',
          order: { id: 'order-1', checkoutSessionId: null, goodsAmount: 80, discountAmount: 0 },
        })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (status !== where.status) return { count: 0 };
          status = data.status;
          return { count: 1 };
        }),
      },
      refundStatusHistory: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn(async (callback: any) => callback(tx)) };
    const profitRefund = {
      finalizeSuccessfulRefund: jest.fn().mockResolvedValue({ mode: 'V3', orderId: 'order-1' }),
    };
    const service = new PaymentService(prisma, {} as any, {} as any);
    service.setOrderProfitRefundService(profitRefund as any);
    const params = {
      refundId: 'refund-1', fromStatuses: ['REFUNDING'], toStatus: 'REFUNDED' as const,
      remark: '渠道退款成功',
    };

    await expect(service.finalizeAutoRefundRecord(params)).resolves.toBe(true);
    await expect(service.finalizeAutoRefundRecord(params)).resolves.toBe(false);

    expect(profitRefund.finalizeSuccessfulRefund).toHaveBeenCalledTimes(1);
    expect(tx.refundStatusHistory.create).toHaveBeenCalledTimes(1);
  });
});
