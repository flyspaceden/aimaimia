import { BadRequestException } from '@nestjs/common';
import { CartService } from './cart.service';

function createService(stock = 0) {
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
      findFirst: jest.fn().mockResolvedValue({ id: 'ci1', cartId: 'cart1', skuId: 'sku-zero', quantity: 2, isPrize: false }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ id: 'ci1', cartId: 'cart1', skuId: 'sku-zero', quantity: 2, isPrize: false, isSelected: true, sku }]),
    },
    lotteryRecord: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
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
  jest.spyOn(service, 'getCart').mockResolvedValue({ id: 'cart1', items: [] } as any);
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
});
