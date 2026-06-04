import { ServiceUnavailableException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

const PLATFORM_COMPANY_ID = 'PLATFORM_COMPANY';

function makeWechatPayService(overrides: Partial<Record<'isAvailable' | 'createAppOrder', jest.Mock>> = {}) {
  return {
    isAvailable: jest.fn().mockReturnValue(true),
    createAppOrder: jest.fn().mockResolvedValue({ prepayId: 'wx-prepay', nonceStr: 'nonce' }),
    ...overrides,
  };
}

function makeBonusConfig() {
  return {
    getSystemConfig: jest.fn().mockResolvedValue({
      vipFreeShippingThreshold: 0,
      normalFreeShippingThreshold: 0,
      defaultShippingFee: 0,
    }),
  };
}

describe('CheckoutService WECHAT_PAY payment params', () => {
  it('creates WECHAT_PAY APP params for normal checkout sessions', async () => {
    const sku = {
      id: 'sku-1',
      productId: 'product-1',
      title: '5斤装',
      price: 88,
      cost: 50,
      stock: 10,
      status: 'ACTIVE',
      maxPerOrder: null,
      weightGram: 0,
      product: {
        id: 'product-1',
        companyId: 'company-1',
        title: '苹果',
        status: 'ACTIVE',
        auditStatus: 'APPROVED',
        bizType: 'NORMAL_GOODS',
        shippingTemplateId: null,
        returnPolicy: 'INHERIT',
        media: [],
      },
    };
    const address = {
      id: 'address-1',
      userId: 'user-1',
      regionText: '北京市/北京市/朝阳区',
      regionCode: 'CN-BJ-CY',
      recipientName: '张三',
      phone: '13800000000',
      detail: '街道一号',
    };
    let createdSession: any;
    const prisma: any = {
      checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) },
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue(null) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: { findUnique: jest.fn().mockResolvedValue(address) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      couponInstance: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      lotteryRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb({
        checkoutSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(async ({ data }: any) => {
            createdSession = { id: 'session-1', ...data };
            return createdSession;
          }),
        },
      })),
    };
    const wechatPayService = makeWechatPayService();
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    (service as any).setWechatPayService(wechatPayService);

    const result = await service.checkout('user-1', {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
      paymentChannel: 'wechat',
    } as any);

    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: createdSession.merchantOrderNo,
      amount: 88,
      description: `爱买买订单-${createdSession.merchantOrderNo}`,
    });
    expect(result.paymentParams).toEqual({ channel: 'wechat', prepayId: 'wx-prepay', nonceStr: 'nonce' });
  });

  it('creates WECHAT_PAY APP params for VIP checkout sessions', async () => {
    const giftOption = {
      id: 'gift-1',
      packageId: 'pkg-1',
      status: 'ACTIVE',
      title: '尊享礼包',
      coverMode: 'GRID',
      coverUrl: null,
      badge: null,
      items: [{
        quantity: 1,
        sortOrder: 0,
        sku: {
          id: 'sku-gift',
          title: '赠品规格',
          price: 99,
          stock: 10,
          status: 'ACTIVE',
          product: {
            id: 'product-gift',
            title: '赠品',
            companyId: PLATFORM_COMPANY_ID,
            status: 'ACTIVE',
            media: [],
          },
        },
      }],
    };
    const prisma: any = {
      vipPackage: { findUnique: jest.fn().mockResolvedValue({ id: 'pkg-1', status: 'ACTIVE', price: 399, referralBonusRate: 0.1 }) },
      checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) },
      vipGiftOption: { findUnique: jest.fn().mockResolvedValue(giftOption) },
      address: { findUnique: jest.fn().mockResolvedValue({
        id: 'address-1',
        userId: 'user-1',
        regionText: '北京市/北京市/朝阳区',
        regionCode: 'CN-BJ-CY',
        recipientName: '张三',
        phone: '13800000000',
        detail: '街道一号',
      }) },
      $transaction: jest.fn(async (cb: any) => cb({
        checkoutSession: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn(async ({ data }: any) => ({ id: 'vip-session-1', ...data })),
          update: jest.fn().mockResolvedValue({}),
        },
        memberProfile: { findUnique: jest.fn().mockResolvedValue(null) },
        productSKU: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        inventoryLedger: { create: jest.fn().mockResolvedValue({}) },
      })),
    };
    const wechatPayService = makeWechatPayService();
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    (service as any).setWechatPayService(wechatPayService);

    const result = await service.checkoutVipPackage('user-1', {
      packageId: 'pkg-1',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      paymentChannel: 'wechat',
    } as any);

    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: result.merchantOrderNo,
      amount: 399,
      description: '爱买买VIP礼包-尊享礼包',
    });
    expect(result.paymentParams).toEqual({ channel: 'wechat', prepayId: 'wx-prepay', nonceStr: 'nonce' });
  });

  it('rejects a soft-deleted address before creating VIP checkout session', async () => {
    const giftOption = {
      id: 'gift-1',
      packageId: 'pkg-1',
      status: 'ACTIVE',
      title: '尊享礼包',
      coverMode: 'GRID',
      coverUrl: null,
      badge: null,
      items: [{
        quantity: 1,
        sortOrder: 0,
        sku: {
          id: 'sku-gift',
          title: '赠品规格',
          price: 99,
          stock: 10,
          status: 'ACTIVE',
          product: {
            id: 'product-gift',
            title: '赠品',
            companyId: PLATFORM_COMPANY_ID,
            status: 'ACTIVE',
            media: [],
          },
        },
      }],
    };
    const deletedAddress = {
      id: 'address-1',
      userId: 'user-1',
      regionText: '北京市/北京市/朝阳区',
      regionCode: 'CN-BJ-CY',
      recipientName: '张三',
      phone: '13800000000',
      detail: '街道一号',
      deletedAt: new Date('2026-06-04T12:00:00.000Z'),
    };
    const prisma: any = {
      vipPackage: { findUnique: jest.fn().mockResolvedValue({ id: 'pkg-1', status: 'ACTIVE', price: 399, referralBonusRate: 0.1 }) },
      checkoutSession: { findFirst: jest.fn().mockResolvedValue(null) },
      vipGiftOption: { findUnique: jest.fn().mockResolvedValue(giftOption) },
      address: {
        findUnique: jest.fn(async (args: any) => (
          args.where.deletedAt === null ? null : deletedAddress
        )),
      },
      $transaction: jest.fn().mockRejectedValue(new Error('vip transaction should not run')),
    };
    const service = new CheckoutService(prisma, makeBonusConfig() as any);

    await expect(service.checkoutVipPackage('user-1', {
      packageId: 'pkg-1',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      paymentChannel: 'wechat',
    } as any)).rejects.toThrow('收货地址无效');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates WECHAT_PAY APP params when resuming checkout sessions', async () => {
    const prisma: any = {
      checkoutSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          userId: 'user-1',
          status: 'ACTIVE',
          merchantOrderNo: 'CS-WX-1',
          expectedTotal: 128,
          paymentChannel: 'WECHAT_PAY',
          expiresAt: new Date(Date.now() + 30_000),
        }),
      },
    };
    const wechatPayService = makeWechatPayService();
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    (service as any).setWechatPayService(wechatPayService);

    const result = await service.resumeSession('user-1', 'session-1');

    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: 'CS-WX-1',
      amount: 128,
      description: '爱买买订单-CS-WX-1',
    });
    expect(result.paymentParams).toEqual({ channel: 'wechat', prepayId: 'wx-prepay', nonceStr: 'nonce' });
  });

  it('throws ServiceUnavailableException when WECHAT_PAY resume params fail', async () => {
    const prisma: any = {
      checkoutSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          userId: 'user-1',
          status: 'ACTIVE',
          merchantOrderNo: 'CS-WX-1',
          expectedTotal: 128,
          paymentChannel: 'WECHAT_PAY',
          expiresAt: new Date(Date.now() + 30_000),
        }),
      },
    };
    const wechatPayService = makeWechatPayService({
      createAppOrder: jest.fn().mockRejectedValue(new Error('wx unavailable')),
    });
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    (service as any).setWechatPayService(wechatPayService);

    let caught: unknown;
    try {
      await service.resumeSession('user-1', 'session-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught as Error).message).toBe('支付服务暂不可用，请稍后重试');
  });

  it('throws ServiceUnavailableException when WECHAT_PAY resume service is unavailable', async () => {
    const prisma: any = {
      checkoutSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          userId: 'user-1',
          status: 'ACTIVE',
          merchantOrderNo: 'CS-WX-1',
          expectedTotal: 128,
          paymentChannel: 'WECHAT_PAY',
          expiresAt: new Date(Date.now() + 30_000),
        }),
      },
    };
    const wechatPayService = makeWechatPayService({
      isAvailable: jest.fn().mockReturnValue(false),
    });
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    (service as any).setWechatPayService(wechatPayService);

    await expect(service.resumeSession('user-1', 'session-1'))
      .rejects.toThrow(ServiceUnavailableException);
    expect(wechatPayService.createAppOrder).not.toHaveBeenCalled();
  });
});
