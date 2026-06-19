import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { SfExpressService } from '../../shipment/sf-express.service';
import { UploadService } from '../../upload/upload.service';
import { DeliveryShippingService } from './delivery-shipping.service';

jest.mock('../../../common/utils/remote-binary-fetch.util', () => ({
  fetchBinaryWithLimit: jest.fn().mockResolvedValue({
    buffer: Buffer.from('pdf-binary'),
    contentType: 'application/pdf',
    size: 10,
    finalUrl: 'https://sf.example.com/waybill.pdf',
  }),
}));

describe('DeliveryShippingService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let sfExpress: { createOrder: jest.Mock; printWaybill: jest.Mock; cancelOrder: jest.Mock };
  let uploadService: { uploadBuffer: jest.Mock };
  let service: DeliveryShippingService;

  const pendingSubOrder = {
    id: 'sub_1',
    orderId: 'order_1',
    merchantId: 'merchant_1',
    status: 'PENDING_SHIPMENT',
    shippingFeeShareCents: 500,
    order: {
      id: 'order_1',
      userId: 'delivery_user_1',
      status: 'PENDING_SHIPMENT',
      checkoutSessionId: 'checkout_1',
      addressSnapshot: {
        source: 'ADDRESS',
        recipientName: '张三',
        phone: '13800000000',
        provinceCode: '440000',
        provinceName: '广东省',
        cityCode: '440100',
        cityName: '广州市',
        districtCode: '440106',
        districtName: '天河区',
        detailAddress: '体育东路 1 号',
        regionText: '广东省广州市天河区',
      },
    },
    merchant: {
      id: 'merchant_1',
      name: '华南仓',
      contactName: '李四',
      contactPhone: '13900000000',
      servicePhone: '4008009000',
      addressJson: {
        provinceCode: '440000',
        provinceName: '广东省',
        cityCode: '440100',
        cityName: '广州市',
        districtCode: '440106',
        districtName: '天河区',
        detailAddress: '科韵路 8 号',
      },
    },
    items: [
      {
        id: 'item_1',
        skuId: 'sku_1',
        quantity: 2,
        productSnapshot: {
          productTitle: '冷鲜牛腩',
          skuTitle: '5kg/箱',
          weightGram: 600,
        },
        sku: {
          id: 'sku_1',
          weightGram: 999,
        },
      },
      {
        id: 'item_2',
        skuId: 'sku_2',
        quantity: 1,
        productSnapshot: {
          productTitle: '牛霖',
          skuTitle: '10kg/箱',
        },
        sku: {
          id: 'sku_2',
          weightGram: 200,
        },
      },
    ],
  };

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn(),
      deliverySubOrder: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
      deliveryOrder: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      deliveryShipment: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      deliveryShippingCost: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    deliveryPrisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      deliveryOrder: {
        findFirst: jest.fn(),
      },
      deliverySubOrder: {
        findFirst: jest.fn(),
      },
      deliveryShipment: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      deliveryShippingCost: {
        findMany: jest.fn(),
      },
    };

    sfExpress = {
      createOrder: jest.fn(),
      printWaybill: jest.fn(),
      cancelOrder: jest.fn(),
    };

    uploadService = {
      uploadBuffer: jest.fn(),
    };

    service = new DeliveryShippingService(
      deliveryPrisma as DeliveryPrismaService,
      sfExpress as unknown as SfExpressService,
      uploadService as unknown as UploadService,
    );
  });

  it('ships a delivery suborder with SF using only weightGram, delivery tables, and a Serializable transaction', async () => {
    tx.deliverySubOrder.findUnique.mockResolvedValue({ ...pendingSubOrder, shipments: [] });
    tx.deliveryShipment.create.mockResolvedValue({
      id: 'shipment_1',
      rawCarrierPayload: {
        waybillGeneration: {
          status: 'IN_PROGRESS',
          token: 'token-1',
          startedAt: '2026-06-19T16:00:00.000Z',
          attempt: 1,
          sfCustomerOrderId: 'AIMM-DELIVERY-WB-1',
        },
      },
    });
    sfExpress.createOrder.mockResolvedValue({
      waybillNo: 'SF1234567890',
      sfOrderId: 'sf_order_1',
    });
    sfExpress.printWaybill.mockResolvedValue({
      pdfUrl: 'https://sf.example.com/waybill.pdf',
    });
    uploadService.uploadBuffer.mockResolvedValue({
      url: 'https://oss.example.com/waybill.pdf',
    });
    tx.deliveryShipment.updateMany.mockResolvedValue({ count: 1 });
    tx.deliverySubOrder.updateMany.mockResolvedValue({ count: 1 });
    tx.deliverySubOrder.count.mockResolvedValue(0);
    tx.deliveryOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    tx.deliveryShippingCost.create.mockResolvedValue({ id: 'ship_cost_1' });

    const result = await service.shipSubOrder('merchant_1', 'staff_1', 'sub_1');

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.$executeRaw).toHaveBeenCalled();
    const sfInput = sfExpress.createOrder.mock.calls[0][0];
    expect(sfInput).toMatchObject({
      sender: {
        name: '李四',
        tel: '13900000000',
        province: '广东省',
        city: '广州市',
        district: '天河区',
        detail: '科韵路 8 号',
      },
      receiver: {
        name: '张三',
        tel: '13800000000',
        province: '广东省',
        city: '广州市',
        district: '天河区',
        detail: '体育东路 1 号',
      },
      cargo: '冷鲜牛腩 等2件',
      totalWeight: 1.4,
      packageCount: 1,
    });
    expect(sfInput).not.toHaveProperty('monthlyCard');
    expect(sfInput).not.toHaveProperty('length');
    expect(sfInput).not.toHaveProperty('width');
    expect(sfInput).not.toHaveProperty('height');
    expect(tx.deliveryShipment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order_1',
          subOrderId: 'sub_1',
          merchantId: 'merchant_1',
          carrierCode: 'SF',
          carrierName: '顺丰速运',
          status: 'INIT',
          waybillNo: null,
        }),
      }),
    );
    expect(tx.deliveryShipment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'shipment_1',
          waybillNo: null,
        }),
        data: expect.objectContaining({
          waybillNo: 'SF1234567890',
          sfOrderId: 'sf_order_1',
          waybillUrl: 'https://oss.example.com/waybill.pdf',
          status: 'SHIPPED',
        }),
      }),
    );
    expect(tx.deliveryShippingCost.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        checkoutSessionId: 'checkout_1',
        orderId: 'order_1',
        subOrderId: 'sub_1',
        merchantId: 'merchant_1',
        estimatedUserShippingFeeCents: 500,
        actualCarrierCostCents: null,
        carrierCode: 'SF',
        carrierRecordNo: 'sf_order_1',
        skuId: null,
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      idempotent: false,
      subOrderId: 'sub_1',
      orderId: 'order_1',
      shipmentId: 'shipment_1',
      waybillNo: 'SF1234567890',
      carrierCode: 'SF',
      status: 'SHIPPED',
    });
  });

  it('returns the existing shipment idempotently when the suborder is already shipped', async () => {
    tx.deliverySubOrder.findUnique.mockResolvedValue({
      ...pendingSubOrder,
      status: 'SHIPPED',
      shipments: [
        {
          id: 'shipment_1',
          subOrderId: 'sub_1',
          orderId: 'order_1',
          merchantId: 'merchant_1',
          carrierCode: 'SF',
          carrierName: '顺丰速运',
          status: 'SHIPPED',
          waybillNo: 'SF1234567890',
          waybillUrl: 'https://oss.example.com/waybill.pdf',
          sfOrderId: 'sf_order_1',
        },
      ],
    });

    const result = await service.shipSubOrder('merchant_1', 'staff_1', 'sub_1');

    expect(sfExpress.createOrder).not.toHaveBeenCalled();
    expect(tx.deliveryShipment.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      idempotent: true,
      shipmentId: 'shipment_1',
      waybillNo: 'SF1234567890',
      status: 'SHIPPED',
    });
  });

  it('rejects shipping when the delivery merchant does not own the suborder', async () => {
    tx.deliverySubOrder.findUnique.mockResolvedValue({
      ...pendingSubOrder,
      merchantId: 'merchant_other',
      shipments: [],
    });

    await expect(
      service.shipSubOrder('merchant_1', 'staff_1', 'sub_1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(sfExpress.createOrder).not.toHaveBeenCalled();
    expect(tx.deliveryShipment.create).not.toHaveBeenCalled();
  });

  it('rejects shipping when the merchant sender address lacks structured province/city/detail', async () => {
    tx.deliverySubOrder.findUnique.mockResolvedValue({
      ...pendingSubOrder,
      merchant: {
        ...pendingSubOrder.merchant,
        addressJson: {
          regionText: '广东省广州市',
        },
      },
      shipments: [],
    });

    await expect(
      service.shipSubOrder('merchant_1', 'staff_1', 'sub_1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(sfExpress.createOrder).not.toHaveBeenCalled();
  });

  it('lists seller shipments only for the seller-owned delivery suborder', async () => {
    deliveryPrisma.deliverySubOrder.findFirst.mockResolvedValue({
      id: 'sub_1',
      merchantId: 'merchant_1',
    });
    deliveryPrisma.deliveryShipment.findMany.mockResolvedValue([
      {
        id: 'shipment_1',
        subOrderId: 'sub_1',
        orderId: 'order_1',
        carrierCode: 'SF',
        status: 'SHIPPED',
      },
    ]);

    const result = await service.listSellerShipments('merchant_1', 'sub_1');

    expect(deliveryPrisma.deliverySubOrder.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'sub_1',
        merchantId: 'merchant_1',
      },
      select: {
        id: true,
        merchantId: true,
      },
    });
    expect(deliveryPrisma.deliveryShipment.findMany).toHaveBeenCalledWith({
      where: { subOrderId: 'sub_1' },
      orderBy: [{ shippedAt: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result).toHaveLength(1);
  });

  it('lists buyer shipments only for the buyer-owned delivery order', async () => {
    deliveryPrisma.deliveryOrder.findFirst.mockResolvedValue({
      id: 'order_1',
      userId: 'delivery_user_1',
    });
    deliveryPrisma.deliveryShipment.findMany.mockResolvedValue([
      {
        id: 'shipment_1',
        orderId: 'order_1',
        subOrderId: 'sub_1',
        carrierCode: 'SF',
        status: 'SHIPPED',
      },
    ]);

    const result = await service.listBuyerShipments('delivery_user_1', 'order_1');

    expect(deliveryPrisma.deliveryOrder.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'order_1',
        userId: 'delivery_user_1',
      },
      select: {
        id: true,
        userId: true,
      },
    });
    expect(deliveryPrisma.deliveryShipment.findMany).toHaveBeenCalledWith({
      where: { orderId: 'order_1' },
      orderBy: [{ shippedAt: 'desc' }, { createdAt: 'desc' }],
    });
    expect(result).toHaveLength(1);
  });

  it('lists admin shipping records from delivery shipment records only', async () => {
    deliveryPrisma.deliveryShipment.count.mockResolvedValue(1);
    deliveryPrisma.deliveryShipment.findMany.mockResolvedValue([
      {
        id: 'shipment_1',
        orderId: 'order_1',
        subOrderId: 'sub_1',
        merchantId: 'merchant_1',
        carrierCode: 'SF',
        carrierName: '顺丰速运',
        sfOrderId: 'sf_order_1',
        waybillNo: 'SF1234567890',
        status: 'SHIPPED',
      },
    ]);
    deliveryPrisma.deliveryShippingCost.findMany.mockResolvedValue([
      {
        orderId: 'order_1',
        subOrderId: 'sub_1',
        merchantId: 'merchant_1',
        estimatedUserShippingFeeCents: 500,
        actualCarrierCostCents: null,
        carrierCode: 'SF',
        carrierRecordNo: 'sf_order_1',
      },
    ]);

    const result = await service.listAdminShippingRecords({ page: 2, pageSize: 5 });

    expect(deliveryPrisma.deliveryShipment.count).toHaveBeenCalledWith({
      where: {},
    });
    expect(deliveryPrisma.deliveryShipment.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 5,
      take: 5,
    });
    expect(deliveryPrisma.deliveryShippingCost.findMany).toHaveBeenCalledWith({
      where: {
        subOrderId: {
          in: ['sub_1'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 5,
    });
    expect(result.items).toHaveLength(1);
  });
});
