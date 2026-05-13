import { BadRequestException } from '@nestjs/common';
import { AdminOrdersService } from './admin-orders.service';

describe('AdminOrdersService.ship', () => {
  const makeService = () => {
    const prisma = {
      order: {
        findUnique: jest.fn(),
      },
      shipment: {
        findUnique: jest.fn(),
      },
      company: {
        findUnique: jest.fn(),
      },
      orderItem: {
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const bonusConfig = {
      getSystemConfig: jest.fn().mockResolvedValue({ autoConfirmDays: 7 }),
    };
    const sfExpress = {
      createOrder: jest.fn(),
      cancelOrder: jest.fn(),
      printWaybill: jest.fn().mockRejectedValue(new Error('print unavailable')),
    };
    const shippingCost = {
      recordPackage: jest.fn().mockResolvedValue({ id: 'cost-001' }),
    };
    const service = new (AdminOrdersService as any)(
      prisma,
      bonusConfig,
      sfExpress,
      {},
      {},
      shippingCost,
    );
    return { service, prisma, sfExpress, shippingCost };
  };

  const mockSuccessfulTransaction = (prisma: any) => {
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        order: {
          findUnique: jest.fn().mockResolvedValue({ id: 'order-001', status: 'PAID' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        shipment: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({ id: 'shipment-001' }),
        },
        shipmentTrackingEvent: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'event-001' }),
        },
        orderStatusHistory: {
          create: jest.fn().mockResolvedValue({ id: 'history-001' }),
        },
      };
      return callback(tx);
    });
  };

  const mockAutoShipOrder = (prisma: any) => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-001',
      status: 'PAID',
      addressSnapshot: {
        recipientName: '张三',
        phone: '13800138000',
        province: '浙江省',
        city: '杭州市',
        district: '西湖区',
        detail: '文一路 1 号',
      },
      items: [{ companyId: 'company-001' }],
    });
    prisma.shipment.findUnique.mockResolvedValue(null);
    prisma.company.findUnique.mockResolvedValue({
      name: '测试商家',
      servicePhone: '057100000000',
      address: {
        province: '浙江省',
        city: '杭州市',
        district: '余杭区',
        detail: '仓库路 1 号',
      },
      contact: { name: '李四', phone: '13900139000' },
    });
    mockSuccessfulTransaction(prisma);
  };

  it('手填发货拒绝 4 位短单号，避免误以为已在顺丰沙箱下单', async () => {
    const { service, prisma, sfExpress } = makeService();
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-001',
      status: 'PAID',
      items: [{ companyId: 'company-001' }],
    });

    await expect(
      service.ship('order-001', {
        useCarrierAuto: false,
        carrierCode: 'SF',
        carrierName: '顺丰速运',
        trackingNo: '1234',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(sfExpress.createOrder).not.toHaveBeenCalled();
  });

  it('自动顺丰取号按 SKU 重量汇总 totalWeight，并在事务提交后记录平台承运成本', async () => {
    const { service, prisma, sfExpress, shippingCost } = makeService();
    mockAutoShipOrder(prisma);
    prisma.orderItem.findMany.mockResolvedValue([
      { quantity: 2, sku: { weightGram: 750, product: { title: '苹果' } } },
      { quantity: 1, sku: { weightGram: 1250, product: { title: '梨' } } },
    ]);
    sfExpress.createOrder.mockResolvedValue({
      waybillNo: 'SF123456789',
      sfOrderId: 'sf-order-001',
    });

    await expect(
      service.ship('order-001', {
        useCarrierAuto: true,
        carrierCode: 'SF',
      }),
    ).resolves.toEqual({ ok: true, waybillNo: 'SF123456789', waybillUrl: null });

    expect(sfExpress.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        totalWeight: 2.75,
      }),
    );
    expect(shippingCost.recordPackage).toHaveBeenCalledWith({
      orderId: 'order-001',
      packageIndex: 0,
      companyId: 'company-001',
      sfOrderId: 'sf-order-001',
      weightGramSent: 2750,
    });
  });

  it('自动顺丰取号对缺失或无效 SKU 重量按每件 1000g 兜底', async () => {
    const { service, prisma, sfExpress, shippingCost } = makeService();
    mockAutoShipOrder(prisma);
    prisma.orderItem.findMany.mockResolvedValue([
      { quantity: 2, sku: { weightGram: null, product: { title: '苹果' } } },
      { quantity: 3, sku: { weightGram: 0, product: { title: '梨' } } },
      { quantity: 1, sku: { weightGram: Number.NaN, product: { title: '桃' } } },
    ]);
    sfExpress.createOrder.mockResolvedValue({
      waybillNo: 'SF123456789',
      sfOrderId: 'sf-order-001',
    });

    await service.ship('order-001', {
      useCarrierAuto: true,
      carrierCode: 'SF',
    });

    expect(sfExpress.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        totalWeight: 6,
      }),
    );
    expect(shippingCost.recordPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        weightGramSent: 6000,
      }),
    );
  });
});
