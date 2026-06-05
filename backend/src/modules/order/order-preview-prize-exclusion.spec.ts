import { OrderService } from './order.service';
import { DEFAULT_SKU_WEIGHT_GRAM } from '../../common/constants/shipping.constants';

describe('OrderService.previewOrder prize exclusion', () => {
  function createService() {
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
        company: { name: '爱买买app' },
        media: [],
      },
    };
    const activeOrdinarySku = {
      id: 'sku-normal',
      productId: 'product-normal',
      title: '普通 SKU',
      price: 18,
      stock: 10,
      status: 'ACTIVE',
      maxPerOrder: null,
      weightGram: 0,
      product: {
        id: 'product-normal',
        title: '普通商品',
        status: 'ACTIVE',
        companyId: 'merchant-company',
        company: { name: '普通商户' },
        media: [],
      },
    };

    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([inactivePrizeSku, activeOrdinarySku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ci-prize',
            cartId: 'cart1',
            skuId: 'sku-prize',
            quantity: 1,
            isPrize: true,
            prizeRecordId: 'lr1',
            expiresAt: null,
          },
        ]),
      },
      lotteryRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lr1',
          status: 'IN_CART',
          meta: { prizeType: 'THRESHOLD_GIFT', prizePrice: 0, threshold: 0 },
        }),
      },
      address: { findUnique: jest.fn().mockResolvedValue({ userId: 'user1', regionCode: '110000' }) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: 0,
        vipFreeShippingThreshold: 0,
        defaultShippingFee: 0,
      }),
    };

    return {
      service: new OrderService(prisma, {} as any, bonusConfig, {} as any, {} as any),
      prisma,
    };
  }

  function createStockPreviewService(stock: number) {
    const sku = {
      id: 'sku-stock',
      productId: 'product-stock',
      title: '龙虾 SKU',
      price: 234,
      stock,
      status: 'ACTIVE',
      maxPerOrder: null,
      weightGram: 1000,
      product: {
        id: 'product-stock',
        title: '龙虾',
        status: 'ACTIVE',
        companyId: 'merchant-company',
        company: { name: '普通商户' },
        media: [],
      },
    };
    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ci-prize',
            cartId: 'cart1',
            skuId: 'sku-stock',
            quantity: 1,
            isPrize: true,
            prizeRecordId: 'lr-prize',
            expiresAt: null,
          },
        ]),
      },
      lotteryRecord: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'lr-prize',
          status: 'IN_CART',
          meta: { prizeType: 'THRESHOLD_GIFT', prizePrice: 0, threshold: 0 },
        }),
      },
      address: { findUnique: jest.fn().mockResolvedValue({ userId: 'user1', regionCode: '110000' }) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: 0,
        vipFreeShippingThreshold: 0,
        defaultShippingFee: 0,
      }),
    };
    return new OrderService(prisma, {} as any, bonusConfig, {} as any, {} as any);
  }

  it('does not throw for inactive prize SKU and returns it in excludedItems', async () => {
    const { service } = createService();

    const result = await service.previewOrder('user1', {
      items: [{ skuId: 'sku-prize', quantity: 1, cartItemId: 'ci-prize' }],
      addressId: 'addr1',
    } as any);

    expect(result.groups).toEqual([]);
    expect(result.summary.totalPayable).toBe(0);
    expect((result as any).excludedItems).toEqual([
      expect.objectContaining({
        cartItemId: 'ci-prize',
        skuId: 'sku-prize',
        reason: '商品规格已下架',
      }),
    ]);
  });

  it('rejects a cartItemId whose prize SKU does not match the requested SKU', async () => {
    const { service } = createService();

    await expect(
      service.previewOrder('user1', {
        items: [{ skuId: 'sku-normal', quantity: 1, cartItemId: 'ci-prize' }],
        addressId: 'addr1',
      } as any),
    ).rejects.toThrow('购物车项与商品规格不匹配');
  });

  it('excludes zero-stock normal SKU from preview instead of pricing it', async () => {
    const zeroStockSku = {
      id: 'sku-zero',
      productId: 'product-zero',
      title: '龙虾 SKU',
      price: 234,
      stock: 0,
      status: 'ACTIVE',
      maxPerOrder: null,
      weightGram: 1000,
      product: {
        id: 'product-zero',
        title: '龙虾',
        status: 'ACTIVE',
        companyId: 'merchant-company',
        company: { name: '普通商户' },
        media: [],
      },
    };
    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([zeroStockSku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: { findUnique: jest.fn().mockResolvedValue({ userId: 'user1', regionCode: '110000' }) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const bonusConfig: any = { getSystemConfig: jest.fn().mockResolvedValue({ normalFreeShippingThreshold: 0, vipFreeShippingThreshold: 0, defaultShippingFee: 0 }) };
    const service = new OrderService(prisma, {} as any, bonusConfig, {} as any, {} as any);

    const result = await service.previewOrder('user1', {
      items: [{ skuId: 'sku-zero', quantity: 1, cartItemId: 'ci-zero' }],
      addressId: 'addr1',
    } as any);

    expect(result.groups).toEqual([]);
    expect((result as any).excludedItems).toEqual([
      expect.objectContaining({ skuId: 'sku-zero', reason: '商品暂无库存', isPrize: false }),
    ]);
  });

  it('keeps a normal cart item as normal when same-SKU prize row exists in preview', async () => {
    const service = createStockPreviewService(0);

    const result = await service.previewOrder('user1', {
      items: [{ skuId: 'sku-stock', quantity: 1, cartItemId: 'ci-normal' }],
      addressId: 'addr1',
    } as any);

    expect(result.groups).toEqual([]);
    expect((result as any).excludedItems).toEqual([
      expect.objectContaining({
        cartItemId: 'ci-normal',
        skuId: 'sku-stock',
        reason: '商品暂无库存',
        isPrize: false,
      }),
    ]);
  });

  it('excludes overstock normal item from preview when same-SKU prize row exists', async () => {
    const service = createStockPreviewService(1);

    const result = await service.previewOrder('user1', {
      items: [{ skuId: 'sku-stock', quantity: 3, cartItemId: 'ci-normal' }],
      addressId: 'addr1',
    } as any);

    expect(result.groups).toEqual([]);
    expect((result as any).excludedItems).toEqual([
      expect.objectContaining({
        cartItemId: 'ci-normal',
        skuId: 'sku-stock',
        reason: '商品当前仅剩 1 件',
        isPrize: false,
      }),
    ]);
  });
});

describe('OrderService.previewOrder shipping weight', () => {
  it('uses the real fallback SKU id and shared default weight when preview input still carries productId', async () => {
    const fallbackSku = {
      id: 'sku-real',
      productId: 'product-legacy',
      title: '新版 SKU',
      price: 20,
      stock: 10,
      status: 'ACTIVE',
      maxPerOrder: null,
      weightGram: undefined,
      product: {
        id: 'product-legacy',
        title: '普通商品',
        status: 'ACTIVE',
        companyId: 'merchant-company',
        company: { name: '普通商户' },
        media: [],
      },
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
    };
    const prisma: any = {
      productSKU: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([fallbackSku]),
      },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: { findUnique: jest.fn().mockResolvedValue({ userId: 'user1', regionCode: '110000' }) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: 99,
        vipFreeShippingThreshold: 99,
        defaultShippingFee: 8,
      }),
    };
    const shippingRuleService = {
      calculateShippingFee: jest.fn().mockResolvedValue(8),
    };
    const service = new OrderService(prisma, {} as any, bonusConfig, {} as any, {} as any);
    service.setShippingRuleService(shippingRuleService);

    await service.previewOrder('user1', {
      items: [{ skuId: 'product-legacy', quantity: 2 }],
      addressId: 'addr1',
    } as any);

    expect(shippingRuleService.calculateShippingFee).toHaveBeenCalledWith(
      40,
      '110000',
      DEFAULT_SKU_WEIGHT_GRAM * 2,
      undefined,
    );
  });

  it('rejects a soft-deleted address when addressId is explicitly provided', async () => {
    const sku = {
      id: 'sku-real',
      productId: 'product-1',
      title: '普通 SKU',
      price: 20,
      stock: 10,
      status: 'ACTIVE',
      maxPerOrder: null,
      weightGram: undefined,
      product: {
        id: 'product-1',
        title: '普通商品',
        status: 'ACTIVE',
        companyId: 'merchant-company',
        company: { name: '普通商户' },
        media: [],
      },
    };
    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: {
        findUnique: jest.fn(async (args: any) => (
          args.where.deletedAt === null
            ? null
            : {
                userId: 'user1',
                regionCode: '110000',
                deletedAt: new Date('2026-06-04T12:00:00.000Z'),
              }
        )),
      },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: 99,
        vipFreeShippingThreshold: 99,
        defaultShippingFee: 8,
      }),
    };
    const shippingRuleService = {
      calculateShippingFee: jest.fn().mockResolvedValue(8),
    };
    const service = new OrderService(prisma, {} as any, bonusConfig, {} as any, {} as any);
    service.setShippingRuleService(shippingRuleService);

    await expect(service.previewOrder('user1', {
      items: [{ skuId: 'sku-real', quantity: 2 }],
      addressId: 'addr1',
    } as any)).rejects.toThrow('请选择有效的收货地址');
    expect(shippingRuleService.calculateShippingFee).not.toHaveBeenCalled();
  });
});
