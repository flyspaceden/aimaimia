import { BadRequestException } from '@nestjs/common';
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
      where: { id: 'sku_1', stock: { gte: 2 } },
      data: { stock: { decrement: 2 } },
    });
    expect(tx.deliveryProductSku.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'sku_2', stock: { gte: 1 } },
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

  it('returns existing delivery order ids without a second stock deduction when the checkout is already consumed', async () => {
    tx.deliveryCheckoutSession.findUnique.mockResolvedValue({
      ...activeCheckout,
      status: 'PAID',
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

  it('rejects payment success when current delivery stock is insufficient and never decrements below zero', async () => {
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

    await expect(
      service.createOrderFromPaidCheckout({
        merchantOrderNo: 'PSZF0000000000001',
        providerTxnId: 'ALI_TXN_1',
        paidAt: new Date('2026-06-19T12:00:00.000Z'),
        rawPayload: { total_amount: '49.00' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.deliveryProductSku.updateMany).not.toHaveBeenCalled();
    expect(tx.deliveryOrder.create).not.toHaveBeenCalled();
    expect(tx.deliveryPayment.upsert).not.toHaveBeenCalled();
  });
});
