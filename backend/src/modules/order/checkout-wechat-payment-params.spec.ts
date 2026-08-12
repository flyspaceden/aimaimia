import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
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
    findFirst: jest.fn(async (args?: any) => {
      if (!current) return null;
      if (args?.where?.id && args.where.id !== current.id) return null;
      if (args?.where?.idempotencyKey && args.where.idempotencyKey !== current.idempotencyKey) return null;
      return current;
    }),
    findUnique: jest.fn(async ({ where }: any) => where.id === current?.id ? current : null),
    create: jest.fn(async ({ data }: any) => {
      current = { id: data.bizType === 'VIP_PACKAGE' ? 'vip-session-1' : 'session-1', status: 'ACTIVE', ...data };
      return current;
    }),
    updateMany: jest.fn(async ({ data }: any) => {
      if (!current) return { count: 0 };
      current = { ...current, ...data };
      return { count: 1 };
    }),
    update: jest.fn(async ({ data }: any) => {
      current = { ...current, ...data };
      return current;
    }),
    findMany: jest.fn().mockResolvedValue([]),
  };
  return {
    model,
    get current() { return current; },
    set current(value: any) { current = value; },
  };
}

function activeUserTx(checkoutSession: any) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{
      status: 'ACTIVE',
      deletionExecutedAt: null,
    }]),
    checkoutSession,
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
    const sessions = makeSessionModel();
    const prisma: any = {
      checkoutSession: sessions.model,
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue(null) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: { findUnique: jest.fn().mockResolvedValue(address) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      couponInstance: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      lotteryRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const wechatPayService = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    (service as any).setWechatPayService(wechatPayService);

    const result = await service.checkout('user-1', {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
      paymentChannel: 'wechat',
    } as any);

    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: sessions.current.merchantOrderNo,
      amount: 88,
      description: `爱买买订单-${sessions.current.merchantOrderNo}`,
      timeExpire: sessions.current.expiresAt,
    });
    expect(result.paymentParams).toEqual({ channel: 'wechat', prepayId: 'wx-prepay', nonceStr: 'nonce' });
  });

  it('fails closed on first preorder error and safely retries the same idempotency key after definitive not-found', async () => {
    const existing = {
      id: 'normal-session-existing',
      userId: 'user-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      merchantOrderNo: 'CS-ORIGINAL-001',
      bizType: 'NORMAL_GOODS',
      idempotencyKey: 'normal-idempotency-1',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 88,
      goodsAmount: 88,
      shippingFee: 0,
      discountAmount: 0,
      itemsSnapshot: [{ skuId: 'sku-1', quantity: 1 }],
      bizMeta: {},
    };
    const sessions = makeSessionModel(existing);
    const prisma: any = {
      checkoutSession: sessions.model,
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const createAppOrder = jest
      .fn()
      .mockRejectedValueOnce(new Error('network reset after request'))
      .mockResolvedValueOnce({ prepayId: 'wx-prepay-retry', nonceStr: 'retry-nonce' });
    const wechatPayService: any = makeWechatPayService({ createAppOrder });
    wechatPayService.queryOrder = jest.fn().mockResolvedValue({ outcome: 'DEFINITIVE_NOT_FOUND' });
    wechatPayService.matchesPaymentScene = jest.fn().mockReturnValue(true);
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechatPayService);
    const dto = {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
      paymentChannel: 'wechat',
      expectedTotal: 88,
      idempotencyKey: 'normal-idempotency-1',
    } as any;

    await expect(service.checkout('user-1', dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect((sessions.current.bizMeta as any).paymentParamState.state).toBe('UNCERTAIN');

    const retried = await service.checkout('user-1', dto);
    expect(wechatPayService.queryOrder).toHaveBeenCalledWith('CS-ORIGINAL-001');
    expect(createAppOrder).toHaveBeenNthCalledWith(2, {
      outTradeNo: 'CS-ORIGINAL-001',
      amount: 88,
      description: '爱买买订单-CS-ORIGINAL-001',
      timeExpire: existing.expiresAt,
    });
    expect(retried.paymentParams).toEqual({
      channel: 'wechat',
      prepayId: 'wx-prepay-retry',
      nonceStr: 'retry-nonce',
    });
    expect((sessions.current.bizMeta as any).paymentParamState.state).toBe('READY');
  });

  it('recovers a crash-stale CREATING fence as UNCERTAIN and queries before re-preordering', async () => {
    const existing: any = {
      id: 'normal-session-crash', userId: 'user-1', status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000), merchantOrderNo: 'CS-CRASH-001',
      bizType: 'NORMAL_GOODS', idempotencyKey: 'normal-crash-key', paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP', expectedTotal: 88, goodsAmount: 88, shippingFee: 0,
      discountAmount: 0, itemsSnapshot: [{ skuId: 'sku-1', quantity: 1 }], bizMeta: {},
    };
    const sessions = makeSessionModel(existing);
    const prisma: any = {
      checkoutSession: sessions.model,
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const events: string[] = [];
    const wechatPayService: any = makeWechatPayService({
      createAppOrder: jest.fn(async () => {
        events.push('preorder');
        return { prepayId: 'wx-after-crash', nonceStr: 'nonce-after-crash' };
      }),
    });
    wechatPayService.queryOrder = jest.fn(async () => {
      events.push('query');
      return { outcome: 'DEFINITIVE_NOT_FOUND' };
    });
    wechatPayService.matchesPaymentScene = jest.fn().mockReturnValue(true);
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechatPayService);
    const providerFingerprint = (service as any).buildProviderRequestFingerprint({
      paymentChannel: 'WECHAT_PAY',
      scene: 'APP',
      merchantOrderNo: 'CS-CRASH-001',
      expectedTotal: 88,
      description: '爱买买订单-CS-CRASH-001',
      expiresAt: existing.expiresAt,
      miniProgramOpenId: null,
    });
    existing.bizMeta.paymentParamState = {
      version: 1,
      state: 'CREATING',
      owner: 'dead-process-owner',
      requestFingerprint: providerFingerprint,
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
    };

    const result = await service.checkout('user-1', {
      items: [{ skuId: 'sku-1', quantity: 1 }], addressId: 'address-1',
      paymentChannel: 'wechat', expectedTotal: 88, idempotencyKey: 'normal-crash-key',
    } as any);

    expect(events).toEqual(['query', 'preorder']);
    expect(result.paymentParams).toMatchObject({ prepayId: 'wx-after-crash' });
    expect((sessions.current.bizMeta as any).paymentParamState).toMatchObject({
      state: 'READY',
      requestFingerprint: providerFingerprint,
    });
    expect((sessions.current.bizMeta as any).paymentParamState.owner).toBeUndefined();
  });

  it('does not retry an UNCERTAIN NOTPAY preorder when the provider omits amount', async () => {
    const wechatPayService: any = makeWechatPayService();
    wechatPayService.queryOrder = jest.fn().mockResolvedValue({
      outcome: 'FOUND',
      tradeState: 'NOTPAY',
      outTradeNo: 'CS-NOTPAY-NO-AMOUNT',
      appId: 'wx-app',
    });
    wechatPayService.matchesPaymentScene = jest.fn().mockReturnValue(true);
    const service = wirePaymentCoordinator(new CheckoutService({} as any, makeBonusConfig() as any));
    service.setWechatPayService(wechatPayService);

    await expect((service as any).reconcileUncertainWechatPreorder({
      id: 'session-notpay-no-amount',
      merchantOrderNo: 'CS-NOTPAY-NO-AMOUNT',
      expectedTotal: 88,
    }, 'APP')).rejects.toThrow('支付金额校验失败');
  });

  it('rejects an UNCERTAIN CLOSED preorder without requiring a provider amount', async () => {
    const wechatPayService: any = makeWechatPayService();
    wechatPayService.queryOrder = jest.fn().mockResolvedValue({
      outcome: 'FOUND',
      tradeState: 'CLOSED',
      outTradeNo: 'CS-CLOSED-NO-AMOUNT',
      appId: 'wx-app',
    });
    wechatPayService.matchesPaymentScene = jest.fn().mockReturnValue(true);
    const service = wirePaymentCoordinator(new CheckoutService({} as any, makeBonusConfig() as any));
    service.setWechatPayService(wechatPayService);

    await expect((service as any).reconcileUncertainWechatPreorder({
      id: 'session-closed-no-amount',
      merchantOrderNo: 'CS-CLOSED-NO-AMOUNT',
      expectedTotal: 88,
    }, 'APP')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }),
    });
  });

  it.each(['EXPIRED', 'FAILED'])('rejects normal idempotency reuse for %s without generating params', async (status) => {
    const existing = {
      id: `normal-${status}`,
      userId: 'user-1',
      status,
      expiresAt: new Date(Date.now() + 60_000),
      merchantOrderNo: `CS-${status}`,
      bizType: 'NORMAL_GOODS',
      idempotencyKey: 'normal-idempotency-terminal',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 88,
      goodsAmount: 88,
      shippingFee: 0,
      discountAmount: 0,
      itemsSnapshot: [{ skuId: 'sku-1', quantity: 1 }],
    };
    const sessions = makeSessionModel(existing);
    const prisma: any = { checkoutSession: sessions.model };
    const wechatPayService = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechatPayService);

    await expect(service.checkout('user-1', {
      items: [{ skuId: 'sku-1', quantity: 1 }],
      addressId: 'address-1',
      paymentChannel: 'wechat',
      expectedTotal: 88,
      idempotencyKey: 'normal-idempotency-terminal',
    } as any)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }),
    });
    expect(wechatPayService.createAppOrder).not.toHaveBeenCalled();
  });

  it('revalidates and safely reuses the winning ACTIVE session after a P2002 idempotency race', async () => {
    const sku = {
      id: 'sku-1', productId: 'product-1', title: '5斤装', price: 88, cost: 50,
      stock: 10, status: 'ACTIVE', maxPerOrder: null, weightGram: 0,
      product: {
        id: 'product-1', companyId: 'company-1', title: '苹果', status: 'ACTIVE',
        auditStatus: 'APPROVED', bizType: 'NORMAL_GOODS', shippingTemplateId: null,
        returnPolicy: 'INHERIT', media: [],
      },
    };
    const sessions = makeSessionModel();
    const winningSession = {
      id: 'session-winning', userId: 'user-1', status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000), merchantOrderNo: 'CS-WINNING-001',
      bizType: 'NORMAL_GOODS', idempotencyKey: 'normal-p2002', paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP', expectedTotal: 88, goodsAmount: 88, shippingFee: 0,
      discountAmount: 0, itemsSnapshot: [{ skuId: 'sku-1', quantity: 1 }], bizMeta: {},
    };
    sessions.model.create.mockImplementationOnce(async () => {
      sessions.current = winningSession;
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    });
    const prisma: any = {
      checkoutSession: sessions.model,
      productSKU: { findMany: jest.fn().mockResolvedValue([sku]) },
      cart: { findUnique: jest.fn().mockResolvedValue(null) },
      cartItem: { findMany: jest.fn().mockResolvedValue([]) },
      address: { findUnique: jest.fn().mockResolvedValue({
        id: 'address-1', userId: 'user-1', regionText: '北京市/北京市/朝阳区',
        regionCode: 'CN-BJ-CY', recipientName: '张三', phone: '13800000000', detail: '街道一号',
      }) },
      vipTreeNode: { findFirst: jest.fn().mockResolvedValue(null) },
      rewardLedger: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      couponInstance: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
      lotteryRecord: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const wechatPayService = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechatPayService);

    const result = await service.checkout('user-1', {
      items: [{ skuId: 'sku-1', quantity: 1 }], addressId: 'address-1',
      paymentChannel: 'wechat', expectedTotal: 88, idempotencyKey: 'normal-p2002',
    } as any);

    expect(result.merchantOrderNo).toBe('CS-WINNING-001');
    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: 'CS-WINNING-001', amount: 88, description: '爱买买订单-CS-WINNING-001',
      timeExpire: winningSession.expiresAt,
    });
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
    const sessions = makeSessionModel();
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{
        status: 'ACTIVE',
        deletionExecutedAt: null,
      }]),
      checkoutSession: sessions.model,
      memberProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      productSKU: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      inventoryLedger: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      vipPackage: { findUnique: jest.fn().mockResolvedValue({ id: 'pkg-1', status: 'ACTIVE', price: 399, referralBonusRate: 0.1 }) },
      checkoutSession: sessions.model,
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
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const wechatPayService = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
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
      timeExpire: sessions.current.expiresAt,
    });
    expect(sessions.current.bizMeta.checkoutRequestFingerprint).toEqual(expect.any(String));
    expect(result.paymentParams).toEqual({ channel: 'wechat', prepayId: 'wx-prepay', nonceStr: 'nonce' });
  });

  it('reuses the original legacy VIP snapshot for the same idempotent request payload', async () => {
    const existing = {
      id: 'vip-session-existing',
      userId: 'user-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      merchantOrderNo: 'VIP-ORIGINAL-001',
      bizType: 'VIP_PACKAGE',
      idempotencyKey: 'vip-idempotency-1',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 399,
      goodsAmount: 399,
      shippingFee: 0,
      discountAmount: 0,
      buyerNote: null,
      bizMeta: {
        vipPackageId: 'pkg-1',
        vipGiftOptionId: 'gift-1',
        giftTitle: '原始礼包标题',
        snapshotPrice: 399,
      },
    };
    const sessions = makeSessionModel(existing);
    const prisma: any = {
      checkoutSession: sessions.model,
      vipPackage: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const wechatPayService = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechatPayService);

    const result = await service.checkoutVipPackage('user-1', {
      packageId: 'pkg-1',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      paymentChannel: 'wechat',
      expectedTotal: 399,
      idempotencyKey: 'vip-idempotency-1',
    } as any);

    expect(prisma.vipPackage.findUnique).not.toHaveBeenCalled();
    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: 'VIP-ORIGINAL-001',
      amount: 399,
      description: '爱买买VIP礼包-原始礼包标题',
      timeExpire: existing.expiresAt,
    });
    expect(result).toMatchObject({
      sessionId: 'vip-session-existing',
      merchantOrderNo: 'VIP-ORIGINAL-001',
      expectedTotal: 399,
      goodsAmount: 399,
    });
  });

  it('rejects a reused VIP idempotency key when the trusted request payload changes', async () => {
    const baseDto = {
      packageId: 'pkg-1',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      paymentChannel: 'wechat',
      expectedTotal: 399,
      buyerNote: '放门卫',
      idempotencyKey: 'vip-payload-key',
    } as any;
    const existing = {
      id: 'vip-session-payload',
      userId: 'user-1',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      merchantOrderNo: 'VIP-PAYLOAD-001',
      bizType: 'VIP_PACKAGE',
      idempotencyKey: 'vip-payload-key',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 399,
      goodsAmount: 399,
      shippingFee: 0,
      discountAmount: 0,
      buyerNote: '放门卫',
      bizMeta: {
        vipPackageId: 'pkg-1',
        vipGiftOptionId: 'gift-1',
        giftTitle: '原始礼包标题',
        snapshotPrice: 399,
      },
    };
    const sessions = makeSessionModel(existing);
    const prisma: any = {
      checkoutSession: sessions.model,
      vipPackage: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const wechatPayService = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechatPayService);
    (existing.bizMeta as any).checkoutRequestFingerprint = (service as any)
      .buildVipCheckoutFingerprint(baseDto, 'APP');

    await expect(service.checkoutVipPackage('user-1', {
      ...baseDto,
      addressId: 'address-2',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.vipPackage.findUnique).not.toHaveBeenCalled();
    expect(wechatPayService.createAppOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['EXPIRED', new Date(Date.now() + 60_000), 'APP'],
    ['ACTIVE', new Date(Date.now() - 1_000), 'APP'],
    ['ACTIVE', new Date(Date.now() + 60_000), 'MINI_PROGRAM'],
  ])('rejects non-reusable VIP idempotent session status=%s', async (status, expiresAt, paymentScene) => {
    const prisma: any = {
      checkoutSession: { findFirst: jest.fn().mockResolvedValue({
        id: 'vip-session-existing',
        userId: 'user-1',
        status,
        expiresAt,
        merchantOrderNo: 'VIP-ORIGINAL-001',
        bizType: 'VIP_PACKAGE',
        idempotencyKey: 'vip-idempotency-1',
        paymentChannel: 'WECHAT_PAY',
        paymentScene,
        expectedTotal: 399,
        goodsAmount: 399,
        shippingFee: 0,
        discountAmount: 0,
        bizMeta: { giftTitle: '原始礼包标题' },
      }) },
    };
    const service = new CheckoutService(prisma, makeBonusConfig() as any);

    await expect(service.checkoutVipPackage('user-1', {
      packageId: 'pkg-1',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      idempotencyKey: 'vip-idempotency-1',
    } as any)).rejects.toBeInstanceOf(ConflictException);
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
      checkoutSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
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

  it('reconciles an expired VIP payment through the locked cancel path before creating another session', async () => {
    const prisma: any = {
      checkoutSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ id: 'vip-expired-1' }]),
      },
      vipPackage: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    const service = new CheckoutService(prisma, makeBonusConfig() as any);
    const cancelSpy = jest
      .spyOn(service, 'cancelSession')
      .mockResolvedValue({ success: true });

    await expect(service.checkoutVipPackage('user-1', {
      packageId: 'missing-package',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      paymentChannel: 'wechat',
    } as any)).rejects.toThrow('VIP 档位不存在或已下架');

    expect(cancelSpy).toHaveBeenCalledWith('user-1', 'vip-expired-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('closes an expired NOTPAY VIP provider order under the payment lock before continuing', async () => {
    const events: string[] = [];
    const expiredSession: any = {
      id: 'vip-expired-notpay',
      userId: 'user-1',
      status: 'ACTIVE',
      bizType: 'VIP_PACKAGE',
      merchantOrderNo: 'VIP-EXPIRED-NOTPAY',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 399,
      expiresAt: new Date(Date.now() - 60_000),
      itemsSnapshot: [],
      rewardId: null,
      deductionGroupId: null,
      couponInstanceIds: [],
      bizMeta: {},
    };
    const checkoutSession = {
      findMany: jest.fn().mockResolvedValue([{ id: expiredSession.id }]),
      findUnique: jest.fn().mockImplementation(async () => expiredSession),
      updateMany: jest.fn(async () => {
        events.push('local-expire');
        expiredSession.status = 'EXPIRED';
        return { count: 1 };
      }),
    };
    const prisma: any = {
      checkoutSession,
      vipPackage: {
        findUnique: jest.fn(async () => {
          events.push('next-checkout');
          return null;
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(checkoutSession))),
    };
    const wechat: any = makeWechatPayService();
    wechat.queryOrder = jest.fn(async () => {
      events.push('provider-query');
      return { outcome: 'FOUND', tradeState: 'NOTPAY' };
    });
    wechat.matchesPaymentScene = jest.fn().mockReturnValue(true);
    wechat.closeOrder = jest.fn(async () => {
      events.push('provider-close');
      return { success: true, terminal: true, alreadyPaid: false };
    });
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechat);

    await expect(service.checkoutVipPackage('user-1', {
      packageId: 'missing-package',
      giftOptionId: 'gift-1',
      addressId: 'address-1',
      paymentChannel: 'wechat',
    } as any)).rejects.toThrow('VIP 档位不存在或已下架');

    expect(events).toEqual([
      'provider-query',
      'provider-close',
      'local-expire',
      'next-checkout',
    ]);
  });

  it('builds a paid expired VIP session and blocks creation of a second VIP checkout', async () => {
    const expiredSession: any = {
      id: 'vip-expired-paid',
      userId: 'user-1',
      status: 'ACTIVE',
      bizType: 'VIP_PACKAGE',
      merchantOrderNo: 'VIP-EXPIRED-PAID',
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expectedTotal: 399,
      expiresAt: new Date(Date.now() - 60_000),
      itemsSnapshot: [],
      rewardId: null,
      deductionGroupId: null,
      couponInstanceIds: [],
      bizMeta: {},
    };
    const prisma: any = {
      checkoutSession: {
        findMany: jest.fn().mockResolvedValue([{ id: expiredSession.id }]),
        findUnique: jest.fn().mockImplementation(async () => expiredSession),
      },
      vipPackage: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const wechat: any = makeWechatPayService();
    wechat.queryOrder = jest.fn().mockResolvedValue({
      outcome: 'FOUND',
      tradeState: 'SUCCESS',
      transactionId: 'wx-paid-1',
      totalAmountFen: 39900,
    });
    wechat.matchesPaymentScene = jest.fn().mockReturnValue(true);
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setWechatPayService(wechat);
    jest.spyOn(service, 'handlePaymentSuccess').mockImplementation(async () => {
      expiredSession.status = 'COMPLETED';
      return { orderIds: ['vip-order-1'] };
    });

    await expect(service.checkoutVipPackage('user-1', {
      packageId: 'pkg-2',
      giftOptionId: 'gift-2',
      addressId: 'address-1',
      paymentChannel: 'wechat',
    } as any)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VIP_PAYMENT_ALREADY_COMPLETED' }),
    });

    expect(service.handlePaymentSuccess).toHaveBeenCalledWith(
      'VIP-EXPIRED-PAID',
      'wx-paid-1',
      expect.any(String),
    );
    expect(prisma.vipPackage.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates WECHAT_PAY APP params when resuming checkout sessions', async () => {
    const sessions = makeSessionModel({
      id: 'session-1',
      userId: 'user-1',
      status: 'ACTIVE',
      merchantOrderNo: 'CS-WX-1',
      expectedTotal: 128,
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expiresAt: new Date(Date.now() + 30_000),
    });
    const prisma: any = {
      checkoutSession: sessions.model,
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const wechatPayService = makeWechatPayService();
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    (service as any).setWechatPayService(wechatPayService);

    const result = await service.resumeSession('user-1', 'session-1');

    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith({
      outTradeNo: 'CS-WX-1',
      amount: 128,
      description: '爱买买订单-CS-WX-1',
      timeExpire: sessions.current.expiresAt,
    });
    expect(result.paymentParams).toEqual({ channel: 'wechat', prepayId: 'wx-prepay', nonceStr: 'nonce' });
  });

  it('passes the original session expiry into Alipay app-pay creation', async () => {
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const sessions = makeSessionModel({
      id: 'session-alipay',
      userId: 'user-1',
      status: 'ACTIVE',
      merchantOrderNo: 'CS-ALIPAY-1',
      expectedTotal: 128,
      paymentChannel: 'ALIPAY',
      paymentScene: 'APP',
      expiresAt,
      bizMeta: {},
    });
    const prisma: any = {
      checkoutSession: sessions.model,
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const alipay = {
      isAvailable: jest.fn().mockReturnValue(true),
      createAppPayOrder: jest.fn().mockResolvedValue('signed-order-str'),
    };
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    service.setAlipayService(alipay);

    await service.resumeSession('user-1', 'session-alipay');

    expect(alipay.createAppPayOrder).toHaveBeenCalledWith({
      merchantOrderNo: 'CS-ALIPAY-1',
      totalAmount: 128,
      subject: '爱买买订单-CS-ALIPAY-1',
      timeExpire: expiresAt,
    });
  });

  it('throws ServiceUnavailableException when WECHAT_PAY resume params fail', async () => {
    const sessions = makeSessionModel({
      id: 'session-1',
      userId: 'user-1',
      status: 'ACTIVE',
      merchantOrderNo: 'CS-WX-1',
      expectedTotal: 128,
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expiresAt: new Date(Date.now() + 30_000),
    });
    const prisma: any = {
      checkoutSession: sessions.model,
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const wechatPayService = makeWechatPayService({
      createAppOrder: jest.fn().mockRejectedValue(new Error('wx unavailable')),
    });
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
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
    const sessions = makeSessionModel({
      id: 'session-1',
      userId: 'user-1',
      status: 'ACTIVE',
      merchantOrderNo: 'CS-WX-1',
      expectedTotal: 128,
      paymentChannel: 'WECHAT_PAY',
      paymentScene: 'APP',
      expiresAt: new Date(Date.now() + 30_000),
    });
    const prisma: any = {
      checkoutSession: sessions.model,
      $transaction: jest.fn(async (cb: any) => cb(activeUserTx(sessions.model))),
    };
    const wechatPayService = makeWechatPayService({
      isAvailable: jest.fn().mockReturnValue(false),
    });
    const service = wirePaymentCoordinator(new CheckoutService(prisma, makeBonusConfig() as any));
    (service as any).setWechatPayService(wechatPayService);

    await expect(service.resumeSession('user-1', 'session-1'))
      .rejects.toThrow(ServiceUnavailableException);
    expect(wechatPayService.createAppOrder).not.toHaveBeenCalled();
  });
});
