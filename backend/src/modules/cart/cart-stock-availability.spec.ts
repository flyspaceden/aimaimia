import { BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';

function createService(stock = 0, options: { mockGetCart?: boolean; transactionFailures?: any[] } = {}) {
  const { mockGetCart = true, transactionFailures = [] } = options;
  const sku = {
    id: 'sku-zero',
    title: '龙虾',
    stock,
    status: 'ACTIVE',
    maxPerOrder: null,
    price: 234,
    product: { id: 'p1', title: '龙虾', status: 'ACTIVE', media: [] },
  };
  const cart = { id: 'cart1', userId: 'user1' };
  const prisma: any = {
    cart: {
      findUnique: jest.fn().mockResolvedValue(cart),
      create: jest.fn().mockResolvedValue(cart),
    },
    productSKU: { findUnique: jest.fn().mockResolvedValue(sku) },
    cartItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ci1', cartId: 'cart1', skuId: 'sku-zero', quantity: 2, isPrize: false, sku }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ id: 'ci1', cartId: 'cart1', skuId: 'sku-zero', quantity: 2, isPrize: false, isSelected: true, sku }]),
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
  const service = new CartService(prisma, { get: jest.fn() } as any, redisCoord as any, bonusConfig as any);
  if (mockGetCart) {
    jest.spyOn(service, 'getCart').mockResolvedValue({ id: 'cart1', items: [] } as any);
  }
  return { service, prisma };
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

  it('rejects selecting zero-stock existing normal item', async () => {
    const { service } = createService(0);
    await expect(service.toggleSelect('user1', 'sku-zero', true)).rejects.toThrow('暂无库存');
  });

  it('allows reducing an existing quantity even when current stock is lower', async () => {
    const { service, prisma } = createService(1);
    await service.updateItemQuantity('user1', 'sku-zero', 1);
    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 'ci1' },
      data: { quantity: 1 },
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
});
