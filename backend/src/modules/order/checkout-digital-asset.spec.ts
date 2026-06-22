import { CheckoutService } from './checkout.service';

describe('CheckoutService digital asset frozen hook', () => {
  it('freezes digital credit assets after normal goods payment creates orders', async () => {
    const session = {
      id: 'sess-normal',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'NORMAL_GOODS',
      merchantOrderNo: 'MO-NORMAL',
      rewardId: null,
      discountAmount: 0,
      vipDiscountAmount: 0,
      totalCouponDiscount: 0,
      couponInstanceIds: [],
      couponPerAmounts: [],
      shippingFee: 0,
      expectedTotal: 100,
      goodsAmount: 100,
      addressSnapshot: {},
      itemsSnapshot: [
        {
          skuId: 'sku-a',
          quantity: 1,
          cartItemId: 'ci-a',
          isPrize: false,
          unitPrice: 100,
          companyId: 'company-a',
          productSnapshot: { title: '商品 A' },
        },
      ],
    };
    const createdOrders: any[] = [];
    const tx: any = {
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        create: jest.fn(async ({ data }: any) => {
          const order = { id: `order-${createdOrders.length + 1}`, ...data };
          createdOrders.push(order);
          return order;
        }),
        findMany: jest.fn(),
      },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      inventoryLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      productSKU: {
        update: jest.fn().mockResolvedValue({ stock: 10 }),
        findUnique: jest.fn(),
      },
      rewardLedger: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      cart: { findUnique: jest.fn().mockResolvedValue(null) },
      cartItem: { deleteMany: jest.fn() },
      lotteryRecord: { updateMany: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const digitalAssetService = {
      recordOrderPaid: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CheckoutService(prisma, {} as any);
    service.setDigitalAssetService(digitalAssetService as any);

    await service.handlePaymentSuccess('MO-NORMAL', 'TX-NORMAL', '2026-06-21T00:00:00.000Z');

    expect(createdOrders).toHaveLength(1);
    expect(digitalAssetService.recordOrderPaid).toHaveBeenCalledWith('order-1');
  });

  it('keeps payment success completed when frozen asset creation fails', async () => {
    const session = {
      id: 'sess-normal',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'NORMAL_GOODS',
      merchantOrderNo: 'MO-NORMAL',
      rewardId: null,
      discountAmount: 0,
      vipDiscountAmount: 0,
      totalCouponDiscount: 0,
      couponInstanceIds: [],
      couponPerAmounts: [],
      shippingFee: 0,
      expectedTotal: 100,
      goodsAmount: 100,
      addressSnapshot: {},
      itemsSnapshot: [
        {
          skuId: 'sku-a',
          quantity: 1,
          cartItemId: 'ci-a',
          isPrize: false,
          unitPrice: 100,
          companyId: 'company-a',
          productSnapshot: { title: '商品 A' },
        },
      ],
    };
    const tx: any = {
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'order-1' }),
        findMany: jest.fn(),
      },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      inventoryLedger: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      productSKU: {
        update: jest.fn().mockResolvedValue({ stock: 10 }),
        findUnique: jest.fn(),
      },
      rewardLedger: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      cart: { findUnique: jest.fn().mockResolvedValue(null) },
      cartItem: { deleteMany: jest.fn() },
      lotteryRecord: { updateMany: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const digitalAssetService = {
      recordOrderPaid: jest.fn().mockRejectedValue(new Error('asset unavailable')),
    };
    const service = new CheckoutService(prisma, {} as any);
    service.setDigitalAssetService(digitalAssetService as any);

    await expect(
      service.handlePaymentSuccess('MO-NORMAL', 'TX-NORMAL', '2026-06-21T00:00:00.000Z'),
    ).resolves.toEqual({ orderIds: ['order-1'] });
  });
});
