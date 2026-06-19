import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliverySettlementService } from '../settlement/delivery-settlement.service';
import { DeliverySellerOpsService } from './delivery-seller-ops.service';

describe('DeliverySellerOpsService', () => {
  let deliveryPrisma: any;
  let deliverySettlementService: any;
  let service: DeliverySellerOpsService;

  beforeEach(() => {
    deliveryPrisma = {
      deliveryMerchant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      deliverySubOrder: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      deliverySettlement: {
        count: jest.fn(),
      },
      deliveryCustomerServiceConversation: {
        count: jest.fn(),
      },
    };
    deliverySettlementService = {
      materializeEligibleSettlements: jest.fn(),
    };

    service = new DeliverySellerOpsService(
      deliveryPrisma as DeliveryPrismaService,
      deliverySettlementService as DeliverySettlementService,
    );
  });

  it('materializes eligible settlements before computing dashboard counts', async () => {
    let settlementsMaterialized = false;
    deliverySettlementService.materializeEligibleSettlements.mockImplementation(async () => {
      settlementsMaterialized = true;
    });
    deliveryPrisma.deliverySubOrder.count.mockResolvedValue(5);
    deliveryPrisma.deliverySettlement.count.mockImplementation(async () => {
      expect(settlementsMaterialized).toBe(true);
      return 2;
    });
    deliveryPrisma.deliveryCustomerServiceConversation.count.mockResolvedValue(4);

    await expect(service.getDashboard('merchant_1')).resolves.toEqual({
      pendingShipmentCount: 5,
      deliveredPendingSettlementCount: 2,
      openConversationCount: 4,
    });

    expect(deliverySettlementService.materializeEligibleSettlements).toHaveBeenCalledWith({
      merchantId: 'merchant_1',
    });
  });

  it('sanitizes seller company responses so default markup is never exposed', async () => {
    deliveryPrisma.deliveryMerchant.findUnique.mockResolvedValue({
      id: 'merchant_1',
      name: '配送中心A',
      contactName: '张三',
      defaultMarkupBps: 1800,
    });

    await expect(service.getCompany('merchant_1')).resolves.toEqual({
      id: 'merchant_1',
      name: '配送中心A',
      contactName: '张三',
    });
  });

  it('ignores default markup changes from seller company updates and strips it from the response', async () => {
    deliveryPrisma.deliveryMerchant.update.mockResolvedValue({
      id: 'merchant_1',
      name: '配送中心A',
      contactName: '张三',
      contactPhone: '13800000000',
      servicePhone: '400-800-9000',
      defaultMarkupBps: 2600,
    });

    await expect(
      service.updateCompany('merchant_1', {
        name: ' 配送中心A ',
        defaultMarkupBps: 9900,
      } as any),
    ).resolves.toEqual({
      id: 'merchant_1',
      name: '配送中心A',
      contactName: '张三',
      contactPhone: '13800000000',
      servicePhone: '400-800-9000',
    });

    expect(deliveryPrisma.deliveryMerchant.update).toHaveBeenCalledWith({
      where: { id: 'merchant_1' },
      data: {
        name: '配送中心A',
        contactName: undefined,
        contactPhone: undefined,
        servicePhone: undefined,
      },
    });
  });

  it('sanitizes seller order list payloads so buyer totals and settlements never leak', async () => {
    deliveryPrisma.deliverySubOrder.count.mockResolvedValue(1);
    deliveryPrisma.deliverySubOrder.findMany.mockResolvedValue([
      {
        id: 'sub_1',
        orderId: 'order_1',
        merchantId: 'merchant_1',
        status: 'PENDING_SHIPMENT',
        createdAt: new Date('2026-06-19T10:00:00Z'),
        updatedAt: new Date('2026-06-19T11:00:00Z'),
        order: {
          id: 'order_1',
          paidAt: new Date('2026-06-19T09:00:00Z'),
          totalAmountCents: 99999,
          addressSnapshot: {
            recipientName: '张三',
            phone: '13800000000',
            regionText: '广东省广州市天河区',
            detailAddress: '体育西路 1 号',
          },
        },
        items: [
          {
            id: 'item_1',
            quantity: 2,
            lineAmountCents: 5200,
            productSnapshot: {
              productTitle: '冷鲜牛腩',
              skuTitle: '5kg/箱',
              imageUrl: 'https://img.example.com/1.png',
              unitName: '箱',
            },
          },
        ],
        settlements: [{ id: 'settlement_1', status: 'PENDING', settledAmountCents: 8888 }],
        shipments: [
          {
            id: 'shipment_1',
            status: 'INIT',
            trackingNo: null,
            waybillNo: 'SF123',
            waybillUrl: '/waybills/SF123.pdf',
            carrierCode: 'SF',
            carrierName: '顺丰速运',
            shippedAt: null,
            createdAt: new Date('2026-06-19T10:10:00Z'),
            updatedAt: new Date('2026-06-19T10:10:00Z'),
          },
        ],
      },
    ]);

    const result = await service.listOrders('merchant_1', {});

    expect(result).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [
        {
          id: 'sub_1',
          orderId: 'order_1',
          status: 'PENDING_SHIPMENT',
          buyerAlias: '收货人 张三',
          regionText: '广东省广州市天河区',
          items: [
            {
              id: 'item_1',
              title: '冷鲜牛腩',
              skuTitle: '5kg/箱',
              quantity: 2,
            },
          ],
          shipment: {
            id: 'shipment_1',
            waybillNo: 'SF123',
            waybillPrintUrl: '/waybills/SF123.pdf',
          },
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty('totalAmountCents');
    expect(result.items[0].items[0]).not.toHaveProperty('lineAmountCents');
    expect(result.items[0]).not.toHaveProperty('settlements');
  });

  it('loads a seller order detail with only fulfillment-safe fields', async () => {
    deliveryPrisma.deliverySubOrder.findFirst.mockResolvedValue({
      id: 'sub_1',
      orderId: 'order_1',
      merchantId: 'merchant_1',
      status: 'SHIPPED',
      createdAt: new Date('2026-06-19T10:00:00Z'),
      updatedAt: new Date('2026-06-19T11:00:00Z'),
      shippedAt: null,
      deliveredAt: null,
      order: {
        id: 'order_1',
        paidAt: new Date('2026-06-19T09:00:00Z'),
        totalAmountCents: 99999,
        addressSnapshot: {
          recipientName: '李四',
          phone: '13900000000',
          regionText: '北京市朝阳区',
          detailAddress: '建国路 88 号',
        },
      },
      items: [
        {
          id: 'item_1',
          quantity: 1,
          lineAmountCents: 6600,
          productSnapshot: {
            productTitle: '阳光玫瑰',
            skuTitle: '2kg/箱',
            imageUrl: 'https://img.example.com/2.png',
            unitName: '箱',
          },
        },
      ],
      settlements: [{ id: 'settlement_1', status: 'PENDING', settledAmountCents: 7777 }],
      shipments: [
        {
          id: 'shipment_1',
          status: 'SHIPPED',
          trackingNo: 'SF123',
          waybillNo: 'SF123',
          waybillUrl: '/waybills/SF123.pdf',
          carrierCode: 'SF',
          carrierName: '顺丰速运',
          shippedAt: new Date('2026-06-19T10:30:00Z'),
          createdAt: new Date('2026-06-19T10:10:00Z'),
          updatedAt: new Date('2026-06-19T10:10:00Z'),
        },
      ],
    });

    const result = await service.getOrder('merchant_1', 'sub_1');

    expect(result).toMatchObject({
      id: 'sub_1',
      orderId: 'order_1',
      status: 'SHIPPED',
      paidAt: new Date('2026-06-19T09:00:00Z').toISOString(),
      shippingAddress: {
        recipientName: '李四',
        phone: '13900000000',
        regionText: '北京市朝阳区',
        detailAddress: '建国路 88 号',
      },
      items: [
        {
          id: 'item_1',
          title: '阳光玫瑰',
          skuTitle: '2kg/箱',
          quantity: 1,
        },
      ],
      shipment: {
        id: 'shipment_1',
        status: 'SHIPPED',
        trackingNo: 'SF123',
        waybillNo: 'SF123',
        waybillPrintUrl: '/waybills/SF123.pdf',
      },
    });
    expect(result).not.toHaveProperty('totalAmountCents');
    expect(result.items[0]).not.toHaveProperty('lineAmountCents');
    expect(result).not.toHaveProperty('settlements');
  });
});
