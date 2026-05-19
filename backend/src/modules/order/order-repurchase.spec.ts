import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderService } from './order.service';

const activeCompany = { id: 'c1', status: 'ACTIVE', isPlatform: false, name: '青禾农场' };
const inactiveCompany = { id: 'c2', status: 'SUSPENDED', isPlatform: false, name: '停业农场' };
const platformCompany = { id: 'platform', status: 'ACTIVE', isPlatform: true, name: '爱买买app' };

function makeSku(overrides: any = {}) {
  const company = overrides.company ?? activeCompany;
  return {
    id: overrides.id ?? 'sku-1',
    title: overrides.title ?? '5斤装',
    price: overrides.price ?? 30,
    stock: overrides.stock ?? 100,
    status: overrides.status ?? 'ACTIVE',
    maxPerOrder: overrides.maxPerOrder ?? null,
    product: {
      id: overrides.productId ?? 'p1',
      title: overrides.productTitle ?? '苹果',
      status: overrides.productStatus ?? 'ACTIVE',
      companyId: company.id,
      company,
      media: [{ url: 'http://img/apple.jpg' }],
    },
  };
}

function makeOrder(overrides: any = {}) {
  return {
    id: overrides.id ?? 'order-1',
    userId: overrides.userId ?? 'user-1',
    status: overrides.status ?? 'RECEIVED',
    bizType: overrides.bizType ?? 'NORMAL_GOODS',
    items: overrides.items ?? [{
      id: 'oi-1',
      skuId: 'sku-1',
      unitPrice: 25,
      quantity: 2,
      isPrize: false,
      productSnapshot: { title: '苹果' },
    }],
  };
}

function createHarness(options: {
  order?: any;
  skus?: any[];
  cartItems?: any[];
  redisCached?: string | null;
  acquireLock?: boolean | null;
  redisSet?: boolean;
  txErrorOnce?: boolean;
  txErrorCodeOnce?: 'P2034' | 'P2002';
} = {}) {
  const order = options.order ?? makeOrder();
  const skus = options.skus ?? [makeSku()];
  const cartItems = options.cartItems ?? [];
  let txCalls = 0;

  const tx = {
    cart: {
      findUnique: jest.fn(async () => ({ id: 'cart-1', userId: 'user-1' })),
      create: jest.fn(async () => ({ id: 'cart-1', userId: 'user-1' })),
    },
    cartItem: {
      findMany: jest.fn(async () => cartItems),
      update: jest.fn(async (args) => ({ id: args.where.id, ...args.data })),
      create: jest.fn(async (args) => ({ id: 'new-cart-item', ...args.data })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    productSKU: {
      findMany: jest.fn(async () => skus),
    },
  };

  const prisma: any = {
    order: {
      findUnique: jest.fn(async () => order),
    },
    productSKU: {
      findMany: jest.fn(async () => skus),
    },
    cart: {
      findUnique: jest.fn(async () => ({ id: 'cart-1', userId: 'user-1' })),
    },
    cartItem: {
      findMany: jest.fn(async () => cartItems),
    },
    $transaction: jest.fn(async (callback: any) => {
      txCalls += 1;
      if ((options.txErrorOnce || options.txErrorCodeOnce) && txCalls === 1) {
        const err: any = new Prisma.PrismaClientKnownRequestError('serialization failure', {
          code: options.txErrorCodeOnce ?? 'P2034',
          clientVersion: 'test',
        });
        throw err;
      }
      return callback(tx);
    }),
  };

  const redis: any = {
    get: jest.fn(async (key: string) => key.includes(':result:') ? (options.redisCached ?? null) : null),
    acquireLock: jest.fn(async () => options.acquireLock === undefined ? true : options.acquireLock),
    set: jest.fn(async () => options.redisSet ?? true),
    releaseLock: jest.fn(async () => true),
  };

  const cartService: any = {
    getCart: jest.fn(async () => ({
      id: 'cart-1',
      items: [{
        id: 'ci-1',
        skuId: 'sku-1',
        quantity: 2,
        isSelected: true,
        product: {
          id: 'p1',
          title: '苹果',
          image: 'http://img/apple.jpg',
          price: 30,
          originalPrice: null,
          stock: 100,
          maxPerOrder: null,
        },
      }],
    })),
  };

  const service = new OrderService(prisma, {} as any, {} as any, redis, cartService);
  return { service, prisma, redis, cartService, tx };
}

describe('OrderService.repurchase', () => {
  it('throws 404 when order does not belong to user', async () => {
    const { service } = createHarness({ order: makeOrder({ userId: 'other-user' }) });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects non-RECEIVED orders', async () => {
    const { service } = createHarness({ order: makeOrder({ status: 'PAID' }) });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-NORMAL_GOODS orders by whitelist', async () => {
    const { service } = createHarness({ order: makeOrder({ bizType: 'VIP_PACKAGE' }) });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds valid normal items and returns price change metadata', async () => {
    const { service, prisma, tx } = createHarness({
      order: makeOrder({ items: [{ id: 'oi-1', skuId: 'sku-1', unitPrice: 25, quantity: 2, isPrize: false, productSnapshot: { title: '苹果' } }] }),
      skus: [makeSku({ price: 30 })],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedItemCount).toBe(1);
    expect(result.addedQuantity).toBe(2);
    expect(result.priceChangedCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      status: 'ADDED',
      priceChanged: true,
      originalPrice: 25,
      currentPrice: 30,
    });
    expect(tx.cartItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ skuId: 'sku-1', quantity: 2, isSelected: true }),
    }));
    expect(tx.productSKU.findMany).toHaveBeenCalled();
    expect(prisma.productSKU.findMany).not.toHaveBeenCalled();
  });

  it('skips prize, inactive company, platform product, inactive product, inactive sku, missing sku, and maxPerOrder overflow', async () => {
    const order = makeOrder({
      items: [
        { id: 'oi-prize', skuId: 'sku-prize', unitPrice: 0, quantity: 1, isPrize: true, productSnapshot: { title: '奖品' } },
        { id: 'oi-company', skuId: 'sku-company', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '停业商品' } },
        { id: 'oi-platform', skuId: 'sku-platform', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '平台商品' } },
        { id: 'oi-product', skuId: 'sku-product', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '商品下架' } },
        { id: 'oi-sku', skuId: 'sku-sku', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '规格下架' } },
        { id: 'oi-missing', skuId: 'sku-missing', unitPrice: 10, quantity: 1, isPrize: false, productSnapshot: { title: '缺失规格' } },
        { id: 'oi-limit', skuId: 'sku-limit', unitPrice: 10, quantity: 2, isPrize: false, productSnapshot: { title: '限购商品' } },
      ],
    });
    const { service } = createHarness({
      order,
      skus: [
        makeSku({ id: 'sku-company', company: inactiveCompany }),
        makeSku({ id: 'sku-platform', company: platformCompany }),
        makeSku({ id: 'sku-product', productStatus: 'INACTIVE' }),
        makeSku({ id: 'sku-sku', status: 'INACTIVE' }),
        makeSku({ id: 'sku-limit', maxPerOrder: 3 }),
      ],
      cartItems: [{ id: 'ci-limit', skuId: 'sku-limit', quantity: 2, isPrize: false }],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedItemCount).toBe(0);
    expect(result.skippedItemCount).toBe(7);
    expect(result.items.map((item: any) => item.reason)).toEqual([
      'PRIZE_ITEM',
      'COMPANY_INACTIVE',
      'PLATFORM_PRODUCT',
      'PRODUCT_INACTIVE',
      'SKU_INACTIVE',
      'SKU_MISSING',
      'MAX_PER_ORDER_EXCEEDED',
    ]);
  });

  it('updates existing cart item quantity and forces isSelected=true', async () => {
    const { service, tx } = createHarness({
      cartItems: [{ id: 'ci-1', skuId: 'sku-1', quantity: 1, isPrize: false, isSelected: false }],
    });

    await service.repurchase('order-1', 'user-1');

    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: { quantity: 3, isSelected: true },
    });
  });

  it('consolidates duplicate normal cart rows for the same SKU before adding quantity', async () => {
    const { service, tx } = createHarness({
      skus: [makeSku({ maxPerOrder: 5 })],
      cartItems: [
        { id: 'ci-1', skuId: 'sku-1', quantity: 1, isPrize: false, isSelected: false },
        { id: 'ci-2', skuId: 'sku-1', quantity: 1, isPrize: false, isSelected: true },
      ],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(2);
    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: { quantity: 4, isSelected: true },
    });
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['ci-2'] } },
    });
  });

  it('uses total duplicate cart quantity when enforcing maxPerOrder', async () => {
    const { service, tx } = createHarness({
      skus: [makeSku({ maxPerOrder: 4 })],
      cartItems: [
        { id: 'ci-1', skuId: 'sku-1', quantity: 2, isPrize: false, isSelected: false },
        { id: 'ci-2', skuId: 'sku-1', quantity: 1, isPrize: false, isSelected: true },
      ],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(0);
    expect(result.skippedQuantity).toBe(2);
    expect(result.items[0].reason).toBe('MAX_PER_ORDER_EXCEEDED');
    expect(tx.cartItem.update).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('aggregates repeated order items with the same SKU into one cart write', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({
        items: [
          { id: 'oi-1', skuId: 'sku-1', unitPrice: 25, quantity: 2, isPrize: false, productSnapshot: { title: '苹果' } },
          { id: 'oi-2', skuId: 'sku-1', unitPrice: 25, quantity: 3, isPrize: false, productSnapshot: { title: '苹果' } },
        ],
      }),
      skus: [makeSku({ id: 'sku-1', price: 25 })],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedItemCount).toBe(2);
    expect(result.addedQuantity).toBe(5);
    expect(tx.cartItem.create).toHaveBeenCalledTimes(1);
    expect(tx.cartItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ skuId: 'sku-1', quantity: 5, isSelected: true }),
    }));
  });

  it('degrades low-stock repurchase to quantity 1 and overwrites existing cart row', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({ items: [{ id: 'oi-1', skuId: 'sku-1', unitPrice: 234, quantity: 3, isPrize: false, productSnapshot: { title: '龙虾' } }] }),
      skus: [makeSku({ id: 'sku-1', stock: 1, price: 234 })],
      cartItems: [{ id: 'ci-1', skuId: 'sku-1', quantity: 3, isPrize: false, isSelected: true }],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(1);
    expect(result.items[0]).toMatchObject({
      status: 'ADDED',
      reason: 'LOW_STOCK_ADJUSTED',
      stockStatus: 'LOW_STOCK',
      stock: 1,
      adjustedQuantity: 1,
    });
    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci-1' },
      data: { quantity: 1, isSelected: true },
    });
  });

  it('counts repeated low-stock order rows as one adjusted cart quantity', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({
        items: [
          { id: 'oi-1', skuId: 'sku-1', unitPrice: 234, quantity: 2, isPrize: false, productSnapshot: { title: '龙虾' } },
          { id: 'oi-2', skuId: 'sku-1', unitPrice: 234, quantity: 3, isPrize: false, productSnapshot: { title: '龙虾' } },
        ],
      }),
      skus: [makeSku({ id: 'sku-1', stock: 1, price: 234 })],
      cartItems: [],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(1);
    expect(result.items.filter((item: any) => item.reason === 'LOW_STOCK_ADJUSTED')).toHaveLength(2);
    expect(tx.cartItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ skuId: 'sku-1', quantity: 1, isSelected: true }),
    }));
  });

  it('returns virtual result and does not create cart row when stock is zero', async () => {
    const { service, tx } = createHarness({
      order: makeOrder({ items: [{ id: 'oi-1', skuId: 'sku-1', unitPrice: 234, quantity: 3, isPrize: false, productSnapshot: { title: '龙虾' } }] }),
      skus: [makeSku({ id: 'sku-1', stock: 0, price: 234 })],
      cartItems: [],
    });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(0);
    expect(result.skippedQuantity).toBe(3);
    expect(result.items[0]).toMatchObject({
      status: 'SKIPPED',
      reason: 'OUT_OF_STOCK_VIRTUAL',
      stockStatus: 'OUT_OF_STOCK',
      stock: 0,
      virtual: true,
    });
    expect(tx.cartItem.create).not.toHaveBeenCalled();
  });

  it('returns cached result for duplicate requests but refreshes cart from CartService', async () => {
    const cached = JSON.stringify({
      addedItemCount: 1,
      addedQuantity: 2,
      skippedItemCount: 0,
      skippedQuantity: 0,
      priceChangedCount: 0,
      cart: { id: 'cart-1', items: [{ id: 'stale-item' }] },
      items: [],
    });
    const { service, prisma, cartService } = createHarness({ redisCached: cached });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(2);
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    // cart 必须来自 cartService.getCart，不是缓存里的 stale 快照
    expect(cartService.getCart).toHaveBeenCalledWith('user-1');
    expect(result.cart).toMatchObject({ id: 'cart-1' });
    expect((result.cart as any).items[0].id).not.toBe('stale-item');
  });

  it('returns 409 when Redis is unavailable (acquireLock returns null)', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const { service, prisma } = createHarness({ acquireLock: null });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it('does not cache validation failures and releases the processing lock', async () => {
    const { service, redis } = createHarness({ order: makeOrder({ status: 'PAID' }) });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledWith(
      'order:repurchase:lock:user-1:order-1',
      'repurchase:user-1:order-1',
    );
  });

  it('keeps the lock and returns 409 when result cache write fails after cart mutation', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const { service, redis, tx } = createHarness({ redisSet: false });

    await expect(service.repurchase('order-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);

    expect(tx.cartItem.create).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  it('retries once after Prisma P2034 serialization conflict', async () => {
    const { service, prisma } = createHarness({ txErrorOnce: true });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('retries once after Prisma P2002 cart creation race', async () => {
    const { service, prisma } = createHarness({ txErrorCodeOnce: 'P2002' });

    const result = await service.repurchase('order-1', 'user-1');

    expect(result.addedQuantity).toBe(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
