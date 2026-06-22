import { BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';

function buildBundleAvailability(items: Array<{ stock: number; quantity: number }>) {
  if (items.length === 0) return 0;
  return Math.max(
    0,
    items.reduce(
      (minAvailability, item) => Math.min(minAvailability, Math.floor(item.stock / item.quantity)),
      Number.POSITIVE_INFINITY,
    ),
  );
}

function createBundleSku(options: {
  sellingStock?: number;
  componentStocks: number[];
  componentQuantities?: number[];
}) {
  const {
    sellingStock = 0,
    componentStocks,
    componentQuantities = componentStocks.map(() => 1),
  } = options;

  return {
    id: 'bundle-sku',
    title: '海鲜组合',
    stock: sellingStock,
    status: 'ACTIVE',
    maxPerOrder: null,
    price: 399,
    product: {
      id: 'bundle-product',
      title: '海鲜组合',
      type: 'BUNDLE',
      status: 'ACTIVE',
      media: [],
      bundleItems: componentStocks.map((stock, index) => ({
        skuId: `component-sku-${index + 1}`,
        quantity: componentQuantities[index] ?? 1,
        sku: {
          id: `component-sku-${index + 1}`,
          title: `组件规格 ${index + 1}`,
          price: 100 + index,
          stock,
          weightGram: 200 + index,
          product: {
            id: `component-product-${index + 1}`,
            title: `组件商品 ${index + 1}`,
            media: [{ url: `https://img/${index + 1}.png` }],
          },
        },
      })),
    },
  };
}

function createService(
  stock = 0,
  options: {
    mockGetCart?: boolean;
    transactionFailures?: any[];
    sku?: any;
    cartItem?: any;
  } = {},
) {
  const { mockGetCart = true, transactionFailures = [], sku: customSku, cartItem: customCartItem } = options;
  const sku = customSku ?? {
    id: 'sku-zero',
    title: '龙虾',
    stock,
    status: 'ACTIVE',
    maxPerOrder: null,
    price: 234,
    product: { id: 'p1', title: '龙虾', type: 'SIMPLE', status: 'ACTIVE', media: [], bundleItems: [] },
  };
  const cartItem =
    customCartItem ?? {
      id: 'ci1',
      cartId: 'cart1',
      skuId: sku.id,
      quantity: 2,
      isPrize: false,
      isSelected: true,
      sku,
    };
  const cart = { id: 'cart1', userId: 'user1' };
  const prisma: any = {
    cart: {
      findUnique: jest.fn().mockResolvedValue(cart),
      create: jest.fn().mockResolvedValue(cart),
    },
    productSKU: { findUnique: jest.fn().mockResolvedValue(sku) },
    cartItem: {
      findFirst: jest.fn().mockResolvedValue(cartItem),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([cartItem]),
    },
    lotteryRecord: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(async (cb: any) => {
      const failure = transactionFailures.shift();
      if (failure) throw failure;
      return cb(prisma);
    }),
  };
  const redisCoord = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
  };
  const bonusConfig = { getSystemConfig: jest.fn().mockResolvedValue({}) };
  const productBundleService = {
    calculateAvailability: jest.fn(buildBundleAvailability),
  };
  const service = new (CartService as any)(
    prisma,
    { get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : undefined)) } as any,
    redisCoord as any,
    bonusConfig as any,
    productBundleService as any,
  );
  if (mockGetCart) {
    jest.spyOn(service, 'getCart').mockResolvedValue({ id: 'cart1', items: [] } as any);
  }
  return { service, prisma, productBundleService };
}

describe('CartService stock availability', () => {
  it('rejects adding zero-stock normal SKU', async () => {
    const { service } = createService(0);
    await expect(service.addItem('user1', 'sku-zero', 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips zero-stock normal SKU during login cart merge', async () => {
    const { service } = createService(0);
    const merged = await (service as any).mergeNormalItem('user1', { skuId: 'sku-zero', quantity: 1 });
    expect(merged).toBe(false);
  });

  it('allows adding bundle when all component SKUs have enough stock', async () => {
    const bundleSku = createBundleSku({
      sellingStock: 0,
      componentStocks: [2, 4],
      componentQuantities: [1, 2],
    });
    const { service, prisma, productBundleService } = createService(0, {
      sku: bundleSku,
      cartItem: null,
    });
    prisma.cartItem.findFirst.mockResolvedValue(null);

    await expect(service.addItem('user1', 'bundle-sku', 2)).resolves.toEqual({
      id: 'cart1',
      items: [],
    });

    expect(productBundleService.calculateAvailability).toHaveBeenCalledWith([
      { stock: 2, quantity: 1 },
      { stock: 4, quantity: 2 },
    ]);
    expect(prisma.cartItem.create).toHaveBeenCalledWith({
      data: { cartId: 'cart1', skuId: 'bundle-sku', quantity: 2 },
    });
  });

  it('rejects adding bundle when a component SKU is out of stock', async () => {
    const bundleSku = createBundleSku({
      sellingStock: 99,
      componentStocks: [0, 10],
    });
    const { service, prisma, productBundleService } = createService(0, {
      sku: bundleSku,
      cartItem: null,
    });
    prisma.cartItem.findFirst.mockResolvedValue(null);

    await expect(service.addItem('user1', 'bundle-sku', 1)).rejects.toBeInstanceOf(BadRequestException);

    expect(productBundleService.calculateAvailability).toHaveBeenCalledWith([
      { stock: 0, quantity: 1 },
      { stock: 10, quantity: 1 },
    ]);
    expect(prisma.cartItem.create).not.toHaveBeenCalled();
  });

  it('rejects selecting zero-stock existing normal item', async () => {
    const { service } = createService(0);
    await expect(service.toggleSelect('user1', 'sku-zero', true)).rejects.toThrow('暂无库存');
  });

  it('rejects selecting bundle when component-derived availability is zero even if selling SKU stock is positive', async () => {
    const bundleSku = createBundleSku({
      sellingStock: 20,
      componentStocks: [0, 10],
    });
    const bundleCartItem = {
      id: 'ci-bundle',
      cartId: 'cart1',
      skuId: 'bundle-sku',
      quantity: 1,
      isPrize: false,
      isSelected: true,
      sku: bundleSku,
    };
    const { service, prisma, productBundleService } = createService(0, {
      sku: bundleSku,
      cartItem: bundleCartItem,
    });

    await expect(service.toggleSelect('user1', 'bundle-sku', true)).rejects.toThrow('暂无库存');

    expect(productBundleService.calculateAvailability).toHaveBeenCalledWith([
      { stock: 0, quantity: 1 },
      { stock: 10, quantity: 1 },
    ]);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-bundle' },
      data: { isSelected: false },
    });
  });

  it('rejects selecting bundle when cart quantity exceeds positive component-derived availability', async () => {
    const bundleSku = createBundleSku({
      sellingStock: 20,
      componentStocks: [1, 10],
    });
    const bundleCartItem = {
      id: 'ci-bundle',
      cartId: 'cart1',
      skuId: 'bundle-sku',
      quantity: 2,
      isPrize: false,
      isSelected: true,
      sku: bundleSku,
    };
    const { service, prisma, productBundleService } = createService(0, {
      sku: bundleSku,
      cartItem: bundleCartItem,
    });

    await expect(service.toggleSelect('user1', 'bundle-sku', true)).rejects.toThrow('暂无库存');

    expect(productBundleService.calculateAvailability).toHaveBeenCalledWith([
      { stock: 1, quantity: 1 },
      { stock: 10, quantity: 1 },
    ]);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-bundle' },
      data: { isSelected: false },
    });
  });

  it('allows reducing an existing quantity even when current stock is lower', async () => {
    const { service, prisma } = createService(1);
    await service.updateItemQuantity('user1', 'sku-zero', 1);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci1' },
      data: { quantity: 1 },
    });
  });

  it('rejects increasing bundle quantity beyond derived availability', async () => {
    const bundleSku = createBundleSku({
      sellingStock: 99,
      componentStocks: [1, 2],
      componentQuantities: [1, 2],
    });
    const bundleCartItem = {
      id: 'ci-bundle',
      cartId: 'cart1',
      skuId: 'bundle-sku',
      quantity: 1,
      isPrize: false,
      isSelected: true,
      sku: bundleSku,
    };
    const { service, prisma, productBundleService } = createService(0, {
      sku: bundleSku,
      cartItem: bundleCartItem,
    });

    await expect(service.updateItemQuantity('user1', 'bundle-sku', 2)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(productBundleService.calculateAvailability).toHaveBeenCalledWith([
      { stock: 1, quantity: 1 },
      { stock: 2, quantity: 2 },
    ]);
    expect(prisma.cartItem.update).not.toHaveBeenCalledWith({
      where: { id: 'ci-bundle' },
      data: { quantity: 2 },
    });
  });

  it('does not mark prize item out of stock only because SKU stock is zero', async () => {
    const { service, prisma } = createService(0, { mockGetCart: false });
    const prizeSku = {
      id: 'sku-zero',
      title: '龙虾',
      stock: 0,
      status: 'ACTIVE',
      maxPerOrder: null,
      price: 234,
      product: { id: 'p1', title: '龙虾', status: 'ACTIVE', media: [] },
    };
    prisma.cartItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'ci-prize',
          cartId: 'cart1',
          skuId: 'sku-zero',
          quantity: 1,
          isPrize: true,
          isSelected: true,
          isLocked: false,
          prizeRecordId: 'lr1',
          sku: prizeSku,
        },
      ]);
    prisma.lotteryRecord.findMany.mockResolvedValue([
      {
        id: 'lr1',
        status: 'IN_CART',
        prize: {
          id: 'prize1',
          type: 'THRESHOLD_GIFT',
          isActive: true,
          skuId: 'sku-zero',
          sku: prizeSku,
          product: prizeSku.product,
        },
      },
    ]);

    const cart = await service.getCart('user1');

    expect(cart.items[0].stockStatus).not.toBe('OUT_OF_STOCK');
    expect(cart.items[0].unavailableReason).toBeNull();
    expect(cart.items[0].selectable).toBe(true);
  });

  it('marks bundle cart item OUT_OF_STOCK from component stock, not selling SKU stock', async () => {
    const bundleSku = createBundleSku({
      sellingStock: 99,
      componentStocks: [0, 8],
    });
    const bundleItem = {
      id: 'ci-bundle',
      cartId: 'cart1',
      skuId: 'bundle-sku',
      quantity: 1,
      isPrize: false,
      isSelected: true,
      sku: bundleSku,
    };
    const { service, prisma, productBundleService } = createService(0, {
      mockGetCart: false,
      sku: bundleSku,
      cartItem: bundleItem,
    });
    prisma.cartItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bundleItem])
      .mockResolvedValueOnce([{ ...bundleItem, isSelected: false }]);

    const cart = await service.getCart('user1');

    expect(productBundleService.calculateAvailability).toHaveBeenCalledWith([
      { stock: 0, quantity: 1 },
      { stock: 8, quantity: 1 },
    ]);
    expect(prisma.cartItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ci-bundle'] } },
      data: { isSelected: false },
    });
    expect(cart.items[0].stockStatus).toBe('OUT_OF_STOCK');
    expect(cart.items[0].unavailableReason).toBe('OUT_OF_STOCK');
    expect(cart.items[0].selectable).toBe(false);
    expect(cart.items[0].isSelected).toBe(false);
    expect((cart.items[0].product as any).type).toBe('BUNDLE');
    expect(cart.items[0].product.stock).toBe(0);
    expect((cart.items[0].product as any).bundleItems).toEqual([
      {
        skuId: 'component-sku-1',
        quantity: 1,
        sku: {
          id: 'component-sku-1',
          title: '组件规格 1',
          price: 100,
          stock: 0,
          weightGram: 200,
          product: {
            id: 'component-product-1',
            title: '组件商品 1',
            image: 'https://img/1.png',
          },
        },
      },
      {
        skuId: 'component-sku-2',
        quantity: 1,
        sku: {
          id: 'component-sku-2',
          title: '组件规格 2',
          price: 101,
          stock: 8,
          weightGram: 201,
          product: {
            id: 'component-product-2',
            title: '组件商品 2',
            image: 'https://img/2.png',
          },
        },
      },
    ]);
  });

  it('marks bundle cart item OUT_OF_STOCK when cart quantity exceeds positive component-derived availability', async () => {
    const bundleSku = createBundleSku({
      sellingStock: 99,
      componentStocks: [1, 8],
    });
    const bundleItem = {
      id: 'ci-bundle',
      cartId: 'cart1',
      skuId: 'bundle-sku',
      quantity: 2,
      isPrize: false,
      isSelected: true,
      sku: bundleSku,
    };
    const { service, prisma, productBundleService } = createService(0, {
      mockGetCart: false,
      sku: bundleSku,
      cartItem: bundleItem,
    });
    prisma.cartItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([bundleItem])
      .mockResolvedValueOnce([{ ...bundleItem, isSelected: false }]);

    const cart = await service.getCart('user1');

    expect(productBundleService.calculateAvailability).toHaveBeenCalledWith([
      { stock: 1, quantity: 1 },
      { stock: 8, quantity: 1 },
    ]);
    expect(prisma.cartItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ci-bundle'] } },
      data: { isSelected: false },
    });
    expect(cart.items[0].stockStatus).toBe('OUT_OF_STOCK');
    expect(cart.items[0].unavailableReason).toBe('OUT_OF_STOCK');
    expect(cart.items[0].selectable).toBe(false);
    expect(cart.items[0].isSelected).toBe(false);
    expect(cart.items[0].product.stock).toBe(1);
  });

  it('retries update quantity when Serializable transaction hits P2034', async () => {
    const { service, prisma } = createService(2, {
      transactionFailures: [{ code: 'P2034' }],
    });

    await service.updateItemQuantity('user1', 'sku-zero', 1);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci1' },
      data: { quantity: 1 },
    });
  });

  it('retries selecting when Serializable transaction hits P2034', async () => {
    const { service, prisma } = createService(2, {
      transactionFailures: [{ code: 'P2034' }],
    });

    await service.toggleSelect('user1', 'sku-zero', true);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci1' },
      data: { isSelected: true },
    });
  });

  it('skips bundle during login cart merge when component-derived availability is zero', async () => {
    const bundleSku = createBundleSku({
      sellingStock: 88,
      componentStocks: [0, 3],
    });
    const { service, productBundleService } = createService(0, {
      sku: bundleSku,
      cartItem: null,
    });

    const merged = await (service as any).mergeNormalItem('user1', {
      skuId: 'bundle-sku',
      quantity: 1,
    });

    expect(merged).toBe(false);
    expect(productBundleService.calculateAvailability).toHaveBeenCalledWith([
      { stock: 0, quantity: 1 },
      { stock: 3, quantity: 1 },
    ]);
  });
});
