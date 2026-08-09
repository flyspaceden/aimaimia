import { ConflictException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

describe('CheckoutService idempotent reuse ACTIVE barrier', () => {
  function createHarness(session: any) {
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{
        status: 'DELETED',
        deletionExecutedAt: new Date(),
      }]),
      checkoutSession: { findFirst: jest.fn() },
    };
    const prisma: any = {
      checkoutSession: { findFirst: jest.fn().mockResolvedValue(session) },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const service = new CheckoutService(prisma, {} as any);
    service.setPaymentOperationCoordinator({
      acquireLock: jest.fn().mockResolvedValue(true),
      renewLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    } as any);
    const wechat = {
      isAvailable: jest.fn().mockReturnValue(true),
      createAppOrder: jest.fn(),
    };
    service.setWechatPayService(wechat as any);
    return { service, tx, wechat };
  }

  it('blocks an ordinary-checkout idempotent replay after account deletion before provider preorder', async () => {
    const session = {
      id: 'normal-session',
      userId: 'user-1',
      bizType: 'NORMAL_GOODS',
      idempotencyKey: 'normal-idem',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      merchantOrderNo: 'CS-NORMAL-1',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 50,
      goodsAmount: 50,
      shippingFee: 0,
      discountAmount: 0,
      itemsSnapshot: [{ skuId: 'sku-1', quantity: 1 }],
      bizMeta: {},
      buyerNote: null,
      couponInstanceIds: [],
    };
    const { service, tx, wechat } = createHarness(session);

    await expect(service.checkout('user-1', {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
      paymentChannel: 'wechat',
      idempotencyKey: 'normal-idem',
    } as any)).rejects.toBeInstanceOf(ConflictException);

    expect(tx.checkoutSession.findFirst).not.toHaveBeenCalled();
    expect(wechat.createAppOrder).not.toHaveBeenCalled();
  });

  it('blocks a VIP-checkout idempotent replay after account deletion before provider preorder', async () => {
    const session = {
      id: 'vip-session',
      userId: 'user-1',
      bizType: 'VIP_PACKAGE',
      idempotencyKey: 'vip-idem',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      merchantOrderNo: 'VIP-1',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 399,
      goodsAmount: 399,
      shippingFee: 0,
      discountAmount: 0,
      buyerNote: null,
      bizMeta: {
        vipPackageId: 'package-1',
        vipGiftOptionId: 'gift-1',
        snapshotPrice: 399,
        giftTitle: '会员礼包',
      },
    };
    const { service, tx, wechat } = createHarness(session);

    await expect(service.checkoutVipPackage('user-1', {
      packageId: 'package-1',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      paymentChannel: 'wechat',
      idempotencyKey: 'vip-idem',
    } as any)).rejects.toBeInstanceOf(ConflictException);

    expect(tx.checkoutSession.findFirst).not.toHaveBeenCalled();
    expect(wechat.createAppOrder).not.toHaveBeenCalled();
  });

  it('applies the same barrier to the public fenced-payment coordinator used by group-buy', async () => {
    const session = {
      id: 'group-session',
      userId: 'user-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      merchantOrderNo: 'GB-1',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 88,
      bizMeta: {},
    };
    const { service, tx, wechat } = createHarness(session);

    await expect(service.createPaymentParamsForExistingCheckout({
      userId: 'user-1',
      sessionId: 'group-session',
      requestedScene: 'APP',
      description: '团购订单',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(tx.checkoutSession.findFirst).not.toHaveBeenCalled();
    expect(wechat.createAppOrder).not.toHaveBeenCalled();
  });
});
