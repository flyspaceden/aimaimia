import { CheckoutService } from './checkout.service';

function makeSession(overrides: any = {}) {
  return {
    id: 'session-1',
    userId: 'buyer-1',
    status: 'ACTIVE',
    bizType: 'NORMAL_GOODS',
    merchantOrderNo: 'MO-1',
    providerTxnId: null,
    expectedTotal: 147,
    goodsAmount: 150,
    shippingFee: 0,
    discountAmount: 0,
    groupBuyRebateDeductionAmount: 3,
    groupBuyRebateDeductionGroupId: null,
    vipDiscountAmount: 0,
    totalCouponDiscount: 0,
    couponInstanceIds: [],
    couponPerAmounts: [],
    rewardId: null,
    deductionGroupId: null,
    buyerNote: null,
    addressSnapshot: {},
    bizMeta: null,
    itemsSnapshot: [
      {
        skuId: 'sku-a',
        quantity: 1,
        cartItemId: 'cart-a',
        isPrize: false,
        unitPrice: 100,
        companyId: 'company-a',
        productSnapshot: { title: 'A' },
      },
      {
        skuId: 'sku-b',
        quantity: 1,
        cartItemId: 'cart-b',
        isPrize: false,
        unitPrice: 50,
        companyId: 'company-b',
        productSnapshot: { title: 'B' },
      },
    ],
    ...overrides,
  };
}

function makeFixture(session = makeSession(), existingOrders: Array<{ id: string }> = []) {
  const events: string[] = [];
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
        events.push(`order:${order.id}`);
        return order;
      }),
      findMany: jest.fn().mockResolvedValue(existingOrders),
    },
    orderStatusHistory: {
      create: jest.fn(async ({ data }: any) => {
        events.push(`history:${data.orderId}`);
        return {};
      }),
    },
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
    groupBuyRebateLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cart: { findUnique: jest.fn().mockResolvedValue(null) },
    cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    lotteryRecord: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma: any = {
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  };
  const service = new CheckoutService(prisma, {} as any);
  const snapshotService = {
    createForPaidOrder: jest.fn(async (_tx: any, orderId: string) => {
      events.push(`snapshot:${orderId}`);
      return { id: `snapshot-${orderId}`, status: 'READY' };
    }),
  };
  const directService = {
    createFrozenForPaidOrder: jest.fn(async (_tx: any, orderId: string) => {
      events.push(`direct:${orderId}`);
      return 'skipped';
    }),
  };
  const captainService = {
    createFrozenForPaidOrder: jest.fn(async (_tx: any, orderId: string) => {
      events.push(`captain:${orderId}`);
      return 'skipped';
    }),
  };
  service.setOrderProfitSnapshotService(snapshotService as any);
  service.setVipDirectReferralCommissionService(directService as any);
  service.setCaptainAttributionService(captainService as any);

  return {
    service,
    prisma,
    tx,
    events,
    createdOrders,
    snapshotService,
    directService,
    captainService,
  };
}

describe('CheckoutService payment-time profit snapshot', () => {
  it('retries a first-enrollment unique conflict in a fresh Serializable transaction', async () => {
    const fixture = makeFixture();
    fixture.prisma.$transaction
      .mockRejectedValueOnce(Object.assign(new Error('normal tree enrollment race'), {
        code: 'P2002',
        meta: { modelName: 'NormalTreeNode', target: ['userId'] },
      }))
      .mockImplementation(async (callback: any) => callback(fixture.tx));

    await expect(fixture.service.handlePaymentSuccess('MO-1', 'TX-RACE')).resolves.toEqual({
      orderIds: ['order-1', 'order-2'],
    });
    expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('stores exact group-buy allocations and snapshots every suborder before history and attribution', async () => {
    const fixture = makeFixture();

    await expect(fixture.service.handlePaymentSuccess('MO-1', 'TX-1')).resolves.toEqual({
      orderIds: ['order-1', 'order-2'],
    });

    expect(fixture.createdOrders.map((order) => order.groupBuyRebateDeductionAmount)).toEqual([2, 1]);
    expect(
      fixture.createdOrders.reduce(
        (total, order) => total + order.groupBuyRebateDeductionAmount,
        0,
      ),
    ).toBe(3);
    expect(fixture.snapshotService.createForPaidOrder).toHaveBeenNthCalledWith(
      1,
      fixture.tx,
      'order-1',
    );
    expect(fixture.snapshotService.createForPaidOrder).toHaveBeenNthCalledWith(
      2,
      fixture.tx,
      'order-2',
    );
    expect(fixture.events).toEqual([
      'order:order-1',
      'snapshot:order-1',
      'history:order-1',
      'direct:order-1',
      'captain:order-1',
      'order:order-2',
      'snapshot:order-2',
      'history:order-2',
      'direct:order-2',
      'captain:order-2',
    ]);
  });

  it('allocates discounts in calculator order without over-discounting either merchant by one cent', async () => {
    const fixture = makeFixture(makeSession({
      expectedTotal: 0,
      discountAmount: 50,
      groupBuyRebateDeductionAmount: 0,
      vipDiscountAmount: 100,
    }));

    await fixture.service.handlePaymentSuccess('MO-1', 'TX-CAPACITY');

    expect(fixture.createdOrders.map((order) => ({
      goodsAmount: order.goodsAmount,
      vipDiscountAmount: order.vipDiscountAmount,
      rewardDeductionAmount: order.discountAmount,
    }))).toEqual([
      { goodsAmount: 100, vipDiscountAmount: 66.66, rewardDeductionAmount: 33.34 },
      { goodsAmount: 50, vipDiscountAmount: 33.34, rewardDeductionAmount: 16.66 },
    ]);
    for (const order of fixture.createdOrders) {
      expect(order.vipDiscountAmount + order.discountAmount).toBeLessThanOrEqual(order.goodsAmount);
    }
  });

  it('excludes the whole VIP package payment even when its item is not marked as prize', async () => {
    const fixture = makeFixture(makeSession({
      bizType: 'VIP_PACKAGE',
      groupBuyRebateDeductionAmount: 0,
      expectedTotal: 399,
      goodsAmount: 399,
      itemsSnapshot: [{
        skuId: 'vip-sku',
        quantity: 1,
        isPrize: false,
        unitPrice: 399,
        companyId: 'company-a',
        productSnapshot: { title: 'VIP Package' },
      }],
    }));
    fixture.tx.inventoryLedger.updateMany.mockResolvedValue({ count: 1 });

    await fixture.service.handlePaymentSuccess('MO-1', 'TX-VIP');

    expect(fixture.snapshotService.createForPaidOrder).not.toHaveBeenCalled();
    expect(fixture.directService.createFrozenForPaidOrder).not.toHaveBeenCalled();
    expect(fixture.captainService.createFrozenForPaidOrder).not.toHaveBeenCalled();
  });

  it('keeps payment successful but skips reward paths for reconciliation-required snapshots', async () => {
    const fixture = makeFixture(makeSession({
      itemsSnapshot: [makeSession().itemsSnapshot[0]],
      goodsAmount: 100,
      expectedTotal: 97,
    }));
    fixture.snapshotService.createForPaidOrder.mockImplementationOnce(
      async (_tx: any, orderId: string) => {
        fixture.events.push(`snapshot:${orderId}`);
        return { id: `snapshot-${orderId}`, status: 'RECONCILIATION_REQUIRED' };
      },
    );

    await expect(fixture.service.handlePaymentSuccess('MO-1', 'TX-RECON')).resolves.toEqual({
      orderIds: ['order-1'],
    });

    expect(fixture.directService.createFrozenForPaidOrder).not.toHaveBeenCalled();
    expect(fixture.captainService.createFrozenForPaidOrder).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      'order:order-1',
      'snapshot:order-1',
      'history:order-1',
    ]);
  });

  it('does not create another snapshot for a duplicate payment callback', async () => {
    const fixture = makeFixture(
      makeSession({ status: 'COMPLETED' }),
      [{ id: 'existing-order-1' }],
    );

    await expect(fixture.service.handlePaymentSuccess('MO-1', 'TX-DUP')).resolves.toEqual({
      orderIds: ['existing-order-1'],
    });

    expect(fixture.snapshotService.createForPaidOrder).not.toHaveBeenCalled();
  });
});
