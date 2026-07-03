import { CheckoutService } from './checkout.service';

function makeNormalSession(overrides: any = {}) {
  return {
    id: 'sess-normal',
    userId: 'buyer-1',
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
    expectedTotal: 150,
    goodsAmount: 150,
    addressSnapshot: {},
    itemsSnapshot: [
      {
        skuId: 'sku-a',
        quantity: 1,
        cartItemId: 'ci-a',
        isPrize: false,
        unitPrice: 100,
        companyId: 'company-a',
        productSnapshot: { title: 'A' },
      },
      {
        skuId: 'sku-b',
        quantity: 1,
        cartItemId: 'ci-b',
        isPrize: false,
        unitPrice: 50,
        companyId: 'company-b',
        productSnapshot: { title: 'B' },
      },
    ],
    ...overrides,
  };
}

function makeTx(session: any, existingOrders: Array<{ id: string }> = []) {
  const createdOrders: any[] = [];
  const tx: any = {
    checkoutSession: {
      findUnique: jest.fn().mockResolvedValue(session),
      updateMany: jest.fn().mockResolvedValue({ count: session.status === 'ACTIVE' ? 1 : 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      create: jest.fn(async ({ data }: any) => {
        const order = { id: `order-${createdOrders.length + 1}`, ...data };
        createdOrders.push(order);
        return order;
      }),
      findMany: jest.fn().mockResolvedValue(existingOrders),
    },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    inventoryLedger: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
    productSKU: {
      update: jest.fn().mockResolvedValue({ stock: 10 }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    rewardLedger: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    groupBuyCode: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    groupBuyActivity: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'activity-1',
        status: 'ACTIVE',
        startAt: null,
        endAt: new Date('2099-01-01T00:00:00.000Z'),
        deletedAt: null,
      }),
    },
    groupBuyInstance: {
      create: jest.fn().mockResolvedValue({ id: 'group-buy-instance-1' }),
    },
    cart: { findUnique: jest.fn().mockResolvedValue(null) },
    cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    lotteryRecord: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  return { tx, createdOrders };
}

function makeService(tx: any) {
  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const service = new CheckoutService(prisma, {} as any);
  const directService = {
    createFrozenForPaidOrder: jest.fn().mockResolvedValue('credited'),
  };
  service.setVipDirectReferralCommissionService(directService as any);
  return { service, prisma, directService };
}

describe('CheckoutService VIP direct referral commission hook', () => {
  it('calls direct commission service once per created normal goods order inside the payment transaction', async () => {
    const { tx } = makeTx(makeNormalSession());
    const { service, directService } = makeService(tx);

    const result = await service.handlePaymentSuccess(
      'MO-NORMAL',
      'TX-NORMAL',
      '2026-07-03T00:00:00.000Z',
    );

    expect(result.orderIds).toEqual(['order-1', 'order-2']);
    expect(directService.createFrozenForPaidOrder).toHaveBeenCalledTimes(2);
    expect(directService.createFrozenForPaidOrder).toHaveBeenNthCalledWith(1, tx, 'order-1');
    expect(directService.createFrozenForPaidOrder).toHaveBeenNthCalledWith(2, tx, 'order-2');
  });

  it('does not call direct commission service for VIP package payment', async () => {
    const session = makeNormalSession({
      id: 'sess-vip',
      bizType: 'VIP_PACKAGE',
      merchantOrderNo: 'MO-VIP',
      expectedTotal: 399,
      goodsAmount: 399,
      bizMeta: {
        vipGiftOptionId: 'gift-1',
        giftTitle: 'VIP Gift',
        snapshotPrice: 399,
      },
      itemsSnapshot: [
        {
          skuId: 'sku-vip',
          quantity: 1,
          isPrize: false,
          unitPrice: 399,
          companyId: 'company-vip',
          productSnapshot: { title: 'VIP Gift' },
        },
      ],
    });
    const { tx } = makeTx(session);
    tx.inventoryLedger.updateMany.mockResolvedValue({ count: 1 });
    const { service, directService } = makeService(tx);

    await service.handlePaymentSuccess('MO-VIP', 'TX-VIP');

    expect(directService.createFrozenForPaidOrder).not.toHaveBeenCalled();
  });

  it('does not call direct commission service for group-buy payment', async () => {
    const session = makeNormalSession({
      id: 'sess-gb',
      bizType: 'GROUP_BUY',
      merchantOrderNo: 'MO-GB',
      expectedTotal: 100,
      goodsAmount: 100,
      bizMeta: {
        groupBuyActivityId: 'activity-1',
        tierSnapshot: [{ sequence: 1, basisPoints: 1000 }],
        groupBuyPriceSnapshot: 100,
        shippingFeeSnapshot: 0,
        freeShippingSnapshot: true,
      },
      itemsSnapshot: [
        {
          skuId: 'sku-gb',
          quantity: 1,
          isPrize: false,
          unitPrice: 100,
          companyId: 'company-gb',
          productSnapshot: { title: 'Group Buy' },
        },
      ],
    });
    const { tx } = makeTx(session);
    const { service, directService } = makeService(tx);

    await service.handlePaymentSuccess('MO-GB', 'TX-GB');

    expect(directService.createFrozenForPaidOrder).not.toHaveBeenCalled();
  });

  it('does not call direct commission service again for duplicate payment callback', async () => {
    const duplicateSession = makeNormalSession({
      status: 'COMPLETED',
    });
    const { tx } = makeTx(duplicateSession, [{ id: 'existing-order-1' }]);
    const { service, directService } = makeService(tx);

    const result = await service.handlePaymentSuccess('MO-NORMAL', 'TX-DUP');

    expect(result).toEqual({ orderIds: ['existing-order-1'] });
    expect(directService.createFrozenForPaidOrder).not.toHaveBeenCalled();
  });
});
