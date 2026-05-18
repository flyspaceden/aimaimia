import { CheckoutService } from './checkout.service';

describe('CheckoutService VIP package order amount', () => {
  it('uses the paid VIP package amount instead of the gift SKU total', async () => {
    const session = {
      id: 'sess-vip',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'VIP_PACKAGE',
      bizMeta: {
        vipGiftOptionId: 'gift-1',
        giftTitle: 'VIP 专属礼包',
        snapshotPrice: 399,
      },
      merchantOrderNo: 'MO-VIP',
      rewardId: null,
      discountAmount: 0,
      vipDiscountAmount: 0,
      totalCouponDiscount: 0,
      couponInstanceIds: [],
      couponPerAmounts: [],
      shippingFee: 0,
      expectedTotal: 399,
      goodsAmount: 399,
      addressSnapshot: {},
      itemsSnapshot: [
        {
          skuId: 'sku-a',
          quantity: 2,
          isPrize: false,
          unitPrice: 26,
          companyId: 'platform-company',
          productSnapshot: { title: '赠品 A' },
        },
        {
          skuId: 'sku-b',
          quantity: 1,
          isPrize: false,
          unitPrice: 18,
          companyId: 'platform-company',
          productSnapshot: { title: '赠品 B' },
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      cart: { findUnique: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
      lotteryRecord: { updateMany: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new CheckoutService(prisma, {} as any);

    await service.handlePaymentSuccess('MO-VIP', 'TX-VIP', '2026-05-18T00:00:00.000Z');

    expect(createdOrders).toHaveLength(1);
    expect(createdOrders[0]).toMatchObject({
      bizType: 'VIP_PACKAGE',
      totalAmount: 399,
      goodsAmount: 399,
      shippingFee: 0,
    });
    expect(createdOrders[0].items.create).toHaveLength(2);
  });
});
