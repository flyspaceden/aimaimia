import { CheckoutService } from './checkout.service';

function validAddress() {
  return {
    id: 'a1',
    userId: 'user1',
    regionText: '北京市/北京市/朝阳区',
    regionCode: 'CN-BJ-CY',
    recipientName: '张三',
    phone: '13800000000',
    detail: '街道一号',
  };
}

function createService(stock: number, cartItems: any[] = [
  { id: 'ci1', cartId: 'cart1', skuId: 'sku-1', quantity: 3, isPrize: false },
]) {
  const sku = {
    id: 'sku-1',
    productId: 'p1',
    title: '龙虾',
    price: 234,
    cost: 100,
    stock,
    status: 'ACTIVE',
    maxPerOrder: null,
    weightGram: 1000,
    product: { id: 'p1', companyId: 'c1', title: '龙虾', status: 'ACTIVE', media: [] },
  };
  const prisma: any = {
    $transaction: jest.fn().mockRejectedValue(new Error('checkout session transaction should not run')),
    checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) },
    productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
    cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
    cartItem: { findMany: jest.fn().mockResolvedValue(cartItems) },
    address: { findUnique: jest.fn().mockResolvedValue(validAddress()) },
    vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
    rewardLedger: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    company: { findMany: jest.fn().mockResolvedValue([]) },
    lotteryRecord: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const bonusConfig: any = {
    getSystemConfig: jest.fn().mockResolvedValue({
      normalFreeShippingThreshold: 0,
      vipFreeShippingThreshold: 0,
      defaultShippingFee: 0,
    }),
  };
  return {
    service: new CheckoutService(prisma, bonusConfig),
    prisma,
  };
}

describe('CheckoutService stock availability', () => {
  it('rejects known zero-stock normal item before creating checkout session', async () => {
    const { service, prisma } = createService(0);
    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 1, cartItemId: 'ci1' }],
      addressId: 'a1',
    } as any)).rejects.toThrow('商品「龙虾」暂无库存，请从购物车移除后再结算');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects normal item quantity greater than current known stock', async () => {
    const { service, prisma } = createService(1);
    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 3, cartItemId: 'ci1' }],
      addressId: 'a1',
    } as any)).rejects.toThrow('商品「龙虾」当前仅剩 1 件，请调整数量');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps a normal cart item as normal when an unrelated prize row has the same SKU', async () => {
    const { service, prisma } = createService(0, [
      { id: 'ci-normal', cartId: 'cart1', skuId: 'sku-1', quantity: 3, isPrize: false },
      {
        id: 'ci-prize',
        cartId: 'cart1',
        skuId: 'sku-1',
        quantity: 1,
        isPrize: true,
        prizeRecordId: 'lr-prize',
        expiresAt: null,
      },
    ]);

    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 1, cartItemId: 'ci-normal' }],
      addressId: 'a1',
    } as any)).rejects.toThrow('商品「龙虾」暂无库存，请从购物车移除后再结算');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects overstock normal cart item even when an unrelated prize row has the same SKU', async () => {
    const { service, prisma } = createService(1, [
      { id: 'ci-normal', cartId: 'cart1', skuId: 'sku-1', quantity: 3, isPrize: false },
      {
        id: 'ci-prize',
        cartId: 'cart1',
        skuId: 'sku-1',
        quantity: 1,
        isPrize: true,
        prizeRecordId: 'lr-prize',
        expiresAt: null,
      },
    ]);

    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 3, cartItemId: 'ci-normal' }],
      addressId: 'a1',
    } as any)).rejects.toThrow('商品「龙虾」当前仅剩 1 件，请调整数量');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a soft-deleted address before creating checkout session', async () => {
    const { service, prisma } = createService(10);
    prisma.address.findUnique.mockImplementation(async (args: any) => (
      args.where.deletedAt === null
        ? null
        : { ...validAddress(), deletedAt: new Date('2026-06-04T12:00:00.000Z') }
    ));

    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 1, cartItemId: 'ci1' }],
      addressId: 'a1',
    } as any)).rejects.toThrow('请选择有效的收货地址');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
