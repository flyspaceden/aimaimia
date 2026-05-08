import { OrderService } from './order.service';

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
});
