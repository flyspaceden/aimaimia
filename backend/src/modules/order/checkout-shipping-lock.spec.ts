import { CheckoutService } from './checkout.service';
import { DEFAULT_SKU_WEIGHT_GRAM } from '../../common/constants/shipping.constants';

describe('CheckoutService shipping lock-in', () => {
  const validAddress = {
    id: 'addr1',
    userId: 'user1',
    regionText: '北京市/北京市/朝阳区',
    regionCode: '110000',
    recipientName: '张三',
    phone: '13800000000',
    detail: '街道一号',
  };

  const buildSku = (overrides: Partial<any>) => ({
    id: 'sku',
    productId: 'product',
    title: 'SKU',
    price: 0,
    stock: 20,
    status: 'ACTIVE',
    maxPerOrder: null,
    weightGram: 1000,
    product: {
      id: 'product',
      title: '商品',
      status: 'ACTIVE',
      companyId: 'company',
      media: [],
    },
    ...overrides,
  });

  async function runCheckoutForShippingThreshold(input: {
    goodsAmount: number;
    isVip: boolean;
    normalFreeShippingThreshold: number;
    vipFreeShippingThreshold: number;
  }) {
    let createdSessionData: any;
    const sku = buildSku({
      id: 'sku-threshold',
      productId: 'product-threshold',
      title: '门槛 SKU',
      price: input.goodsAmount,
      weightGram: undefined,
      product: {
        id: 'product-threshold',
        title: '门槛商品',
        status: 'ACTIVE',
        companyId: 'company-threshold',
        media: [],
      },
    });
    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: { findUnique: jest.fn().mockResolvedValue(validAddress) },
      vipTreeNode: {
        findFirst: jest.fn().mockResolvedValue(input.isVip ? { id: 'vip-node-1' } : null),
      },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb({
        checkoutSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(async ({ data }: any) => {
            createdSessionData = {
              id: 'sess-threshold',
              userId: 'user1',
              status: 'ACTIVE',
              bizType: 'NORMAL_GOODS',
              ...data,
            };
            return createdSessionData;
          }),
        },
        rewardLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      })),
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: input.normalFreeShippingThreshold,
        vipFreeShippingThreshold: input.vipFreeShippingThreshold,
        vipDiscountRate: 1,
        defaultShippingFee: 8,
      }),
    };
    const shippingRuleService = {
      calculateShippingDetail: jest.fn().mockResolvedValue({ fee: 8 }),
      calculateShippingFee: jest.fn(),
    };
    const service = new CheckoutService(prisma, bonusConfig);
    service.setShippingRuleService(shippingRuleService);

    const result = await service.checkout('user1', {
      items: [{ skuId: 'sku-threshold', quantity: 1, cartItemId: 'ci-threshold' }],
      addressId: 'addr1',
      expectedTotal: input.goodsAmount,
    } as any);

    return { result, createdSessionData, shippingRuleService };
  }

  function buildPaymentTx(session: any, createdOrders: any[]) {
    return {
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
      productSKU: {
        update: jest.fn().mockResolvedValue({ stock: 10 }),
        findUnique: jest.fn(),
      },
      inventoryLedger: { create: jest.fn().mockResolvedValue({}) },
      rewardLedger: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1' }) },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      lotteryRecord: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
  }

  it('locks shipping detail at checkout and payment success does not recalculate it', async () => {
    let createdSessionData: any;
    const normalSku = buildSku({
      id: 'sku-normal',
      productId: 'product-normal',
      title: '普通 SKU',
      price: 20,
      weightGram: 500,
      product: {
        id: 'product-normal',
        title: '普通商品',
        status: 'ACTIVE',
        companyId: 'company-1',
        media: [],
      },
    });
    const prizeSku = buildSku({
      id: 'sku-prize',
      productId: 'product-prize',
      title: '奖品 SKU',
      price: 0,
      weightGram: 0,
      product: {
        id: 'product-prize',
        title: '奖品商品',
        status: 'ACTIVE',
        companyId: 'company-2',
        media: [],
      },
    });
    const fallbackGiftSku = buildSku({
      id: 'sku-gift',
      productId: 'product-gift',
      title: '赠品 SKU',
      price: 0,
      weightGram: undefined,
      product: {
        id: 'product-gift',
        title: '赠品商品',
        status: 'ACTIVE',
        companyId: 'company-2',
        media: [],
      },
    });

    const prisma: any = {
      productSKU: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([normalSku, prizeSku])
          .mockResolvedValueOnce([fallbackGiftSku]),
      },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ci-prize',
            cartId: 'cart1',
            skuId: 'sku-prize',
            quantity: 1,
            isPrize: true,
            prizeRecordId: null,
            expiresAt: null,
          },
          {
            id: 'ci-gift',
            cartId: 'cart1',
            skuId: 'sku-gift',
            quantity: 3,
            isPrize: true,
            prizeRecordId: null,
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
            createdSessionData = {
              id: 'sess1',
              userId: 'user1',
              status: 'ACTIVE',
              bizType: 'NORMAL_GOODS',
              ...data,
            };
            return createdSessionData;
          }),
        },
        rewardLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      })),
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: 99,
        vipFreeShippingThreshold: 99,
        defaultShippingFee: 8,
      }),
    };
    const shippingRuleService = {
      calculateShippingDetail: jest.fn().mockResolvedValue({
        fee: 12.34,
        matchedRuleId: 'rule1',
        matchedRuleName: '北京规则',
        billingWeightKg: 5,
        formula: 'test',
        fallbackUsed: false,
      }),
      calculateShippingFee: jest.fn(),
    };
    const service = new CheckoutService(prisma, bonusConfig);
    service.setShippingRuleService(shippingRuleService);

    const checkoutResult = await service.checkout('user1', {
      items: [
        { skuId: 'sku-normal', quantity: 2, cartItemId: 'ci-normal' },
        { skuId: 'sku-prize', quantity: 1, cartItemId: 'ci-prize' },
        { skuId: 'product-gift', quantity: 1, cartItemId: 'ci-gift' },
      ],
      addressId: 'addr1',
      expectedTotal: 52.34,
    } as any);

    expect(checkoutResult.shippingFee).toBe(12.34);
    expect(createdSessionData.shippingFee).toBe(12.34);
    expect(shippingRuleService.calculateShippingDetail).toHaveBeenCalledWith(
      40,
      '110000',
      5000,
      undefined,
    );
    expect(shippingRuleService.calculateShippingFee).not.toHaveBeenCalled();

    const createdOrders: any[] = [];
    const paymentTx = buildPaymentTx(createdSessionData, createdOrders);
    prisma.$transaction = jest.fn(async (cb: any) => cb(paymentTx));
    shippingRuleService.calculateShippingDetail.mockImplementation(() => {
      throw new Error('rules changed after checkout');
    });

    await service.handlePaymentSuccess('MO-LOCK', 'TX-1', '2026-05-08T00:00:00.000Z');

    expect(shippingRuleService.calculateShippingDetail).toHaveBeenCalledTimes(1);
    expect(createdOrders.reduce((sum, order) => sum + order.shippingFee, 0)).toBe(12.34);
    expect(createdOrders.map((order) => order.shippingFee)).toEqual([12.34, 0]);
  });

  it('allocates locked shipping fee to split orders with exact cent total', async () => {
    const session = {
      id: 'sess-rounding',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'NORMAL_GOODS',
      merchantOrderNo: 'MO-ROUND',
      rewardId: null,
      discountAmount: 0,
      vipDiscountAmount: 0,
      totalCouponDiscount: 0,
      couponInstanceIds: [],
      couponPerAmounts: [],
      shippingFee: 0.02,
      expectedTotal: 3.02,
      addressSnapshot: validAddress,
      itemsSnapshot: [
        {
          skuId: 'sku-a',
          quantity: 1,
          cartItemId: 'ci-a',
          isPrize: false,
          unitPrice: 1,
          companyId: 'company-a',
          productSnapshot: { title: 'A' },
        },
        {
          skuId: 'sku-b',
          quantity: 1,
          cartItemId: 'ci-b',
          isPrize: false,
          unitPrice: 1,
          companyId: 'company-b',
          productSnapshot: { title: 'B' },
        },
        {
          skuId: 'sku-c',
          quantity: 1,
          cartItemId: 'ci-c',
          isPrize: false,
          unitPrice: 1,
          companyId: 'company-c',
          productSnapshot: { title: 'C' },
        },
      ],
    };
    const createdOrders: any[] = [];
    const tx = buildPaymentTx(session, createdOrders);
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const service = new CheckoutService(prisma, {} as any);
    const shippingRuleService = {
      calculateShippingDetail: jest.fn(),
      calculateShippingFee: jest.fn(),
    };
    service.setShippingRuleService(shippingRuleService);

    await service.handlePaymentSuccess('MO-ROUND', 'TX-ROUND', '2026-05-08T00:00:00.000Z');

    expect(shippingRuleService.calculateShippingDetail).not.toHaveBeenCalled();
    expect(shippingRuleService.calculateShippingFee).not.toHaveBeenCalled();
    expect(createdOrders.map((order) => order.shippingFee)).toEqual([0.01, 0.01, 0]);
    expect(
      Number(createdOrders.reduce((sum, order) => sum + order.shippingFee, 0).toFixed(2)),
    ).toBe(session.shippingFee);
  });

  it('does not call shipping rules when normal goods amount reaches normal free-shipping threshold', async () => {
    const { result, createdSessionData, shippingRuleService } = await runCheckoutForShippingThreshold({
      goodsAmount: 99,
      isVip: false,
      normalFreeShippingThreshold: 99,
      vipFreeShippingThreshold: 49,
    });

    expect(result.shippingFee).toBe(0);
    expect(createdSessionData.shippingFee).toBe(0);
    expect(shippingRuleService.calculateShippingDetail).not.toHaveBeenCalled();
    expect(shippingRuleService.calculateShippingFee).not.toHaveBeenCalled();
  });

  it('uses VIP free-shipping threshold before calling shipping rules', async () => {
    const { result, createdSessionData, shippingRuleService } = await runCheckoutForShippingThreshold({
      goodsAmount: 49,
      isVip: true,
      normalFreeShippingThreshold: 99,
      vipFreeShippingThreshold: 49,
    });

    expect(result.shippingFee).toBe(0);
    expect(createdSessionData.shippingFee).toBe(0);
    expect(shippingRuleService.calculateShippingDetail).not.toHaveBeenCalled();
    expect(shippingRuleService.calculateShippingFee).not.toHaveBeenCalled();
  });

  it('uses shared default SKU weight when checkout item weight is missing', async () => {
    let createdSessionData: any;
    const sku = buildSku({
      id: 'sku-missing-weight',
      productId: 'product-missing-weight',
      title: '缺失重量 SKU',
      price: 20,
      weightGram: undefined,
      product: {
        id: 'product-missing-weight',
        title: '缺失重量商品',
        status: 'ACTIVE',
        companyId: 'company-weight',
        media: [],
      },
    });
    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
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
            return { id: 'sess-weight', userId: 'user1', status: 'ACTIVE', ...data };
          }),
        },
        rewardLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      })),
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: 99,
        vipFreeShippingThreshold: 99,
        defaultShippingFee: 8,
      }),
    };
    const shippingRuleService = {
      calculateShippingDetail: jest.fn().mockResolvedValue({ fee: 8 }),
      calculateShippingFee: jest.fn(),
    };
    const service = new CheckoutService(prisma, bonusConfig);
    service.setShippingRuleService(shippingRuleService);

    await service.checkout('user1', {
      items: [{ skuId: 'sku-missing-weight', quantity: 2, cartItemId: 'ci-weight' }],
      addressId: 'addr1',
      expectedTotal: 48,
    } as any);

    expect(createdSessionData.shippingFee).toBe(8);
    expect(shippingRuleService.calculateShippingDetail).toHaveBeenCalledWith(
      40,
      '110000',
      DEFAULT_SKU_WEIGHT_GRAM * 2,
      undefined,
    );
  });
});
