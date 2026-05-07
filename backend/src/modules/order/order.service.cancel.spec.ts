import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';

describe('OrderService cancel PAID orders', () => {
  const makeService = () => {
    const prisma = {
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      shipment: {
        findMany: jest.fn(),
      },
      refund: {
        findFirst: jest.fn(),
      },
      companyStaff: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const service = new OrderService(prisma as any, {} as any, {} as any);
    return { service, prisma };
  };

  it('多商户 CheckoutSession 且 sibling 全 PAID 时路由到整 session 取消', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      checkoutSessionId: 'cs1',
      items: [],
    });
    prisma.order.findMany.mockResolvedValue([{ id: 'o2', status: 'PAID' }]);
    (service as any).cancelEntireSessionUnshipped = jest.fn().mockResolvedValue({ id: 'o1' });

    const result = await service.cancelOrder('o1', 'u1');

    expect((service as any).cancelEntireSessionUnshipped).toHaveBeenCalledWith('cs1', 'u1');
    expect(result).toEqual({ id: 'o1' });
  });

  it('多商户 CheckoutSession 存在非 PAID sibling 时拒绝整单取消', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      checkoutSessionId: 'cs1',
      items: [],
    });
    prisma.order.findMany.mockResolvedValue([{ id: 'o2', status: 'SHIPPED' }]);

    await expect(service.cancelOrder('o1', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('PAID 未发货单订单取消会恢复库存、奖励、红包并发起退款', async () => {
    const { service, prisma } = makeService();
    const order = {
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      checkoutSessionId: 'cs1',
      totalAmount: 65,
      items: [{ skuId: 'sku1', quantity: 2, companyId: 'c1' }],
    };
    const refund = {
      id: 'r1',
      merchantRefundNo: 'AUTO-CANCEL-o1',
    };
    const tx = {
      $executeRaw: jest.fn(),
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      rewardLedger: { updateMany: jest.fn() },
      refund: {
        create: jest.fn().mockResolvedValue(refund),
        update: jest.fn(),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    prisma.order.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ ...order, createdAt: new Date(), afterSaleRequests: [], refunds: [], shipments: [] });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    const couponService = { restoreCouponsForOrder: jest.fn() };
    const paymentService = {
      initiateRefund: jest.fn().mockResolvedValue({
        success: true,
        providerRefundId: 'AUTO-CANCEL-o1',
      }),
    };
    service.setCouponService(couponService as any);
    service.setPaymentService(paymentService as any);

    await service.cancelOrder('o1', 'u1');

    expect(tx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'sku1' },
      data: { stock: { increment: 2 } },
    });
    expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({
      where: { refType: 'ORDER', refId: 'o1', status: 'VOIDED' },
      data: { status: 'AVAILABLE', refType: null, refId: null },
    });
    expect(couponService.restoreCouponsForOrder).toHaveBeenCalledWith('o1', tx);
    expect(paymentService.initiateRefund).toHaveBeenCalledWith('o1', 65, 'AUTO-CANCEL-o1');
    expect(tx.refund.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'REFUNDED', providerRefundId: 'AUTO-CANCEL-o1' },
    });
  });
});
