import { PaymentService } from './payment.service';

describe('PaymentService.initiateRefund', () => {
  const makeService = () => {
    const prisma = {
      payment: { findFirst: jest.fn() },
      order: { findUnique: jest.fn() },
      checkoutSession: { findUnique: jest.fn() },
    };
    const alipayService = {
      isAvailable: jest.fn(),
      refund: jest.fn(),
    };
    const service = new PaymentService(
      prisma as any,
      {} as any,
      alipayService as any,
    );
    return { service, prisma, alipayService };
  };

  it('无 Payment 行时通过 CheckoutSession 支付凭据发起支付宝退款', async () => {
    const { service, prisma, alipayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ checkoutSessionId: 'cs1' });
    prisma.checkoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'MO-123',
      paymentChannel: 'ALIPAY',
      status: 'COMPLETED',
    });
    alipayService.isAvailable.mockReturnValue(true);
    alipayService.refund.mockResolvedValue({ success: true, message: 'OK' });

    const result = await service.initiateRefund('o1', 65, 'AUTO-CANCEL-o1');

    expect(result).toEqual({
      success: true,
      providerRefundId: 'AUTO-CANCEL-o1',
      message: 'OK',
    });
    expect(alipayService.refund).toHaveBeenCalledWith({
      merchantOrderNo: 'MO-123',
      refundAmount: 65,
      merchantRefundNo: 'AUTO-CANCEL-o1',
      refundReason: '用户退款',
    });
  });

  it('拒绝使用非已支付 CheckoutSession 发起退款', async () => {
    const { service, prisma, alipayService } = makeService();
    prisma.payment.findFirst.mockResolvedValue(null);
    prisma.order.findUnique.mockResolvedValue({ checkoutSessionId: 'cs-expired' });
    prisma.checkoutSession.findUnique.mockResolvedValue({
      merchantOrderNo: 'MO-EXPIRED',
      paymentChannel: 'ALIPAY',
      status: 'EXPIRED',
    });

    const result = await service.initiateRefund('o1', 65, 'AUTO-CANCEL-o1');

    expect(result.success).toBe(false);
    expect(result.message).toContain('结算会话状态异常');
    expect(alipayService.refund).not.toHaveBeenCalled();
  });
});
