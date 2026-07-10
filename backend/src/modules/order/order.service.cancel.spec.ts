import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';

describe('OrderService cancel PAID orders', () => {
  const makeService = () => {
    const bonusAllocation = {
      allocateForOrder: jest.fn(),
      rollbackForOrder: jest.fn().mockResolvedValue(undefined),
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
    const productBundleService = {
      buildInventoryMovements: jest.fn(),
    };
    const service = new OrderService(
      prisma as any,
      bonusAllocation as any,
      {} as any,
      {} as any,
      {} as any,
      productBundleService as any,
    );
    return { service, prisma, bonusAllocation, productBundleService };
  };

  const injectNotificationService = (service: OrderService) => {
    const notificationService = { emit: jest.fn().mockResolvedValue(undefined) };
    service.setNotificationService(notificationService as any);
    return notificationService;
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

  it('PAID 未发货单订单取消会恢复库存、红包并在退款成功后返还抵扣积分', async () => {
    const { service, prisma, bonusAllocation } = makeService();
    const order = {
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      checkoutSessionId: 'cs1',
      totalAmount: 65,
      goodsAmount: 60,
      discountAmount: 8,
      items: [{ skuId: 'sku1', quantity: 2, companyId: 'c1' }],
    };
    const refund = {
      id: 'r1',
      merchantRefundNo: 'AUTO-CANCEL-o1',
    };
    const initialTx = {
      $executeRaw: jest.fn(),
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue({
          deductionGroupId: 'DG-1',
          goodsAmount: 60,
          discountAmount: 8,
          groupBuyRebateDeductionGroupId: 'GBD-1',
          groupBuyRebateDeductionAmount: 3,
        }),
      },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: {
        create: jest.fn().mockResolvedValue(refund),
        update: jest.fn(),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    const finalTx = {
      refund: { update: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.order.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ ...order, createdAt: new Date(), afterSaleRequests: [], refunds: [], shipments: [] });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(initialTx))
      .mockImplementationOnce(async (callback: any) => callback(finalTx));
    const couponService = { restoreCouponsForOrder: jest.fn() };
    const paymentService = {
      initiateRefund: jest.fn().mockResolvedValue({
        success: true,
        providerRefundId: 'AUTO-CANCEL-o1',
      }),
    };
    service.setCouponService(couponService as any);
    service.setPaymentService(paymentService as any);
    const rewardDeductionService = {
      refundDeduction: jest.fn(),
    };
    service.setRewardDeductionService(rewardDeductionService as any);
    const groupBuyRebateDeductionService = {
      refundDeduction: jest.fn(),
    };
    (service as any).setGroupBuyRebateDeductionService(groupBuyRebateDeductionService);
    const digitalAssetService = {
      reverseRefund: jest.fn().mockResolvedValue(undefined),
    };
    service.setDigitalAssetService(digitalAssetService as any);

    await service.cancelOrder('o1', 'u1');

    expect(initialTx.productSKU.update).toHaveBeenCalledWith({
      where: { id: 'sku1' },
      data: { stock: { increment: 2 } },
    });
    expect(initialTx.inventoryLedger.create).toHaveBeenCalledWith({
      data: {
        skuId: 'sku1',
        type: 'RELEASE',
        qty: 2,
        refType: 'ORDER',
        refId: 'o1',
      },
    });
    expect(couponService.restoreCouponsForOrder).toHaveBeenCalledTimes(1);
    expect(couponService.restoreCouponsForOrder).toHaveBeenCalledWith('o1', finalTx);
    expect(couponService.restoreCouponsForOrder).not.toHaveBeenCalledWith('o1', initialTx);
    expect(paymentService.initiateRefund).toHaveBeenCalledWith('o1', 65, 'AUTO-CANCEL-o1');
    expect(finalTx.refund.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'REFUNDED', providerRefundId: 'AUTO-CANCEL-o1' },
    });
    expect(rewardDeductionService.refundDeduction).toHaveBeenCalledWith(finalTx, expect.objectContaining({
      refundId: 'r1',
      orderId: 'o1',
      originalGoodsAmount: 60,
      originalGoodsRefundAmount: 60,
      originalDeductAmount: 8,
      deductionGroupId: 'DG-1',
      isFinalRefund: true,
    }));
    expect(groupBuyRebateDeductionService.refundDeduction).toHaveBeenCalledWith(finalTx, expect.objectContaining({
      refundId: 'r1',
      orderId: 'o1',
      originalGoodsAmount: 60,
      originalGoodsRefundAmount: 60,
      originalDeductAmount: 3,
      deductionGroupId: 'GBD-1',
      isFinalRefund: true,
    }));
    expect(digitalAssetService.reverseRefund).toHaveBeenCalledWith('r1');
    expect(bonusAllocation.allocateForOrder).not.toHaveBeenCalled();
    expect(bonusAllocation.rollbackForOrder).toHaveBeenCalledWith('o1', initialTx);
    expect(bonusAllocation.rollbackForOrder.mock.invocationCallOrder[0])
      .toBeLessThan(paymentService.initiateRefund.mock.invocationCallOrder[0]);
  });

  it('V3 未发货整单取消展开非奖品 RefundItems 并由 Payment finalizer 只冲回一次', async () => {
    const { service, prisma, bonusAllocation } = makeService();
    const order = {
      id: 'o-v3', userId: 'u1', status: 'PAID', checkoutSessionId: null,
      totalAmount: 105, goodsAmount: 100, shippingFee: 5, discountAmount: 0,
      items: [
        { id: 'item-1', skuId: 'sku1', quantity: 2, unitPrice: 50, companyId: 'c1', isPrize: false },
        { id: 'prize-1', skuId: 'sku-prize', quantity: 1, unitPrice: 0, companyId: 'c1', isPrize: true },
      ],
    };
    const tx = {
      $executeRaw: jest.fn(),
      checkoutSession: { findUnique: jest.fn().mockResolvedValue(null) },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: { create: jest.fn().mockResolvedValue({ id: 'refund-v3', merchantRefundNo: 'AUTO-CANCEL-o-v3' }) },
      refundItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
      orderProfitSnapshot: { findFirst: jest.fn().mockResolvedValue({
        id: 'snapshot-v3',
        itemBreakdown: [{ orderItemId: 'item-1', netGoodsRevenueCents: 9_000 }],
      }) },
    };
    prisma.order.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ ...order, createdAt: new Date(), afterSaleRequests: [], refunds: [], shipments: [] });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(tx));
    const paymentService = {
      initiateRefund: jest.fn().mockResolvedValue({ success: true, providerRefundId: 'provider-v3' }),
      finalizeAutoRefundRecord: jest.fn().mockResolvedValue(true),
    };
    service.setPaymentService(paymentService as any);

    await service.cancelOrder('o-v3', 'u1');

    expect(tx.refundItem.createMany).toHaveBeenCalledWith({
      data: [{ refundId: 'refund-v3', orderItemId: 'item-1', skuId: 'sku1', quantity: 2, amount: 90 }],
      skipDuplicates: true,
    });
    expect(bonusAllocation.rollbackForOrder).not.toHaveBeenCalled();
    expect(paymentService.finalizeAutoRefundRecord).toHaveBeenCalledTimes(1);
    expect(paymentService.finalizeAutoRefundRecord).toHaveBeenCalledWith(expect.objectContaining({
      refundId: 'refund-v3', fromStatuses: ['REFUNDING'], toStatus: 'REFUNDED',
      providerRefundId: 'provider-v3',
    }));
  });

  it('PAID 未发货单订单取消如果分润回滚失败则拒绝且不发起外部退款', async () => {
    const { service, prisma, bonusAllocation } = makeService();
    const order = {
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      checkoutSessionId: 'cs1',
      totalAmount: 65,
      goodsAmount: 60,
      discountAmount: 0,
      items: [{ skuId: 'sku1', quantity: 2, companyId: 'c1' }],
    };
    const refund = {
      id: 'r1',
      merchantRefundNo: 'AUTO-CANCEL-o1',
    };
    const initialTx = {
      $executeRaw: jest.fn(),
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: {
        create: jest.fn().mockResolvedValue(refund),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    prisma.order.findUnique.mockResolvedValue(order);
    prisma.order.findMany.mockResolvedValue([]);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(initialTx));
    bonusAllocation.rollbackForOrder.mockRejectedValueOnce(new Error('rollback failed'));
    const paymentService = {
      initiateRefund: jest.fn().mockResolvedValue({ success: true }),
    };
    service.setPaymentService(paymentService as any);

    await expect(service.cancelOrder('o1', 'u1')).rejects.toThrow('rollback failed');

    expect(bonusAllocation.rollbackForOrder).toHaveBeenCalledWith('o1', initialTx);
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('PAID 未发货 bundle 单订单取消会回填组件库存而不是 bundle 售卖 SKU', async () => {
    const { service, prisma, productBundleService } = makeService();
    const order = {
      id: 'bundle-order-1',
      userId: 'u1',
      status: 'PAID',
      checkoutSessionId: 'cs-bundle-1',
      totalAmount: 88,
      goodsAmount: 88,
      discountAmount: 0,
      items: [{
        skuId: 'bundle-selling-sku',
        quantity: 2,
        companyId: 'bundle-company',
        productSnapshot: {
          productType: 'BUNDLE',
          bundleItems: [
            { skuId: 'component-sku-a', quantityPerBundle: 2 },
            { skuId: 'component-sku-b', quantityPerBundle: 1 },
          ],
        },
      }],
    };
    const refund = {
      id: 'refund-bundle-1',
      merchantRefundNo: 'AUTO-CANCEL-bundle-order-1',
    };
    const initialTx = {
      $executeRaw: jest.fn(),
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue({
          deductionGroupId: null,
          goodsAmount: 88,
          discountAmount: 0,
        }),
      },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: {
        create: jest.fn().mockResolvedValue(refund),
        update: jest.fn(),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    const finalTx = {
      refund: { update: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.order.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({
        ...order,
        createdAt: new Date(),
        afterSaleRequests: [],
        refunds: [],
        shipments: [],
      });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(initialTx))
      .mockImplementationOnce(async (callback: any) => callback(finalTx));
    productBundleService.buildInventoryMovements.mockReturnValue([
      { skuId: 'component-sku-a', quantity: 4, companyId: 'bundle-company', label: 'A' },
      { skuId: 'component-sku-b', quantity: 2, companyId: 'bundle-company', label: 'B' },
    ]);

    await service.cancelOrder('bundle-order-1', 'u1');

    expect(productBundleService.buildInventoryMovements).toHaveBeenCalledWith(order.items[0]);
    expect(initialTx.productSKU.update).toHaveBeenCalledTimes(2);
    expect(initialTx.productSKU.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'component-sku-a' },
      data: { stock: { increment: 4 } },
    });
    expect(initialTx.productSKU.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'component-sku-b' },
      data: { stock: { increment: 2 } },
    });
    expect(initialTx.inventoryLedger.create).toHaveBeenNthCalledWith(1, {
      data: {
        skuId: 'component-sku-a',
        type: 'RELEASE',
        qty: 4,
        refType: 'ORDER',
        refId: 'bundle-order-1',
      },
    });
    expect(initialTx.inventoryLedger.create).toHaveBeenNthCalledWith(2, {
      data: {
        skuId: 'component-sku-b',
        type: 'RELEASE',
        qty: 2,
        refType: 'ORDER',
        refId: 'bundle-order-1',
      },
    });
    expect(initialTx.productSKU.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bundle-selling-sku' },
    }));
  });

  it('PAID 未发货单微信退款 pending 时保持 REFUNDING 并不返还抵扣积分', async () => {
    const { service, prisma } = makeService();
    const order = {
      id: 'o-wechat-pending',
      userId: 'u1',
      status: 'PAID',
      checkoutSessionId: 'cs-pending',
      totalAmount: 65,
      goodsAmount: 60,
      discountAmount: 8,
      items: [{ skuId: 'sku1', quantity: 2, companyId: 'c1' }],
    };
    const refund = {
      id: 'r-wechat-pending',
      merchantRefundNo: 'AUTO-CANCEL-o-wechat-pending',
    };
    const initialTx = {
      $executeRaw: jest.fn(),
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue({
          deductionGroupId: 'DG-1',
          goodsAmount: 60,
          discountAmount: 8,
        }),
      },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: {
        create: jest.fn().mockResolvedValue(refund),
        update: jest.fn(),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    const pendingTx = {
      refund: { update: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.order.findUnique
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ ...order, createdAt: new Date(), afterSaleRequests: [], refunds: [], shipments: [] });
    prisma.order.findMany.mockResolvedValue([]);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(initialTx))
      .mockImplementationOnce(async (callback: any) => callback(pendingTx));
    const couponService = { restoreCouponsForOrder: jest.fn() };
    service.setCouponService(couponService as any);
    service.setPaymentService({
      initiateRefund: jest.fn().mockResolvedValue({
        success: true,
        pending: true,
        providerRefundId: 'wx-refund-1',
      }),
    } as any);
    const rewardDeductionService = {
      refundDeduction: jest.fn(),
    };
    service.setRewardDeductionService(rewardDeductionService as any);

    await service.cancelOrder('o-wechat-pending', 'u1');

    expect(pendingTx.refund.update).toHaveBeenCalledWith({
      where: { id: 'r-wechat-pending' },
      data: { status: 'REFUNDING', providerRefundId: 'wx-refund-1' },
    });
    expect(pendingTx.refund.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(pendingTx.refundStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        refundId: 'r-wechat-pending',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDING',
        remark: '渠道已受理，等待通知/查询确认',
      }),
    });
    expect(couponService.restoreCouponsForOrder).not.toHaveBeenCalled();
    expect(rewardDeductionService.refundDeduction).not.toHaveBeenCalled();
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

  it('GROUP_BUY 支付后不允许买家取消退款', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'gb-o1',
      userId: 'u1',
      status: 'PAID',
      bizType: 'GROUP_BUY',
      items: [],
    });

    await expect(service.cancelOrder('gb-o1', 'u1'))
      .rejects.toThrow('团购订单支付后不支持取消或退款');
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('GROUP_BUY 待支付状态也不允许走取消订单兼容路径', async () => {
    const { service, prisma } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'gb-pending-o1',
      userId: 'u1',
      status: 'PENDING_PAYMENT',
      bizType: 'GROUP_BUY',
      items: [],
    });

    await expect(service.cancelOrder('gb-pending-o1', 'u1'))
      .rejects.toThrow('团购订单支付后不支持取消或退款');
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
    const notificationService = injectNotificationService(service);
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
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    service.setPaymentService({
      initiateRefund: jest.fn().mockResolvedValue({
        success: true,
        providerRefundId: 'AUTO-CANCEL-o1',
      }),
    } as any);

    await service.cancelOrder('o1', 'u1');

    expect(notificationService.emit).toHaveBeenCalledWith({
      eventType: 'order.canceledByBuyerForSeller',
      aggregateType: 'order',
      aggregateId: 'o1',
      idempotencyKey: 'seller-order:c1:o1:buyer-canceled',
      actor: { kind: 'system' },
      payload: { companyId: 'c1', orderId: 'o1' },
    });
  });

  it('已生成面单导致取消失败时不发通知', async () => {
    const { service, prisma } = makeService();
    const notificationService = injectNotificationService(service);
    prisma.order.findUnique.mockResolvedValue({
      id: 'o2',
      userId: 'u1',
      status: 'PAID',
      bizType: 'NORMAL_GOODS',
      items: [{ skuId: 'sku1', quantity: 1, companyId: 'c1' }],
    });
    prisma.shipment.findMany.mockResolvedValue([{ id: 's1', status: 'INIT', waybillNo: 'SF1234567' }]);

    await expect(service.cancelOrder('o2', 'u1')).rejects.toThrow();
    expect(notificationService.emit).not.toHaveBeenCalled();
  });

  it('整 CheckoutSession 部分退款成功部分 pending 时不提前恢复平台红包', async () => {
    const { service, prisma, bonusAllocation } = makeService();
    const orders = [
      {
        id: 'o-session-1',
        userId: 'u1',
        status: 'PAID',
        checkoutSessionId: 'cs-pending',
        totalAmount: 30,
        goodsAmount: 30,
        discountAmount: 8,
        items: [{ skuId: 'sku1', quantity: 1, companyId: 'c1' }],
      },
      {
        id: 'o-session-2',
        userId: 'u1',
        status: 'PAID',
        checkoutSessionId: 'cs-pending',
        totalAmount: 40,
        goodsAmount: 40,
        discountAmount: 0,
        items: [{ skuId: 'sku2', quantity: 1, companyId: 'c2' }],
      },
    ];
    const refunds = [
      { id: 'r-session-1', merchantRefundNo: 'AUTO-CANCEL-o-session-1' },
      { id: 'r-session-2', merchantRefundNo: 'AUTO-CANCEL-o-session-2' },
    ];
    const initialTx = {
      $executeRaw: jest.fn(),
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue({
          deductionGroupId: 'DG-1',
          groupBuyRebateDeductionGroupId: 'GBD-1',
          groupBuyRebateDeductionAmount: 3,
          goodsAmount: 70,
          discountAmount: 8,
        }),
      },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: {
        create: jest.fn()
          .mockResolvedValueOnce(refunds[0])
          .mockResolvedValueOnce(refunds[1]),
        update: jest.fn(),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    const finalTx1 = {
      refund: { update: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
    };
    const pendingTx2 = {
      refund: { update: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
    };
    prisma.order.findMany.mockResolvedValue(orders);
    prisma.order.findUnique.mockResolvedValue({ ...orders[0], createdAt: new Date(), afterSaleRequests: [], refunds: [], shipments: [] });
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction
      .mockImplementationOnce(async (callback: any) => callback(initialTx))
      .mockImplementationOnce(async (callback: any) => callback(finalTx1))
      .mockImplementationOnce(async (callback: any) => callback(pendingTx2));
    const couponService = { restoreCouponsForOrder: jest.fn() };
    service.setCouponService(couponService as any);
    service.setPaymentService({
      initiateRefund: jest.fn()
        .mockResolvedValueOnce({
          success: true,
          providerRefundId: 'wx-session-refund-1',
        })
        .mockResolvedValueOnce({
          success: true,
          pending: true,
          providerRefundId: 'wx-session-refund-2',
        }),
    } as any);
    const rewardDeductionService = {
      refundDeduction: jest.fn(),
    };
    service.setRewardDeductionService(rewardDeductionService as any);
    const groupBuyRebateDeductionService = {
      refundDeduction: jest.fn(),
    };
    (service as any).setGroupBuyRebateDeductionService(groupBuyRebateDeductionService);
    const digitalAssetService = {
      reverseRefund: jest.fn().mockResolvedValue(undefined),
    };
    service.setDigitalAssetService(digitalAssetService as any);

    await (service as any).cancelEntireSessionUnshipped('cs-pending', 'u1');

    expect(bonusAllocation.rollbackForOrder).toHaveBeenCalledTimes(2);
    expect(bonusAllocation.rollbackForOrder).toHaveBeenNthCalledWith(1, 'o-session-1', initialTx);
    expect(bonusAllocation.rollbackForOrder).toHaveBeenNthCalledWith(2, 'o-session-2', initialTx);
    expect(finalTx1.refund.update).toHaveBeenCalledWith({
      where: { id: 'r-session-1' },
      data: { status: 'REFUNDED', providerRefundId: 'wx-session-refund-1' },
    });
    expect(pendingTx2.refund.update).toHaveBeenCalledWith({
      where: { id: 'r-session-2' },
      data: { status: 'REFUNDING', providerRefundId: 'wx-session-refund-2' },
    });
    expect(pendingTx2.refund.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REFUNDED' }),
    }));
    expect(finalTx1.refundStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        refundId: 'r-session-1',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDED',
        remark: '渠道退款成功',
      }),
    });
    expect(pendingTx2.refundStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        refundId: 'r-session-2',
        fromStatus: 'REFUNDING',
        toStatus: 'REFUNDING',
        remark: '渠道已受理，等待通知/查询确认',
      }),
    });
    expect(couponService.restoreCouponsForOrder).not.toHaveBeenCalled();
    expect(rewardDeductionService.refundDeduction).toHaveBeenCalledTimes(1);
    expect(rewardDeductionService.refundDeduction).toHaveBeenCalledWith(finalTx1, expect.objectContaining({
      refundId: 'r-session-1',
      orderId: 'o-session-1',
      isFinalRefund: false,
    }));
    expect(groupBuyRebateDeductionService.refundDeduction).toHaveBeenCalledTimes(1);
    expect(groupBuyRebateDeductionService.refundDeduction).toHaveBeenCalledWith(finalTx1, expect.objectContaining({
      refundId: 'r-session-1',
      orderId: 'o-session-1',
      originalDeductAmount: 3,
      deductionGroupId: 'GBD-1',
      isFinalRefund: false,
    }));
    expect(digitalAssetService.reverseRefund).toHaveBeenCalledTimes(1);
    expect(digitalAssetService.reverseRefund).toHaveBeenCalledWith('r-session-1');
  });

  it('整 session 未发货取消如果任一分润回滚失败则拒绝且不发起外部退款', async () => {
    const { service, prisma, bonusAllocation } = makeService();
    const orders = [
      {
        id: 'o-session-1',
        userId: 'u1',
        status: 'PAID',
        checkoutSessionId: 'cs-pending',
        totalAmount: 30,
        goodsAmount: 30,
        discountAmount: 0,
        items: [{ skuId: 'sku1', quantity: 1, companyId: 'company-1' }],
      },
      {
        id: 'o-session-2',
        userId: 'u1',
        status: 'PAID',
        checkoutSessionId: 'cs-pending',
        totalAmount: 40,
        goodsAmount: 40,
        discountAmount: 0,
        items: [{ skuId: 'sku2', quantity: 1, companyId: 'company-2' }],
      },
    ];
    const initialTx = {
      $executeRaw: jest.fn(),
      checkoutSession: { findUnique: jest.fn().mockResolvedValue(null) },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: {
        create: jest.fn()
          .mockResolvedValueOnce({
            id: 'r-session-1',
            merchantRefundNo: 'AUTO-CANCEL-o-session-1',
          })
          .mockResolvedValueOnce({
            id: 'r-session-2',
            merchantRefundNo: 'AUTO-CANCEL-o-session-2',
          }),
      },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    prisma.order.findMany.mockResolvedValue(orders);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementationOnce(async (callback: any) => callback(initialTx));
    bonusAllocation.rollbackForOrder
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('rollback failed'));
    const paymentService = {
      initiateRefund: jest.fn().mockResolvedValue({ success: true }),
    };
    service.setPaymentService(paymentService as any);

    await expect((service as any).cancelEntireSessionUnshipped('cs-pending', 'u1'))
      .rejects.toThrow('rollback failed');

    expect(bonusAllocation.rollbackForOrder).toHaveBeenNthCalledWith(1, 'o-session-1', initialTx);
    expect(bonusAllocation.rollbackForOrder).toHaveBeenNthCalledWith(2, 'o-session-2', initialTx);
    expect(paymentService.initiateRefund).not.toHaveBeenCalled();
  });

  it('PAID bundle 整 session 取消会回填组件库存而不是 bundle 售卖 SKU', async () => {
    const { service, prisma, productBundleService } = makeService();
    const orders = [
      {
        id: 'bundle-session-order-1',
        userId: 'u1',
        status: 'PAID',
        checkoutSessionId: 'cs-bundle-session',
        totalAmount: 30,
        goodsAmount: 30,
        discountAmount: 0,
        items: [{
          skuId: 'bundle-selling-sku-1',
          quantity: 1,
          companyId: 'company-1',
          productSnapshot: {
            productType: 'BUNDLE',
            bundleItems: [{ skuId: 'component-sku-a', quantityPerBundle: 2 }],
          },
        }],
      },
      {
        id: 'bundle-session-order-2',
        userId: 'u1',
        status: 'PAID',
        checkoutSessionId: 'cs-bundle-session',
        totalAmount: 40,
        goodsAmount: 40,
        discountAmount: 0,
        items: [{
          skuId: 'bundle-selling-sku-2',
          quantity: 3,
          companyId: 'company-2',
          productSnapshot: {
            productType: 'BUNDLE',
            bundleItems: [{ skuId: 'component-sku-b', quantityPerBundle: 1 }],
          },
        }],
      },
    ];
    const tx = {
      $executeRaw: jest.fn(),
      checkoutSession: { findUnique: jest.fn().mockResolvedValue(null) },
      shipment: { count: jest.fn().mockResolvedValue(0) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      productSKU: { update: jest.fn() },
      inventoryLedger: { create: jest.fn() },
      refund: { create: jest.fn() },
      refundStatusHistory: { create: jest.fn() },
      orderStatusHistory: { create: jest.fn() },
    };
    tx.refund.create
      .mockResolvedValueOnce({
        id: 'refund-session-1',
        merchantRefundNo: 'AUTO-CANCEL-bundle-session-order-1',
      })
      .mockResolvedValueOnce({
        id: 'refund-session-2',
        merchantRefundNo: 'AUTO-CANCEL-bundle-session-order-2',
      });
    prisma.order.findMany
      .mockResolvedValueOnce(orders)
      .mockResolvedValueOnce([]);
    prisma.order.findUnique.mockResolvedValue({
      ...orders[0],
      createdAt: new Date(),
      afterSaleRequests: [],
      refunds: [],
      shipments: [],
      statusHistory: [],
      payments: [],
    });
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.refund.findFirst.mockResolvedValue(null);
    prisma.companyStaff.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    productBundleService.buildInventoryMovements
      .mockReturnValueOnce([
        { skuId: 'component-sku-a', quantity: 2, companyId: 'company-1', label: 'A' },
      ])
      .mockReturnValueOnce([
        { skuId: 'component-sku-b', quantity: 3, companyId: 'company-2', label: 'B' },
      ]);
    service.setPaymentService({
      initiateRefund: jest.fn().mockResolvedValue({ success: false, message: 'later' }),
    } as any);

    await (service as any).cancelEntireSessionUnshipped('cs-bundle-session', 'u1');

    expect(productBundleService.buildInventoryMovements).toHaveBeenNthCalledWith(1, orders[0].items[0]);
    expect(productBundleService.buildInventoryMovements).toHaveBeenNthCalledWith(2, orders[1].items[0]);
    expect(tx.productSKU.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'component-sku-a' },
      data: { stock: { increment: 2 } },
    });
    expect(tx.productSKU.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'component-sku-b' },
      data: { stock: { increment: 3 } },
    });
    expect(tx.inventoryLedger.create).toHaveBeenNthCalledWith(1, {
      data: {
        skuId: 'component-sku-a',
        type: 'RELEASE',
        qty: 2,
        refType: 'ORDER',
        refId: 'bundle-session-order-1',
      },
    });
    expect(tx.inventoryLedger.create).toHaveBeenNthCalledWith(2, {
      data: {
        skuId: 'component-sku-b',
        type: 'RELEASE',
        qty: 3,
        refType: 'ORDER',
        refId: 'bundle-session-order-2',
      },
    });
    expect(tx.productSKU.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bundle-selling-sku-1' },
    }));
    expect(tx.productSKU.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'bundle-selling-sku-2' },
    }));
  });
});
