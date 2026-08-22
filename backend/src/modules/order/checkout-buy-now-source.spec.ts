import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

describe('CheckoutService BUY_NOW source isolation', () => {
  const address = {
    id: 'addr-1',
    userId: 'user-1',
    regionText: '北京市/北京市/朝阳区',
    regionCode: '110000',
    recipientName: '张三',
    phone: '13800000000',
    detail: '街道一号',
  };
  const sku = {
    id: 'sku-1',
    productId: 'product-1',
    title: '标准规格',
    price: 50,
    stock: 5,
    status: 'ACTIVE',
    maxPerOrder: 4,
    weightGram: 0,
    product: {
      id: 'product-1',
      title: '普通商品',
      type: 'NORMAL',
      status: 'ACTIVE',
      companyId: 'company-1',
      media: [],
      bundleItems: [],
    },
  };

  function createHarness() {
    let created: any;
    const cartItems = [
      {
        id: 'prize-cart-item',
        cartId: 'cart-1',
        skuId: 'sku-1',
        quantity: 1,
        isPrize: true,
        prizeRecordId: 'lottery-1',
        expiresAt: null,
      },
      {
        id: 'normal-cart-item',
        cartId: 'cart-1',
        skuId: 'sku-1',
        quantity: 2,
        isPrize: false,
        prizeRecordId: null,
        expiresAt: null,
      },
    ];
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{
        status: 'ACTIVE',
        deletionExecutedAt: null,
      }]),
      checkoutSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => (created = {
          id: 'session-1',
          userId: 'user-1',
          status: 'ACTIVE',
          bizType: 'NORMAL_GOODS',
          ...data,
        })),
      },
      rewardLedger: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const prisma: any = {
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart-1' }) },
      cartItem: { findMany: jest.fn().mockResolvedValue(cartItems) },
      lotteryRecord: { findUnique: jest.fn() },
      address: { findUnique: jest.fn().mockResolvedValue(address) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findUnique: jest.fn().mockResolvedValue(null) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      checkoutSession: {
        findFirst: jest.fn(async (args: any) => args?.where?.id ? created : null),
      },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const bonusConfig: any = {
      getSystemConfig: jest.fn().mockResolvedValue({
        normalFreeShippingThreshold: 0,
        vipFreeShippingThreshold: 0,
        defaultShippingFee: 0,
      }),
    };
    const service = new CheckoutService(prisma, bonusConfig);
    service.setPaymentOperationCoordinator({
      acquireLock: jest.fn().mockResolvedValue(true),
      renewLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    } as any);
    (service as any).createFencedPaymentParams = jest.fn(async () => ({
      session: created,
      paymentParams: { channel: 'test' },
    }));
    return { service, prisma, tx, getCreated: () => created };
  }

  it('does not reinterpret BUY_NOW as a same-SKU prize or link the normal cart item', async () => {
    const { service, prisma, getCreated } = createHarness();
    await service.checkout('user-1', {
      checkoutSource: 'BUY_NOW',
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'addr-1',
      expectedTotal: 50,
      paymentChannel: 'wechat',
    } as any);

    expect(prisma.cart.findUnique).not.toHaveBeenCalled();
    expect(prisma.cartItem.findMany).not.toHaveBeenCalled();
    expect(prisma.lotteryRecord.findUnique).not.toHaveBeenCalled();
    expect(getCreated().itemsSnapshot).toEqual([
      expect.objectContaining({
        skuId: 'sku-1',
        quantity: 1,
        isPrize: false,
        unitPrice: 50,
        cartItemId: undefined,
      }),
    ]);
    expect(getCreated().bizMeta).toMatchObject({ checkoutSource: 'BUY_NOW' });
  });

  it('requires exactly one item and forbids cartItemId for BUY_NOW', async () => {
    const { service } = createHarness();
    await expect(service.checkout('user-1', {
      checkoutSource: 'BUY_NOW',
      items: [
        { skuId: 'sku-1', quantity: 1 },
        { skuId: 'sku-2', quantity: 1 },
      ],
      addressId: 'addr-1',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.checkout('user-1', {
      checkoutSource: 'BUY_NOW',
      items: [{ skuId: 'sku-1', quantity: 1, cartItemId: 'normal-cart-item' }],
      addressId: 'addr-1',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects split ordinary SKU rows that would bypass aggregate stock and maxPerOrder', async () => {
    const { service, tx } = createHarness();
    await expect(service.checkout('user-1', {
      checkoutSource: 'CART',
      items: [
        { skuId: 'sku-1', quantity: 3 },
        { skuId: 'sku-1', quantity: 3 },
      ],
      addressId: 'addr-1',
      paymentChannel: 'wechat',
    } as any)).rejects.toThrow('同一商品规格不能拆分为多行结算');
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });
});
