import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '../../../generated/delivery-client';
import { DeliveryPrismaService } from '../../../delivery-prisma/delivery-prisma.service';
import { DeliveryIdService } from '../common/delivery-id.service';
import { DeliveryOrdersService } from './delivery-orders.service';

describe('DeliveryOrdersService', () => {
  let tx: any;
  let deliveryPrisma: any;
  let deliveryIdService: { nextInTransaction: jest.Mock };
  let service: DeliveryOrdersService;

  const activeCheckout = {
    id: 'checkout_1',
    userId: 'delivery_user_1',
    unitId: 'unit_1',
    status: 'ACTIVE',
    paymentChannel: 'ALIPAY',
    providerTxnId: null,
    merchantOrderNo: 'PSZF0000000000001',
    goodsAmountCents: 4400,
    shippingFeeCents: 500,
    totalAmountCents: 4900,
    note: '送货前联系',
    paidAt: null,
    unitSnapshot: { id: 'unit_1', name: '青禾食堂' },
    addressSnapshot: { recipientName: '张三', detailAddress: '体育西路 1 号' },
    itemsSnapshot: [
      {
        cartItemId: 'cart_1',
        skuId: 'sku_1',
        productId: 'product_1',
        merchantId: 'merchant_1',
        merchantName: '华南仓',
        productTitle: '冷鲜牛腩',
        skuTitle: '5kg/箱',
        quantity: 2,
        basePriceCents: 1000,
        finalPriceCents: 1100,
        lineAmountCents: 2200,
      },
      {
        cartItemId: 'cart_2',
        skuId: 'sku_2',
        productId: 'product_2',
        merchantId: 'merchant_2',
        merchantName: '华东仓',
        productTitle: '牛霖',
        skuTitle: '10kg/箱',
        quantity: 1,
        basePriceCents: 2000,
        finalPriceCents: 2200,
        lineAmountCents: 2200,
      },
    ],
    pricingSnapshot: {
      merchantGroups: [
        {
          merchantId: 'merchant_1',
          goodsAmountCents: 2200,
          shippingFeeCents: 500,
          totalAmountCents: 2700,
        },
        {
          merchantId: 'merchant_2',
          goodsAmountCents: 2200,
          shippingFeeCents: 0,
          totalAmountCents: 2200,
        },
      ],
    },
    orders: [],
  };

  beforeEach(() => {
    tx = {
      deliveryCheckoutSession: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      deliveryCartItem: {
        deleteMany: jest.fn(),
      },
      deliveryProductSku: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      deliveryInventoryLedger: {
        create: jest.fn(),
      },
      deliveryOrder: {
        create: jest.fn(),
      },
      deliverySubOrder: {
        create: jest.fn(),
      },
      deliveryOrderItem: {
        create: jest.fn(),
      },
      deliveryPayment: {
        upsert: jest.fn(),
      },
    };

    deliveryPrisma = {
      deliveryOrder: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      deliveryCheckoutSession: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    deliveryIdService = {
      nextInTransaction: jest
        .fn()
        .mockResolvedValueOnce('PSDD0000000000001')
        .mockResolvedValueOnce('PSZDD000000000001')
        .mockResolvedValueOnce('PSZDD000000000002'),
    };

    service = new DeliveryOrdersService(
      deliveryPrisma as DeliveryPrismaService,
      deliveryIdService as unknown as DeliveryIdService,
    );
  });

  it('enforces one delivery order per paid checkout session at the database boundary', () => {
    const schema = readFileSync(
      join(__dirname, '../../../../prisma-delivery/schema.prisma'),
      'utf8',
    );
    const deliveryOrderModel = schema.match(/model DeliveryOrder \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(deliveryOrderModel).toContain('@@unique([checkoutSessionId])');
  });

  it('creates exactly one delivery order, merchant suborders, order items, payment, and stock deductions in a Serializable transaction', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue(activeCheckout);
    tx.deliveryProductSku.findMany.mockResolvedValue([
      {
        id: 'sku_1',
        stock: 20,
        isActive: true,
        product: {
          id: 'product_1',
          merchantId: 'merchant_1',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
      {
        id: 'sku_2',
        stock: 10,
        isActive: true,
        product: {
          id: 'product_2',
          merchantId: 'merchant_2',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
    ]);
    tx.deliveryProductSku.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryOrder.create.mockResolvedValue({ id: 'PSDD0000000000001' });
    tx.deliverySubOrder.create
      .mockResolvedValueOnce({ id: 'PSZDD000000000001' })
      .mockResolvedValueOnce({ id: 'PSZDD000000000002' });
    tx.deliveryOrderItem.create.mockResolvedValue({});
    tx.deliveryPayment.upsert.mockResolvedValue({ id: 'PSZF0000000000001', status: 'PAID' });
    tx.deliveryCheckoutSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.createOrderFromPaidCheckout({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      rawPayload: { total_amount: '49.00' },
    });

    expect(deliveryPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.deliveryProductSku.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'sku_1' },
      data: { stock: { decrement: 2 } },
    });
    expect(tx.deliveryProductSku.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'sku_2' },
      data: { stock: { decrement: 1 } },
    });
    expect(tx.deliveryOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'PSDD0000000000001',
          checkoutSessionId: 'checkout_1',
          totalAmountCents: 4900,
        }),
      }),
    );
    expect(tx.deliveryPayment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchantOrderNo: 'PSZF0000000000001' },
        create: expect.objectContaining({
          id: 'PSZF0000000000001',
          checkoutSessionId: 'checkout_1',
          orderId: 'PSDD0000000000001',
          status: 'PAID',
        }),
      }),
    );
    expect(result).toMatchObject({
      orderId: 'PSDD0000000000001',
      subOrderIds: ['PSZDD000000000001', 'PSZDD000000000002'],
      idempotent: false,
    });
  });

  it('clears purchased delivery cart rows inside the paid-order transaction without touching normal cart', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue(activeCheckout);
    tx.deliveryProductSku.findMany.mockResolvedValue([
      {
        id: 'sku_1',
        stock: 20,
        supplyPriceCents: 800,
        basePriceCents: 1000,
        isActive: true,
        product: {
          id: 'product_1',
          merchantId: 'merchant_1',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
      {
        id: 'sku_2',
        stock: 10,
        supplyPriceCents: 1600,
        basePriceCents: 2000,
        isActive: true,
        product: {
          id: 'product_2',
          merchantId: 'merchant_2',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
    ]);
    tx.deliveryProductSku.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryOrder.create.mockResolvedValue({ id: 'PSDD0000000000001' });
    tx.deliverySubOrder.create
      .mockResolvedValueOnce({ id: 'PSZDD000000000001' })
      .mockResolvedValueOnce({ id: 'PSZDD000000000002' });
    tx.deliveryOrderItem.create.mockResolvedValue({});
    tx.deliveryPayment.upsert.mockResolvedValue({ id: 'PSZF0000000000001', status: 'PAID' });
    tx.deliveryCheckoutSession.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryCartItem.deleteMany.mockResolvedValue({ count: 2 });

    await service.createOrderFromPaidCheckout({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      rawPayload: { total_amount: '49.00' },
    });

    expect(tx.deliveryCartItem.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['cart_1', 'cart_2'] },
        userId: 'delivery_user_1',
        unitId: 'unit_1',
      },
    });
    expect((tx as any).cartItem).toBeUndefined();
  });

  it('returns existing delivery order ids without a second stock deduction when the checkout is already consumed', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      ...activeCheckout,
      status: 'PAID',
      providerTxnId: 'ALI_TXN_1',
      orders: [{ id: 'PSDD0000000000009', subOrders: [{ id: 'PSZDD000000000099' }] }],
    });

    const result = await service.createOrderFromPaidCheckout({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      rawPayload: { total_amount: '49.00' },
    });

    expect(tx.deliveryProductSku.updateMany).not.toHaveBeenCalled();
    expect(tx.deliveryOrder.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      orderId: 'PSDD0000000000009',
      subOrderIds: ['PSZDD000000000099'],
      idempotent: true,
      manifest: {
        status: 'PENDING',
        trigger: 'skipped-existing-order',
      },
    });
  });

  it('rebuilds a delivery order from a paid checkout that recorded provider success before order creation', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      ...activeCheckout,
      status: 'PAID',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      orders: [],
    });
    tx.deliveryProductSku.findMany.mockResolvedValue([
      {
        id: 'sku_1',
        stock: 20,
        supplyPriceCents: 800,
        basePriceCents: 1000,
        isActive: true,
        product: {
          id: 'product_1',
          merchantId: 'merchant_1',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
      {
        id: 'sku_2',
        stock: 10,
        supplyPriceCents: 1600,
        basePriceCents: 2000,
        isActive: true,
        product: {
          id: 'product_2',
          merchantId: 'merchant_2',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
    ]);
    tx.deliveryProductSku.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryOrder.create.mockResolvedValue({ id: 'PSDD0000000000001' });
    tx.deliverySubOrder.create
      .mockResolvedValueOnce({ id: 'PSZDD000000000001' })
      .mockResolvedValueOnce({ id: 'PSZDD000000000002' });
    tx.deliveryOrderItem.create.mockResolvedValue({});
    tx.deliveryPayment.upsert.mockResolvedValue({ id: 'PSZF0000000000001', status: 'PAID' });
    tx.deliveryCheckoutSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.createOrderFromPaidCheckout({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      rawPayload: { total_amount: '49.00' },
    });

    expect(tx.deliveryOrder.create).toHaveBeenCalled();
    expect(tx.deliveryPayment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          orderId: 'PSDD0000000000001',
          status: 'PAID',
        }),
      }),
    );
    expect(result).toMatchObject({
      orderId: 'PSDD0000000000001',
      idempotent: false,
    });
  });

  it('returns the order created by a concurrent paid-checkout callback when the unique checkout order guard wins the race', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      ...activeCheckout,
      status: 'PAID',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      orders: [],
    });
    tx.deliveryProductSku.findMany.mockResolvedValue([
      {
        id: 'sku_1',
        stock: 20,
        supplyPriceCents: 800,
        basePriceCents: 1000,
        isActive: true,
        product: {
          id: 'product_1',
          merchantId: 'merchant_1',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
      {
        id: 'sku_2',
        stock: 10,
        supplyPriceCents: 1600,
        basePriceCents: 2000,
        isActive: true,
        product: {
          id: 'product_2',
          merchantId: 'merchant_2',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
    ]);
    tx.deliveryProductSku.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryCheckoutSession.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryOrder.create.mockRejectedValue({ code: 'P2002' });
    deliveryPrisma.deliveryCheckoutSession.findUnique.mockResolvedValue({
      ...activeCheckout,
      status: 'PAID',
      providerTxnId: 'ALI_TXN_1',
      orders: [{ id: 'PSDD0000000000099', subOrders: [{ id: 'PSZDD000000000999' }] }],
    });

    const result = await service.createOrderFromPaidCheckout({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      rawPayload: { total_amount: '49.00' },
    });

    expect(deliveryPrisma.deliveryCheckoutSession.findUnique).toHaveBeenCalledWith({
      where: { merchantOrderNo: 'PSZF0000000000001' },
      include: {
        orders: {
          include: {
            subOrders: {
              select: { id: true },
            },
          },
        },
      },
    });
    expect(result).toEqual({
      orderId: 'PSDD0000000000099',
      subOrderIds: ['PSZDD000000000999'],
      idempotent: true,
      manifest: {
        status: 'PENDING',
        trigger: 'skipped-existing-order',
      },
    });
  });

  it('rejects a repeated callback with a different providerTxnId after the checkout is already paid', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      ...activeCheckout,
      status: 'PAID',
      providerTxnId: 'ALI_TXN_1',
      orders: [{ id: 'PSDD0000000000009', subOrders: [{ id: 'PSZDD000000000099' }] }],
    });

    await expect(
      service.createOrderFromPaidCheckout({
        merchantOrderNo: 'PSZF0000000000001',
        providerTxnId: 'ALI_TXN_2',
        paidAt: new Date('2026-06-19T12:00:00.000Z'),
        rawPayload: { total_amount: '49.00' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.deliveryProductSku.updateMany).not.toHaveBeenCalled();
    expect(tx.deliveryOrder.create).not.toHaveBeenCalled();
    expect(tx.deliveryPayment.upsert).not.toHaveBeenCalled();
  });

  it('creates the paid order from checkout snapshots even if the seller later disables the SKU or merchant', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      ...activeCheckout,
      itemsSnapshot: activeCheckout.itemsSnapshot.map((item) => ({
        ...item,
        supplyPriceCents: item.skuId === 'sku_1' ? 800 : 1600,
        weightGram: item.skuId === 'sku_1' ? 5000 : 10000,
      })),
    });
    tx.deliveryProductSku.findMany.mockResolvedValue([
      {
        id: 'sku_1',
        stock: 20,
        supplyPriceCents: 9999,
        basePriceCents: 9999,
        isActive: false,
        product: {
          id: 'product_1',
          merchantId: 'merchant_1',
          status: 'INACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'DISABLED',
          },
        },
      },
      {
        id: 'sku_2',
        stock: 10,
        supplyPriceCents: 9999,
        basePriceCents: 9999,
        isActive: false,
        product: {
          id: 'product_2',
          merchantId: 'merchant_2',
          status: 'INACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'DISABLED',
          },
        },
      },
    ]);
    tx.deliveryProductSku.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryOrder.create.mockResolvedValue({ id: 'PSDD0000000000001' });
    tx.deliverySubOrder.create
      .mockResolvedValueOnce({ id: 'PSZDD000000000001' })
      .mockResolvedValueOnce({ id: 'PSZDD000000000002' });
    tx.deliveryOrderItem.create.mockResolvedValue({});
    tx.deliveryPayment.upsert.mockResolvedValue({ id: 'PSZF0000000000001', status: 'PAID' });
    tx.deliveryCheckoutSession.updateMany.mockResolvedValue({ count: 1 });

    await service.createOrderFromPaidCheckout({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      rawPayload: { total_amount: '49.00' },
    });

    expect(tx.deliveryOrderItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skuId: 'sku_1',
          supplyUnitPriceCents: 800,
          baseUnitPriceCents: 1000,
          supplyAmountCents: 1600,
        }),
      }),
    );
  });

  it('creates the paid delivery order even when current stock dropped below the checkout quantity', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue(activeCheckout);
    tx.deliveryProductSku.findMany.mockResolvedValue([
      {
        id: 'sku_1',
        stock: 1,
        isActive: true,
        product: {
          id: 'product_1',
          merchantId: 'merchant_1',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
      {
        id: 'sku_2',
        stock: 10,
        isActive: true,
        product: {
          id: 'product_2',
          merchantId: 'merchant_2',
          status: 'ACTIVE',
          auditStatus: 'APPROVED',
          merchant: {
            status: 'ACTIVE',
          },
        },
      },
    ]);
    tx.deliveryProductSku.updateMany.mockResolvedValue({ count: 1 });
    tx.deliveryOrder.create.mockResolvedValue({ id: 'PSDD0000000000001' });
    tx.deliverySubOrder.create
      .mockResolvedValueOnce({ id: 'PSZDD000000000001' })
      .mockResolvedValueOnce({ id: 'PSZDD000000000002' });
    tx.deliveryOrderItem.create.mockResolvedValue({});
    tx.deliveryPayment.upsert.mockResolvedValue({ id: 'PSZF0000000000001', status: 'PAID' });
    tx.deliveryCheckoutSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.createOrderFromPaidCheckout({
      merchantOrderNo: 'PSZF0000000000001',
      providerTxnId: 'ALI_TXN_1',
      paidAt: new Date('2026-06-19T12:00:00.000Z'),
      rawPayload: { total_amount: '49.00' },
    });

    expect(tx.deliveryProductSku.updateMany).toHaveBeenCalledWith({
      where: { id: 'sku_1' },
      data: { stock: { decrement: 2 } },
    });
    expect(tx.deliveryInventoryLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skuId: 'sku_1',
          beforeStock: 1,
          afterStock: -1,
        }),
      }),
    );
    expect(tx.deliveryOrder.create).toHaveBeenCalled();
    expect(tx.deliveryPayment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'PAID',
          orderId: 'PSDD0000000000001',
        }),
      }),
    );
    expect(result).toMatchObject({
      orderId: 'PSDD0000000000001',
      idempotent: false,
    });
  });

  it('lists only the authenticated buyer delivery orders with pagination', async () => {
    deliveryPrisma.deliveryOrder.count.mockResolvedValue(1);
    deliveryPrisma.deliveryOrder.findMany.mockResolvedValue([
      {
        id: 'PSDD0000000000001',
        status: 'PENDING_SHIPMENT',
        note: '下班前送达',
        goodsAmountCents: 5200,
        shippingFeeCents: 800,
        totalAmountCents: 6000,
        createdAt: new Date('2026-06-19T12:00:00.000Z'),
        paidAt: new Date('2026-06-19T12:10:00.000Z'),
        unitSnapshot: {
          id: 'unit_1',
          name: '华南餐饮部',
          contactName: '张三',
          contactPhone: '13800000000',
        },
        addressSnapshot: {
          recipientName: '李四',
          phone: '13900000000',
          regionText: '广东省 广州市 天河区',
          detailAddress: '体育西路 1 号',
        },
        payments: [{ merchantOrderNo: 'PSZF0000000000001', channel: 'ALIPAY' }],
        items: [
          {
            id: 'item_1',
            subOrderId: 'PSZDD000000000001',
            productId: 'product_1',
            skuId: 'sku_1',
            quantity: 2,
            unitPriceCents: 2600,
            lineAmountCents: 5200,
            productSnapshot: {
              productTitle: '冷鲜牛腩',
              skuTitle: '5kg/箱',
              imageUrl: 'https://img.example.com/a.png',
              unitName: '箱',
            },
            subOrder: {
              id: 'PSZDD000000000001',
              merchantId: 'merchant_1',
              status: 'PENDING_SHIPMENT',
              totalAmountCents: 6000,
              shippingFeeShareCents: 800,
              merchant: { name: '华南仓' },
            },
          },
        ],
        subOrders: [
          {
            id: 'PSZDD000000000001',
            merchantId: 'merchant_1',
            status: 'PENDING_SHIPMENT',
            totalAmountCents: 6000,
            shippingFeeShareCents: 800,
            merchant: { name: '华南仓' },
          },
        ],
        shipments: [],
      },
    ]);

    const result = await service.listBuyerOrders('delivery_user_1', {
      page: 2,
      pageSize: 5,
      status: 'PENDING_SHIPMENT',
    });

    expect(deliveryPrisma.deliveryOrder.count).toHaveBeenCalledWith({
      where: {
        userId: 'delivery_user_1',
        status: 'PENDING_SHIPMENT',
      },
    });
    expect(deliveryPrisma.deliveryOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'delivery_user_1',
          status: 'PENDING_SHIPMENT',
        },
        skip: 5,
        take: 5,
      }),
    );
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 5,
      items: [
        {
          id: 'PSDD0000000000001',
          merchantOrderNo: 'PSZF0000000000001',
          unit: { name: '华南餐饮部' },
          items: [{ productTitle: '冷鲜牛腩' }],
        },
      ],
    });
  });

  it('returns one authenticated buyer delivery order detail with shipments', async () => {
    deliveryPrisma.deliveryOrder.findFirst.mockResolvedValue({
      id: 'PSDD0000000000001',
      userId: 'delivery_user_1',
      status: 'SHIPPED',
      note: '下班前送达',
      goodsAmountCents: 5200,
      shippingFeeCents: 800,
      totalAmountCents: 6000,
      createdAt: new Date('2026-06-19T12:00:00.000Z'),
      paidAt: new Date('2026-06-19T12:10:00.000Z'),
      unitSnapshot: {
        id: 'unit_1',
        name: '华南餐饮部',
        contactName: '张三',
        contactPhone: '13800000000',
      },
      addressSnapshot: {
        recipientName: '李四',
        phone: '13900000000',
        regionText: '广东省 广州市 天河区',
        detailAddress: '体育西路 1 号',
      },
      payments: [{ merchantOrderNo: 'PSZF0000000000001', channel: 'ALIPAY' }],
      items: [
        {
          id: 'item_1',
          subOrderId: 'PSZDD000000000001',
          productId: 'product_1',
          skuId: 'sku_1',
          quantity: 2,
          unitPriceCents: 2600,
          lineAmountCents: 5200,
          productSnapshot: {
            productTitle: '冷鲜牛腩',
            skuTitle: '5kg/箱',
            imageUrl: 'https://img.example.com/a.png',
            unitName: '箱',
          },
          subOrder: {
            id: 'PSZDD000000000001',
            merchantId: 'merchant_1',
            status: 'SHIPPED',
            totalAmountCents: 6000,
            shippingFeeShareCents: 800,
            merchant: { name: '华南仓' },
          },
        },
      ],
      subOrders: [
        {
          id: 'PSZDD000000000001',
          merchantId: 'merchant_1',
          status: 'SHIPPED',
          totalAmountCents: 6000,
          shippingFeeShareCents: 800,
          merchant: { name: '华南仓' },
        },
      ],
      shipments: [
        {
          id: 'shipment_1',
          status: 'SHIPPED',
          carrierCode: 'SF',
          carrierName: '顺丰速运',
          waybillNo: 'SF123',
          waybillUrl: 'https://oss.example.com/waybill.pdf',
          shippedAt: new Date('2026-06-19T13:00:00.000Z'),
          deliveredAt: null,
        },
      ],
    });

    const result = await service.getBuyerOrder(
      'delivery_user_1',
      'PSDD0000000000001',
    );

    expect(deliveryPrisma.deliveryOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'PSDD0000000000001',
          userId: 'delivery_user_1',
        },
      }),
    );
    expect(result).toMatchObject({
      id: 'PSDD0000000000001',
      status: 'SHIPPED',
      shipments: [{ waybillNo: 'SF123' }],
      address: { detailAddress: '体育西路 1 号' },
      items: [{ skuTitle: '5kg/箱' }],
    });
  });
});
