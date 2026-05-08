import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';

describe('OrderService cancel PAID orders', () => {
  const makeService = () => {
    const bonusAllocation = {
      allocateForOrder: jest.fn(),
    };
    const prisma = {
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      company: {
        findMany: jest.fn().mockResolvedValue([]),
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
    const service = new OrderService(prisma as any, bonusAllocation as any, {} as any);
    return { service, prisma, bonusAllocation };
  };

  const injectInboxService = (service: OrderService) => {
    const inboxService = { send: jest.fn() };
    service.setInboxService(inboxService as any);
    return inboxService;
  };

  it('订单取消后 getById 在响应中暴露最新退款摘要', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      status: 'CANCELED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 65,
      goodsAmount: 60,
      shippingFee: 5,
      discountAmount: 0,
      createdAt: new Date('2026-05-08T00:00:00.000Z'),
      items: [],
      shipments: [],
      statusHistory: [],
      payments: [],
      afterSaleRequests: [],
      refunds: [{
        id: 'r1',
        amount: 65,
        status: 'REFUNDING',
        reason: '买家未发货取消订单',
        merchantRefundNo: 'AUTO-CANCEL-o1',
        providerRefundId: null,
        updatedAt: new Date('2026-05-08T00:01:00.000Z'),
      }],
    });

    const out = await service.getById('o1', 'u1');

    expect(out.refundSummary).toMatchObject({
      id: 'r1',
      amount: 65,
      status: 'REFUNDING',
      reason: '买家未发货取消订单',
    });
  });

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
    const { service, prisma, bonusAllocation } = makeService();
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
    expect(tx.inventoryLedger.create).toHaveBeenCalledWith({
      data: {
        skuId: 'sku1',
        type: 'RELEASE',
        qty: 2,
        refType: 'ORDER',
        refId: 'o1',
      },
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
    expect(bonusAllocation.allocateForOrder).not.toHaveBeenCalled();
  });

  it('VIP_PACKAGE 不允许买家未发货取消退款', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'vip-o1',
      userId: 'u1',
      status: 'PAID',
      bizType: 'VIP_PACKAGE',
      items: [],
    });

    await expect(service.cancelOrder('vip-o1', 'u1')).rejects.toThrow('VIP');
  });

  it('PAID 但已存在 waybillNo 时取消被拒绝', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
      items: [{ skuId: 'sku1', quantity: 1, companyId: 'c1' }],
    });
    prisma.shipment.findMany.mockResolvedValue([{ id: 's1', status: 'INIT', waybillNo: 'SF1234567' }]);

    await expect(service.cancelOrder('o1', 'u1')).rejects.toThrow(/面单|发货/);
    expect(prisma.shipment.findMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', waybillNo: { not: null } },
      select: { id: true, status: true },
    });
  });

  it('PAID 已有 Shipment 但 waybillNo 为空时允许取消', async () => {
    const { service, prisma } = makeService();
    const order = {
      id: 'o-null-waybill',
      userId: 'u1',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
      totalAmount: 20,
      items: [{ skuId: 'sku1', quantity: 1, companyId: 'c1' }],
    };
    const refund = {
      id: 'r-null-waybill',
      merchantRefundNo: 'AUTO-CANCEL-o-null-waybill',
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
    prisma.shipment.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.orderId === 'o-null-waybill' && args?.where?.waybillNo?.not === null) {
        return [];
      }
      return [{ id: 's-null', status: 'INIT', waybillNo: null }];
    });
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await service.cancelOrder('o-null-waybill', 'u1');

    expect(result.id).toBe('o-null-waybill');
    expect(prisma.shipment.findMany).toHaveBeenCalledWith({
      where: { orderId: 'o-null-waybill', waybillNo: { not: null } },
      select: { id: true, status: true },
    });
  });

  it('PAID 未发货取消成功后向卖家发通知', async () => {
    const { service, prisma } = makeService();
    const inboxService = injectInboxService(service);
    const order = {
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
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
    prisma.companyStaff.findMany.mockResolvedValue([{ userId: 'owner-user-1', companyId: 'c1' }]);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    service.setPaymentService({
      initiateRefund: jest.fn().mockResolvedValue({
        success: true,
        providerRefundId: 'AUTO-CANCEL-o1',
      }),
    } as any);

    await service.cancelOrder('o1', 'u1');

    expect(inboxService.send).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner-user-1',
      category: 'order',
      type: 'order.canceled.by.buyer',
      target: { route: '/orders/[id]', params: { id: 'o1' } },
    }));
  });

  it('已生成面单导致取消失败时不发通知', async () => {
    const { service, prisma } = makeService();
    const inboxService = injectInboxService(service);
    prisma.order.findUnique.mockResolvedValue({
      id: 'o2',
      userId: 'u1',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
      items: [{ skuId: 'sku1', quantity: 1, companyId: 'c1' }],
    });
    prisma.shipment.findMany.mockResolvedValue([{ id: 's1', status: 'INIT', waybillNo: 'SF1234567' }]);

    await expect(service.cancelOrder('o2', 'u1')).rejects.toThrow();
    expect(inboxService.send).not.toHaveBeenCalled();
  });
});
