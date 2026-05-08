import { CheckoutService } from './checkout.service';

describe('CheckoutService excluded prize cleanup', () => {
  const validAddress = {
    id: 'addr1',
    userId: 'user1',
    regionText: '北京市/北京市/朝阳区',
    regionCode: '110000',
    recipientName: '张三',
    phone: '13800000000',
    detail: '街道一号',
  };

  const normalSku = {
    id: 'sku-normal',
    productId: 'product-normal',
    title: '普通 SKU',
    price: 50,
    stock: 10,
    status: 'ACTIVE',
    maxPerOrder: null,
    weightGram: 0,
    product: {
      id: 'product-normal',
      title: '普通商品',
      status: 'ACTIVE',
      companyId: 'company-1',
      media: [],
    },
  };

  const inactivePrizeSku = {
    id: 'sku-prize',
    productId: 'product-prize',
    title: '奖品 SKU',
    price: 0,
    stock: 10,
    status: 'INACTIVE',
    maxPerOrder: null,
    weightGram: 0,
    product: {
      id: 'product-prize',
      title: '停发奖品',
      status: 'ACTIVE',
      companyId: 'platform-company',
      media: [],
    },
  };

  it('stores excluded prize cleanup metadata when checkout soft-excludes an inactive prize SKU', async () => {
    let createdSessionData: any;
    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([normalSku, inactivePrizeSku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ci-prize',
            cartId: 'cart1',
            skuId: 'sku-prize',
            quantity: 1,
            isPrize: true,
            prizeRecordId: 'lr-prize',
            expiresAt: null,
          },
        ]),
      },
      address: { findUnique: jest.fn().mockResolvedValue(validAddress) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb({
        checkoutSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(async ({ data }: any) => {
            createdSessionData = data;
            return {
              id: 'sess1',
              merchantOrderNo: data.merchantOrderNo,
              expectedTotal: data.expectedTotal,
              goodsAmount: data.goodsAmount,
              shippingFee: data.shippingFee,
              discountAmount: data.discountAmount,
              paymentChannel: data.paymentChannel,
              vipDiscountAmount: data.vipDiscountAmount,
              totalCouponDiscount: data.totalCouponDiscount,
              couponInstanceIds: data.couponInstanceIds,
            };
          }),
        },
        rewardLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      })),
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: 0,
        vipFreeShippingThreshold: 0,
        defaultShippingFee: 0,
      }),
    };
    const service = new CheckoutService(prisma, bonusConfig);

    const result = await service.checkout('user1', {
      items: [
        { skuId: 'sku-normal', quantity: 1, cartItemId: 'ci-normal' },
        { skuId: 'sku-prize', quantity: 1, cartItemId: 'ci-prize' },
      ],
      addressId: 'addr1',
      expectedTotal: 50,
    } as any);

    expect((result as any).excludedItems).toEqual([
      expect.objectContaining({
        cartItemId: 'ci-prize',
        prizeRecordId: 'lr-prize',
        isPrize: true,
        reason: '商品规格已下架',
      }),
    ]);
    expect(createdSessionData.bizMeta).toMatchObject({
      excludedPrizeItems: [
        expect.objectContaining({
          cartItemId: 'ci-prize',
          prizeRecordId: 'lr-prize',
          skuId: 'sku-prize',
          isPrize: true,
        }),
      ],
    });
  });

  it('deletes soft-excluded prize cart item and expires its LotteryRecord after payment succeeds', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const updateLotteryRecords = jest.fn().mockResolvedValue({ count: 1 });
    const session = {
      id: 'sess1',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'NORMAL_GOODS',
      bizMeta: {
        excludedPrizeItems: [
          {
            cartItemId: 'ci-prize',
            prizeRecordId: 'lr-prize',
            skuId: 'sku-prize',
            reason: '商品规格已下架',
            isPrize: true,
          },
        ],
      },
      merchantOrderNo: 'MO-1',
      rewardId: null,
      discountAmount: 0,
      vipDiscountAmount: 0,
      totalCouponDiscount: 0,
      couponInstanceIds: [],
      couponPerAmounts: [],
      shippingFee: 0,
      expectedTotal: 50,
      addressSnapshot: validAddress,
      itemsSnapshot: [
        {
          skuId: 'sku-normal',
          quantity: 1,
          cartItemId: 'ci-normal',
          isPrize: false,
          unitPrice: 50,
          companyId: 'company-1',
          productSnapshot: { title: '普通商品' },
        },
      ],
    };
    const tx: any = {
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      order: { create: jest.fn().mockResolvedValue({ id: 'order1' }), findMany: jest.fn() },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      productSKU: { update: jest.fn().mockResolvedValue({ stock: 9 }) },
      inventoryLedger: { create: jest.fn().mockResolvedValue({}) },
      rewardLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1' }) },
      cartItem: { deleteMany },
      lotteryRecord: { updateMany: updateLotteryRecords },
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new CheckoutService(prisma, {} as any);

    await service.handlePaymentSuccess('MO-1', 'TX-1', '2026-05-07T06:00:00.000Z');

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        cartId: 'cart1',
        OR: [
          { id: { in: expect.arrayContaining(['ci-normal', 'ci-prize']) } },
          { isPrize: true, prizeRecordId: { in: expect.arrayContaining(['lr-prize']) } },
        ],
      },
    });
    expect(updateLotteryRecords).toHaveBeenCalledWith({
      where: {
        id: { in: ['lr-prize'] },
        status: { in: ['WON', 'IN_CART'] },
      },
      data: { status: 'EXPIRED' },
    });
  });
});
