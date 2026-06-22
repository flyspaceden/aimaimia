import { CheckoutService } from './checkout.service';
import { CheckoutExpireService } from './checkout-expire.service';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

/**
 * 资金安全回归测试
 *
 * 覆盖：
 * 1. cancel 检测 TRADE_SUCCESS 时主动建单（不再仅拒绝）
 * 2. expire 检测 TRADE_SUCCESS 时主动建单（不再仅 return）
 * 3. cancel/expire 改 EXPIRED 前先调 alipay.trade.close
 *    - close 失败 → cancel 拒绝 / expire 跳过本次
 *    - close 返已支付 → 重新查询 + 主动建单
 *
 * 注：完整 mock 需要构造大量 Prisma 数据，这里采用 spy + 部分 mock
 * 验证关键调用链路（handlePaymentSuccess / closeOrder 是否被调）。
 */
describe('CheckoutService cancelSession 资金安全', () => {
  function buildSession(overrides: Partial<any> = {}) {
    return {
      id: 'sess1',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'NORMAL_GOODS',
      merchantOrderNo: 'M-001',
      paymentChannel: 'ALIPAY',
      expectedTotal: 100,
      rewardId: null,
      couponInstanceIds: [],
      itemsSnapshot: [],
      ...overrides,
    };
  }

  it('查到 TRADE_SUCCESS 时调用 handlePaymentSuccess 主动建单（不再仅拒绝）', async () => {
    const session = buildSession();
    const prisma: any = {
      checkoutSession: { findUnique: async () => session },
    };
    const svc = new CheckoutService(prisma, {} as any);
    const alipay = {
      isAvailable: () => true,
      queryOrder: jest.fn(async () => ({
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: '2026050100001',
        totalAmount: '100.00',
      })),
      closeOrder: jest.fn(),
    };
    svc.setAlipayService(alipay);

    // spy 拦截 handlePaymentSuccess（避免触发完整事务流程）
    const buildSpy = jest
      .spyOn(svc, 'handlePaymentSuccess')
      .mockResolvedValue({ orderIds: ['order-new'] });

    let caught: any;
    try {
      await svc.cancelSession('user1', 'sess1');
    } catch (e) {
      caught = e;
    }

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledWith('M-001', '2026050100001', expect.any(String));
    // close 不应被调（仅在非成功态分支调）
    expect(alipay.closeOrder).not.toHaveBeenCalled();
    // 抛 "支付已完成，订单已自动创建" 的 BadRequestException
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toContain('订单已自动创建');
  });

  it('查到 TRADE_SUCCESS 但金额不一致时拒绝建单（防篡改）', async () => {
    const session = buildSession({ expectedTotal: 100 });
    const prisma: any = {
      checkoutSession: { findUnique: async () => session },
    };
    const svc = new CheckoutService(prisma, {} as any);
    svc.setAlipayService({
      isAvailable: () => true,
      queryOrder: async () => ({
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'tx',
        totalAmount: '99.99', // 与 expectedTotal=100 不一致
      }),
      closeOrder: jest.fn(),
    });
    const buildSpy = jest
      .spyOn(svc, 'handlePaymentSuccess')
      .mockResolvedValue({ orderIds: [] });

    let caught: any;
    try {
      await svc.cancelSession('user1', 'sess1');
    } catch (e) {
      caught = e;
    }

    expect(buildSpy).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toContain('支付金额校验失败');
  });

  it('查到 WAIT_BUYER_PAY 时调 close → close 成功后允许 cancel', async () => {
    const session = buildSession();
    let casCalled = false;
    const prisma: any = {
      checkoutSession: { findUnique: async () => session },
      $transaction: async (cb: any) => {
        const tx = {
          checkoutSession: {
            updateMany: async (args: any) => {
              casCalled = true;
              expect(args.where.status).toBe('ACTIVE');
              expect(args.data.status).toBe('EXPIRED');
              return { count: 1 };
            },
          },
          rewardLedger: { updateMany: async () => ({ count: 0 }) },
          inventoryLedger: { count: async () => 0, create: async () => ({}) },
          productSKU: { update: async () => ({}) },
        };
        return cb(tx);
      },
    };
    const svc = new CheckoutService(prisma, {} as any);
    const alipay = {
      isAvailable: () => true,
      queryOrder: async () => ({
        tradeStatus: 'WAIT_BUYER_PAY',
        tradeNo: '',
        totalAmount: '',
      }),
      closeOrder: jest.fn(async () => ({ success: true })),
    };
    svc.setAlipayService(alipay);
    const buildSpy = jest.spyOn(svc, 'handlePaymentSuccess').mockResolvedValue({ orderIds: [] });

    await svc.cancelSession('user1', 'sess1');

    expect(alipay.closeOrder).toHaveBeenCalledWith('M-001');
    expect(casCalled).toBe(true); // close 成功后才走 CAS ACTIVE → EXPIRED
    expect(buildSpy).not.toHaveBeenCalled(); // close 成功路径不应建单
  });

  it('close 失败时拒绝 cancel（不修改 status）', async () => {
    const session = buildSession();
    let casCalled = false;
    const prisma: any = {
      checkoutSession: { findUnique: async () => session },
      $transaction: async (cb: any) => {
        const tx = {
          checkoutSession: {
            updateMany: async () => {
              casCalled = true;
              return { count: 1 };
            },
          },
          rewardLedger: { updateMany: async () => ({ count: 0 }) },
        };
        return cb(tx);
      },
    };
    const svc = new CheckoutService(prisma, {} as any);
    svc.setAlipayService({
      isAvailable: () => true,
      queryOrder: async () => ({
        tradeStatus: 'WAIT_BUYER_PAY',
        tradeNo: '',
        totalAmount: '',
      }),
      closeOrder: async () => ({ success: false }),
    });

    let caught: any;
    try {
      await svc.cancelSession('user1', 'sess1');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toContain('正在确认支付状态');
    expect(casCalled).toBe(false); // close 失败 → 不应进入事务
  });

  it('close 返 alreadyPaid 时重新 query 并主动建单', async () => {
    const session = buildSession({ expectedTotal: 100 });
    const prisma: any = {
      checkoutSession: { findUnique: async () => session },
    };
    const svc = new CheckoutService(prisma, {} as any);
    const queryMock = jest
      .fn()
      .mockResolvedValueOnce({
        // 第一次 query：WAIT_BUYER_PAY → 走 close 分支
        tradeStatus: 'WAIT_BUYER_PAY',
        tradeNo: '',
        totalAmount: '',
      })
      .mockResolvedValueOnce({
        // 第二次 query（close-paid 后再查）：TRADE_SUCCESS
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'tx-late',
        totalAmount: '100.00',
      });
    svc.setAlipayService({
      isAvailable: () => true,
      queryOrder: queryMock,
      closeOrder: async () => ({ success: false, alreadyPaid: true }),
    });
    const buildSpy = jest.spyOn(svc, 'handlePaymentSuccess').mockResolvedValue({ orderIds: ['o1'] });

    let caught: any;
    try {
      await svc.cancelSession('user1', 'sess1');
    } catch (e) {
      caught = e;
    }

    expect(queryMock).toHaveBeenCalledTimes(2); // 初始 + close 后
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledWith('M-001', 'tx-late', expect.any(String));
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).message).toContain('订单已自动创建');
  });
});

describe('CheckoutService handlePaymentSuccess VIP 抵扣隔离', () => {
  it('rejects VIP_PACKAGE sessions that unexpectedly carry a deductionGroupId', async () => {
    const session = {
      id: 'cs-vip-dirty',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'VIP_PACKAGE',
      merchantOrderNo: 'VIP-001',
      expectedTotal: 399,
      goodsAmount: 399,
      shippingFee: 0,
      discountAmount: 10,
      deductionGroupId: 'DG-dirty',
      totalCouponDiscount: 0,
      vipDiscountAmount: 0,
      itemsSnapshot: [{
        skuId: 'sku1',
        quantity: 1,
        unitPrice: 399,
        companyId: 'platform',
        productSnapshot: {},
      }],
      addressSnapshot: {},
      couponInstanceIds: [],
    };
    const tx = {
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const svc = new CheckoutService(prisma, {} as any);

    await expect(svc.handlePaymentSuccess('VIP-001', 'trade-1')).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(svc.handlePaymentSuccess('VIP-001', 'trade-1')).rejects.toThrow(
      'VIP 礼包不应有 deductionGroupId',
    );
  });
});

describe('CheckoutService handlePaymentSuccess bundle inventory deduction', () => {
  function buildBundleSession() {
    return {
      id: 'cs-bundle-1',
      userId: 'user1',
      status: 'ACTIVE',
      bizType: 'NORMAL_GOODS',
      merchantOrderNo: 'BUNDLE-001',
      expectedTotal: 185.9,
      goodsAmount: 176,
      shippingFee: 9.9,
      discountAmount: 0,
      totalCouponDiscount: 0,
      vipDiscountAmount: 0,
      couponInstanceIds: [],
      addressSnapshot: {},
      itemsSnapshot: [
        {
          skuId: 'bundle-sku',
          quantity: 2,
          cartItemId: 'ci-bundle',
          isPrize: false,
          unitPrice: 88,
          companyId: 'bundle-company',
          productSnapshot: {
            productId: 'bundle-product',
            companyId: 'bundle-company',
            productType: 'BUNDLE',
            title: '家庭组合装',
            skuTitle: '家庭组合装',
            image: 'https://img.example.com/bundle-cover.jpg',
            price: 88,
            bundleTotalWeightGram: 2200,
            bundleItems: [
              {
                skuId: 'component-sku-a',
                productId: 'component-product-a',
                productTitle: '苹果',
                skuTitle: '苹果 2kg',
                quantityPerBundle: 2,
                bundleQuantity: 2,
                totalQuantity: 4,
                unitPriceAtCheckout: 18,
                image: 'https://img.example.com/apple.jpg',
                weightGram: 500,
              },
              {
                skuId: 'component-sku-b',
                productId: 'component-product-b',
                productTitle: '橙子',
                skuTitle: '橙子礼盒',
                quantityPerBundle: 1,
                bundleQuantity: 2,
                totalQuantity: 2,
                unitPriceAtCheckout: 26,
                image: 'https://img.example.com/orange.jpg',
                weightGram: 1200,
              },
            ],
          },
        },
      ],
    };
  }

  function buildBundleTx(session: any) {
    return {
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        create: jest.fn(async ({ data }: any) => ({ id: 'order-bundle-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      productSKU: {
        update: jest.fn().mockResolvedValue({ stock: 10 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      inventoryLedger: { create: jest.fn().mockResolvedValue({}) },
      rewardLedger: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart1' }) },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      lotteryRecord: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
  }

  it('deducts component SKU inventory on payment success', async () => {
    const session = buildBundleSession();
    const tx = buildBundleTx(session);
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const svc = new CheckoutService(prisma, {} as any);

    await svc.handlePaymentSuccess('BUNDLE-001', 'trade-bundle-1', '2026-06-22T12:00:00.000Z');

    expect(tx.productSKU.update).toHaveBeenCalledTimes(2);
    expect(tx.productSKU.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'component-sku-a' },
      data: { stock: { decrement: 4 } },
    });
    expect(tx.productSKU.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'component-sku-b' },
      data: { stock: { decrement: 2 } },
    });
    expect(tx.inventoryLedger.create).toHaveBeenCalledWith({
      data: {
        skuId: 'component-sku-a',
        type: 'RESERVE',
        qty: -4,
        refType: 'ORDER',
        refId: 'order-bundle-1',
      },
    });
    expect(tx.inventoryLedger.create).toHaveBeenCalledWith({
      data: {
        skuId: 'component-sku-b',
        type: 'RESERVE',
        qty: -2,
        refType: 'ORDER',
        refId: 'order-bundle-1',
      },
    });
  });

  it('does not deduct bundle selling SKU stock on payment success', async () => {
    const session = buildBundleSession();
    const tx = buildBundleTx(session);
    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const svc = new CheckoutService(prisma, {} as any);

    await svc.handlePaymentSuccess('BUNDLE-001', 'trade-bundle-2', '2026-06-22T12:00:00.000Z');

    expect(tx.productSKU.update).not.toHaveBeenCalledWith({
      where: { id: 'bundle-sku' },
      data: { stock: { decrement: 2 } },
    });
    expect(tx.inventoryLedger.create).not.toHaveBeenCalledWith({
      data: {
        skuId: 'bundle-sku',
        type: 'RESERVE',
        qty: -2,
        refType: 'ORDER',
        refId: 'order-bundle-1',
      },
    });
  });
});

describe('CheckoutExpireService expireSession 资金安全', () => {
  function buildSession(overrides: Partial<any> = {}) {
    return {
      id: 'sess-x',
      rewardId: null,
      couponInstanceIds: [],
      bizType: 'NORMAL_GOODS',
      itemsSnapshot: [],
      merchantOrderNo: 'M-EXP-001',
      paymentChannel: 'ALIPAY',
      expectedTotal: 100,
      ...overrides,
    };
  }

  it('查到 TRADE_SUCCESS 时调用 checkoutService.handlePaymentSuccess 建单（不再仅 return）', async () => {
    const prisma: any = {
      $transaction: jest.fn(),
    };
    const svc = new CheckoutExpireService(prisma);
    svc.setAlipayService({
      isAvailable: () => true,
      queryOrder: async () => ({
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'tx-expire',
        totalAmount: '100.00',
      }),
      closeOrder: jest.fn(),
    });
    const buildSpy = jest.fn().mockResolvedValue({ orderIds: ['o-late'] });
    svc.setCheckoutService({ handlePaymentSuccess: buildSpy });

    await (svc as any).expireSession(buildSession());

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledWith('M-EXP-001', 'tx-expire', expect.any(String));
    // 不应进入 EXPIRED 事务
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('查到 TRADE_SUCCESS 但金额不一致时跳过建单（防篡改）', async () => {
    const prisma: any = {
      $transaction: jest.fn(),
    };
    const svc = new CheckoutExpireService(prisma);
    svc.setAlipayService({
      isAvailable: () => true,
      queryOrder: async () => ({
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'tx',
        totalAmount: '88.00', // 不一致
      }),
      closeOrder: jest.fn(),
    });
    const buildSpy = jest.fn();
    svc.setCheckoutService({ handlePaymentSuccess: buildSpy });

    await (svc as any).expireSession(buildSession({ expectedTotal: 100 }));

    expect(buildSpy).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled(); // 不走 EXPIRED
  });

  it('close 失败时跳过本次 expire（不进入事务，下次 cron 再试）', async () => {
    const prisma: any = {
      $transaction: jest.fn(),
    };
    const svc = new CheckoutExpireService(prisma);
    svc.setAlipayService({
      isAvailable: () => true,
      queryOrder: async () => ({
        tradeStatus: 'WAIT_BUYER_PAY',
        tradeNo: '',
        totalAmount: '',
      }),
      closeOrder: async () => ({ success: false }),
    });
    svc.setCheckoutService({ handlePaymentSuccess: jest.fn() });

    await (svc as any).expireSession(buildSession());

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('close 返 alreadyPaid 时重新 query 并主动建单（不进入 EXPIRED 事务）', async () => {
    const prisma: any = {
      $transaction: jest.fn(),
    };
    const svc = new CheckoutExpireService(prisma);
    const queryMock = jest
      .fn()
      .mockResolvedValueOnce({
        tradeStatus: 'WAIT_BUYER_PAY',
        tradeNo: '',
        totalAmount: '',
      })
      .mockResolvedValueOnce({
        tradeStatus: 'TRADE_SUCCESS',
        tradeNo: 'tx-late-expire',
        totalAmount: '100.00',
      });
    svc.setAlipayService({
      isAvailable: () => true,
      queryOrder: queryMock,
      closeOrder: async () => ({ success: false, alreadyPaid: true }),
    });
    const buildSpy = jest.fn().mockResolvedValue({ orderIds: ['o-late'] });
    svc.setCheckoutService({ handlePaymentSuccess: buildSpy });

    await (svc as any).expireSession(buildSession({ expectedTotal: 100 }));

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(buildSpy).toHaveBeenCalledWith('M-EXP-001', 'tx-late-expire', expect.any(String));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('close 成功（success: true）后才进入 EXPIRED 事务', async () => {
    const txSpy = jest.fn(async (cb: any) => {
      const tx = {
        checkoutSession: { updateMany: async () => ({ count: 1 }) },
        rewardLedger: { updateMany: async () => ({ count: 0 }) },
      };
      return cb(tx);
    });
    const prisma: any = { $transaction: txSpy };
    const svc = new CheckoutExpireService(prisma);
    svc.setAlipayService({
      isAvailable: () => true,
      queryOrder: async () => ({
        tradeStatus: 'WAIT_BUYER_PAY',
        tradeNo: '',
        totalAmount: '',
      }),
      closeOrder: async () => ({ success: true }),
    });
    svc.setCheckoutService({ handlePaymentSuccess: jest.fn() });

    await (svc as any).expireSession(buildSession());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // close 成功后走 EXPIRED
  });

  it('过期会话有 deductionGroupId 时释放消费积分抵扣组', async () => {
    const releaseDeduction = jest.fn().mockResolvedValue(undefined);
    const tx = {
      checkoutSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      rewardLedger: { updateMany: jest.fn() },
    };
    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const svc = new CheckoutExpireService(prisma);
    (svc as any).setRewardDeductionService({ releaseDeduction });

    await (svc as any).expireSession(buildSession({
      paymentChannel: null,
      merchantOrderNo: null,
      rewardId: 'legacy-ledger',
      deductionGroupId: 'DG-1',
    }));

    expect(releaseDeduction).toHaveBeenCalledWith(tx, 'DG-1');
    expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * FAILED notify 释放会话资源测试 — releaseSessionOnFailure 行为校验
 *
 * 由于 PaymentService 的 notify 路径需要构造大量上下文（CheckoutSession +
 * SnapshotItem + InventoryLedger 等），完整集成测试在单测层成本太高。
 * 此处验证 PaymentService 只委托 CheckoutService 释放失败会话资源。
 */
describe('PaymentService VIP FAILED notify 契约', () => {
  it('VIP 支付失败时 PaymentService 应委托 checkoutService.releaseSessionOnFailure', async () => {
    const { PaymentService } = await import('../payment/payment.service');

    const prisma: any = {
      $transaction: jest.fn(),
      // FAILED 分支不直接读 prisma，但 PaymentService 构造需 prisma 引用
    };

    const releaseSessionOnFailure = jest.fn().mockResolvedValue(undefined);
    const checkoutService: any = {
      findByMerchantOrderNo: jest.fn().mockResolvedValue({
        id: 'cs-vip-1',
        merchantOrderNo: 'MO-VIP-1',
        bizType: 'VIP_PACKAGE',
        itemsSnapshot: [{ skuId: 's1', quantity: 1, unitPrice: 399, productSnapshot: {} }],
        rewardId: null,
        couponInstanceIds: [],
        status: 'ACTIVE',
      }),
      releaseSessionOnFailure,
      releaseVipReservationInTx: jest.fn(),
    };

    // 构造 PaymentService（依赖：prisma, configService, alipayService, checkoutService?, couponService?, inboxService?）
    const configService: any = { get: () => undefined };
    const alipayService: any = {};
    const svc = new (PaymentService as any)(
      prisma,
      configService,
      alipayService,
      checkoutService,
      undefined, // couponService（VIP FAILED 分支：couponInstanceIds 空，不会被调）
      undefined, // inboxService
    );

    // 触发 FAILED 路径（skipSignatureVerification=true 跳过签名校验）
    await svc.handlePaymentCallback({
      merchantOrderNo: 'MO-VIP-1',
      providerTxnId: 'tx-failed-1',
      status: 'FAILED',
      paidAt: new Date().toISOString(),
      skipSignatureVerification: true,
    });

    expect(releaseSessionOnFailure).toHaveBeenCalledTimes(1);
    expect(releaseSessionOnFailure).toHaveBeenCalledWith('MO-VIP-1');
    expect(checkoutService.releaseVipReservationInTx).not.toHaveBeenCalled();
  });

  it('NORMAL_GOODS 支付失败时也委托 releaseSessionOnFailure（内部按类型释放资源）', async () => {
    const { PaymentService } = await import('../payment/payment.service');

    const prisma: any = {
      $transaction: jest.fn(),
    };

    const releaseSessionOnFailure = jest.fn().mockResolvedValue(undefined);
    const releaseVipReservationInTx = jest.fn();
    const checkoutService: any = {
      findByMerchantOrderNo: jest.fn().mockResolvedValue({
        id: 'cs-normal-1',
        merchantOrderNo: 'MO-NORMAL-1',
        bizType: 'NORMAL_GOODS',
        itemsSnapshot: [],
        rewardId: null,
        couponInstanceIds: [],
        status: 'ACTIVE',
      }),
      releaseSessionOnFailure,
      releaseVipReservationInTx,
    };

    const svc = new (PaymentService as any)(
      prisma,
      { get: () => undefined },
      {},
      checkoutService,
      undefined,
      undefined,
    );

    await svc.handlePaymentCallback({
      merchantOrderNo: 'MO-NORMAL-1',
      providerTxnId: 'tx-failed-2',
      status: 'FAILED',
      skipSignatureVerification: true,
    });

    expect(releaseSessionOnFailure).toHaveBeenCalledTimes(1);
    expect(releaseSessionOnFailure).toHaveBeenCalledWith('MO-NORMAL-1');
    // PaymentService 不再直接决定 VIP 库存释放；具体资源释放在 CheckoutService 内完成。
    expect(releaseVipReservationInTx).not.toHaveBeenCalled();
  });
});
