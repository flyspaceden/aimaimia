import { BadRequestException } from '@nestjs/common';
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

function createService(stock: number) {
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
    checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) },
    productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
    cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1', userId: 'user1' }) },
    cartItem: { findMany: jest.fn().mockResolvedValue([{ id: 'ci1', cartId: 'cart1', skuId: 'sku-1', quantity: 3, isPrize: false }]) },
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
  return new CheckoutService(prisma, bonusConfig);
}

describe('CheckoutService stock availability', () => {
  it('rejects known zero-stock normal item before creating checkout session', async () => {
    const service = createService(0);
    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 1, cartItemId: 'ci1' }],
      addressId: 'a1',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects normal item quantity greater than current known stock', async () => {
    const service = createService(1);
    await expect(service.checkout('user1', {
      items: [{ skuId: 'sku-1', quantity: 3, cartItemId: 'ci1' }],
      addressId: 'a1',
    } as any)).rejects.toThrow('仅剩 1 件');
  });
});
