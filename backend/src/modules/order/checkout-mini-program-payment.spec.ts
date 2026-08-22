import { ConflictException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

function makeWechatPayService() {
  return {
    isAvailable: jest.fn().mockReturnValue(true),
    isMiniProgramAvailable: jest.fn().mockReturnValue(true),
    getMiniProgramAppId: jest.fn().mockReturnValue('wx-mini-id'),
    createAppOrder: jest.fn(),
    createMiniProgramOrder: jest.fn().mockResolvedValue({
      appId: 'wx-mini-id',
      timeStamp: '1785686400',
      nonceStr: 'nonce',
      package: 'prepay_id=wx-prepay',
      signType: 'RSA',
      paySign: 'signed',
      prepayId: 'wx-prepay',
    }),
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

function wirePaymentCoordinator(service: CheckoutService) {
  let owner: string | null = null;
  service.setPaymentOperationCoordinator({
    acquireLock: jest.fn(async (_key: string, candidate: string) => {
      if (owner) return false;
      owner = candidate;
      return true;
    }),
    renewLock: jest.fn(async (_key: string, candidate: string) => owner === candidate),
    releaseLock: jest.fn(async (_key: string, candidate: string) => {
      if (owner === candidate) owner = null;
    }),
  } as any);
  return service;
}

function makeSessionModel(initial?: any) {
  let current = initial ?? null;
  const model = {
    findFirst: jest.fn(async ({ where }: any = {}) => {
      if (!current) return null;
      if (where?.id && where.id !== current.id) return null;
      if (where?.status === 'ACTIVE' && current.status !== 'ACTIVE') return null;
      return current;
    }),
    findUnique: jest.fn(async ({ where }: any) => where.id === current?.id ? current : null),
    create: jest.fn(async ({ data }: any) => {
      current = { id: 'session-mini-1', status: 'ACTIVE', ...data };
      return current;
    }),
    updateMany: jest.fn(async ({ data }: any) => {
      if (!current) return { count: 0 };
      current = { ...current, ...data };
      return { count: 1 };
    }),
  };
  return { model, get current() { return current; } };
}

describe('CheckoutService mini-program payment scene', () => {
  it('forces WECHAT_PAY/MINI_PROGRAM and resolves openid only from AuthIdentity', async () => {
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
    const sessions = makeSessionModel();
    const prisma: any = {
      session: {
        findFirst: jest.fn().mockResolvedValue({
          authIdentity: {
            userId: 'user-1',
            provider: 'WECHAT',
            identifier: 'trusted-mini-openid',
            appId: 'wx-mini-id',
            verified: true,
          },
        }),
      },
      checkoutSession: sessions.model,
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue(null) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: { findUnique: jest.fn().mockResolvedValue({
        id: 'address-1',
        userId: 'user-1',
        regionText: '北京市/北京市/朝阳区',
        regionCode: 'CN-BJ-CY',
        recipientName: '张三',
        phone: '13800000000',
        detail: '街道一号',
      }) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findFirst: jest.fn(), findUnique: jest.fn() },
      couponInstance: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      lotteryRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (callback: any) => callback({
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([{
          status: 'ACTIVE',
          deletionExecutedAt: null,
        }]),
        checkoutSession: sessions.model,
      })),
    };
    const wechat = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechat);

    const result = await service.checkout('user-1', {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
      // 即使客户端伪造支付宝，小程序专用端点也必须强制微信。
      paymentChannel: 'alipay',
    } as any, 'MINI_PROGRAM', {
      sessionId: 'auth-session-1',
      authIdentityId: 'mini-identity-1',
    });

    expect(prisma.session.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'auth-session-1',
        userId: 'user-1',
        authIdentityId: 'mini-identity-1',
        status: 'ACTIVE',
        expiresAt: { gt: expect.any(Date) },
      },
      select: {
        authIdentity: {
          select: {
            userId: true,
            provider: true,
            identifier: true,
            appId: true,
            verified: true,
          },
        },
      },
    });
    expect(sessions.current).toMatchObject({
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'MINI_PROGRAM',
      miniProgramPayerOpenId: 'trusted-mini-openid',
    });
    expect(wechat.createMiniProgramOrder).toHaveBeenCalledWith({
      outTradeNo: sessions.current.merchantOrderNo,
      amount: 88,
      description: `爱买买订单-${sessions.current.merchantOrderNo}`,
      openId: 'trusted-mini-openid',
      timeExpire: sessions.current.expiresAt,
    });
    expect(wechat.createAppOrder).not.toHaveBeenCalled();
    expect(result.paymentScene).toBe('MINI_PROGRAM');
    expect(result.paymentParams).toMatchObject({
      channel: 'wechat',
      scene: 'mini_program',
      prepayId: 'wx-prepay',
    });
  });

  it('rejects mini-program resume when JWT has no exact Session.authIdentityId', async () => {
    const prisma: any = {
      session: { findFirst: jest.fn() },
      checkoutSession: { findFirst: jest.fn().mockResolvedValue({
        id: 'session-mini',
        userId: 'user-1',
        status: 'ACTIVE',
        merchantOrderNo: 'CS-MINI-1',
        expectedTotal: 128,
        paymentChannel: 'WECHAT_PAY',
        paymentScene: 'MINI_PROGRAM',
        expiresAt: new Date(Date.now() + 60_000),
      }) },
    };
    const wechat = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechat);

    await expect(service.resumeSession('user-1', 'session-mini', 'MINI_PROGRAM'))
      .rejects.toThrow('小程序登录会话已失效');
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
    expect(wechat.createMiniProgramOrder).not.toHaveBeenCalled();
  });

  it('does not resume an APP payment directly in the mini-program scene', async () => {
    const prisma: any = {
      session: { findFirst: jest.fn() },
      checkoutSession: { findFirst: jest.fn().mockResolvedValue({
        id: 'session-app',
        userId: 'user-1',
        status: 'ACTIVE',
        merchantOrderNo: 'CS-APP-1',
        expectedTotal: 88,
        paymentChannel: 'WECHAT_PAY',
        paymentScene: 'APP',
        expiresAt: new Date(Date.now() + 60_000),
      }) },
    };
    const wechat = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechat);

    let caught: unknown;
    try {
      await service.resumeSession('user-1', 'session-app', 'MINI_PROGRAM');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toMatchObject({
      code: 'PAYMENT_SCENE_MISMATCH',
      currentScene: 'APP',
      requestedScene: 'MINI_PROGRAM',
    });
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
    expect(wechat.createMiniProgramOrder).not.toHaveBeenCalled();
  });

  it('resumes a MINI_PROGRAM payment with the server-side openid', async () => {
    const sessions = makeSessionModel({
      id: 'session-mini',
      userId: 'user-1',
      status: 'ACTIVE',
      merchantOrderNo: 'CS-MINI-1',
      expectedTotal: 128,
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'MINI_PROGRAM',
      expiresAt: new Date(Date.now() + 60_000),
      bizMeta: {},
    });
    const prisma: any = {
      session: { findFirst: jest.fn().mockResolvedValue({
        authIdentity: {
          userId: 'user-1',
          provider: 'WECHAT',
          identifier: 'trusted-openid',
          appId: 'wx-mini-id',
          verified: true,
        },
      }) },
      checkoutSession: sessions.model,
      $transaction: jest.fn(async (cb: any) => cb({
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([{
          status: 'ACTIVE',
          deletionExecutedAt: null,
        }]),
        checkoutSession: sessions.model,
      })),
    };
    const wechat = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechat);

    const result = await service.resumeSession('user-1', 'session-mini', 'MINI_PROGRAM', {
      sessionId: 'auth-session-1',
      authIdentityId: 'mini-identity-1',
    });

    expect(wechat.createMiniProgramOrder).toHaveBeenCalledWith({
      outTradeNo: 'CS-MINI-1',
      amount: 128,
      description: '爱买买订单-CS-MINI-1',
      openId: 'trusted-openid',
      timeExpire: sessions.current.expiresAt,
    });
    expect(result.paymentParams).toMatchObject({ scene: 'mini_program' });
  });

  it('marks an App-created pending session as not resumable from the mini-program', async () => {
    const prisma: any = {
      checkoutSession: { findFirst: jest.fn().mockResolvedValue({
        id: 'session-app',
        merchantOrderNo: 'CS-APP-1',
        expectedTotal: 88,
        goodsAmount: 80,
        shippingFee: 8,
        expiresAt: new Date(Date.now() + 60_000),
        bizType: 'NORMAL_GOODS',
        paymentScene: 'APP',
        itemsSnapshot: [],
      }) },
    };
    const service = new CheckoutService(prisma, makeBonusConfig() as any);

    const result = await service.getPendingForUser('user-1', 'MINI_PROGRAM');

    expect(result).toMatchObject({
      paymentScene: 'APP',
      canResumeInCurrentScene: false,
    });
  });

  it('requires safe cancellation before creating a new mini-program checkout', async () => {
    const prisma: any = {
      checkoutSession: { findFirst: jest.fn().mockResolvedValue({
        id: 'session-app',
        userId: 'user-1',
        status: 'ACTIVE',
        paymentScene: 'APP',
        orders: [],
      }) },
    };
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    const cancel = jest.spyOn(service, 'cancelSession').mockResolvedValue({ success: true });

    const result = await service.prepareMiniProgramRecheckout('user-1', 'session-app');

    expect(cancel).toHaveBeenCalledWith('user-1', 'session-app');
    expect(result).toEqual({
      status: 'EXPIRED',
      orderIds: [],
      recheckoutRequired: true,
      targetScene: 'MINI_PROGRAM',
    });
  });

  it('uses the same safe cancellation gate for MINI_PROGRAM to APP switching', async () => {
    const prisma: any = {
      checkoutSession: { findFirst: jest.fn().mockResolvedValue({
        id: 'session-mini',
        userId: 'user-1',
        status: 'ACTIVE',
        paymentScene: 'MINI_PROGRAM',
        orders: [],
      }) },
    };
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    const cancel = jest.spyOn(service, 'cancelSession').mockResolvedValue({ success: true });

    const result = await service.prepareAppRecheckout('user-1', 'session-mini');

    expect(cancel).toHaveBeenCalledWith('user-1', 'session-mini');
    expect(result).toMatchObject({
      status: 'EXPIRED',
      recheckoutRequired: true,
      targetScene: 'APP',
    });
  });

  it('does not hide an uncertain query/close result behind a second payment attempt', async () => {
    const active = {
      id: 'session-app',
      userId: 'user-1',
      status: 'ACTIVE',
      paymentScene: 'APP',
      orders: [],
    };
    const prisma: any = {
      checkoutSession: { findFirst: jest.fn().mockResolvedValue(active) },
    };
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    jest.spyOn(service, 'cancelSession').mockRejectedValue(new Error('query result uncertain'));

    await expect(service.prepareMiniProgramRecheckout('user-1', 'session-app'))
      .rejects.toThrow('query result uncertain');
    expect(prisma.checkoutSession.findFirst).toHaveBeenCalledTimes(2);
  });

  it('returns recheckoutRequired when concurrent cancellation already moved the session to EXPIRED', async () => {
    const prisma: any = {
      checkoutSession: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({
            id: 'session-app',
            userId: 'user-1',
            status: 'ACTIVE',
            paymentScene: 'APP',
            orders: [],
          })
          .mockResolvedValueOnce({
            id: 'session-app',
            userId: 'user-1',
            status: 'EXPIRED',
            paymentScene: 'APP',
            orders: [],
          }),
      },
    };
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    jest.spyOn(service, 'cancelSession').mockRejectedValue(new Error('状态已变化'));

    await expect(service.prepareMiniProgramRecheckout('user-1', 'session-app'))
      .resolves.toEqual({
        status: 'EXPIRED',
        orderIds: [],
        recheckoutRequired: true,
        targetScene: 'MINI_PROGRAM',
      });
  });
});
