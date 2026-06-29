import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PLATFORM_COMPANY_ID } from '../bonus/engine/constants';
import { CheckoutService } from '../order/checkout.service';
import { GroupBuyCheckoutService } from './group-buy-checkout.service';

describe('GroupBuyCheckoutService', () => {
  const serializableOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  };

  const dto = {
    activityId: 'activity_1',
    addressId: 'address_1',
    paymentChannel: 'wechat',
    expectedTotal: 1000,
    idempotencyKey: 'idem_1',
  };

  const buildActivity = () => ({
    id: 'activity_1',
    title: '大龙虾团购',
    productId: 'product_1',
    skuId: 'sku_1',
    price: 1000,
    freeShipping: true,
    status: 'ACTIVE',
    startAt: null,
    endAt: new Date('2099-06-01T00:00:00.000Z'),
    product: {
      id: 'product_1',
      title: '大龙虾',
      companyId: PLATFORM_COMPANY_ID,
      status: 'ACTIVE',
      media: [{ url: 'https://example.com/lobster.jpg' }],
    },
    sku: {
      id: 'sku_1',
      title: '一只装',
      status: 'ACTIVE',
      stock: 8,
      weightGram: 1500,
    },
    tiers: [
      { sequence: 1, basisPoints: 1000, label: '第一位好友' },
      { sequence: 2, basisPoints: 2000, label: '第二位好友' },
      { sequence: 3, basisPoints: 7000, label: '第三位好友' },
    ],
  });

  const buildPrisma = () => {
    const tx = {
      groupBuyActivity: {
        findUnique: jest.fn().mockResolvedValue(buildActivity()),
      },
      groupBuyInstance: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      groupBuyCode: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      groupBuyReferral: {
        count: jest.fn().mockResolvedValue(0),
      },
      ruleConfig: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      address: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'address_1',
          userId: 'user_1',
          recipientName: '张三',
          phone: '13800000000',
          regionCode: '110101',
          regionText: '北京市 东城区',
          detail: '测试地址 1 号',
        }),
      },
      checkoutSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'session_1',
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
      checkoutSession: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    return { prisma, tx, service: new (GroupBuyCheckoutService as any)(prisma) as GroupBuyCheckoutService };
  };

  it('rejects reward deduction and coupon fields because group-buy checkout is cash-only', async () => {
    const { tx, service } = buildPrisma();

    await expect(service.createCheckout('user_1', {
      ...dto,
      deductionAmount: 1,
      rewardId: 'reward_1',
      groupBuyRebateDeductionAmount: 1,
      couponInstanceIds: ['coupon_1'],
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it.each([
    ['discountAmount', { discountAmount: 1 }],
    ['discountAmount=0', { discountAmount: 0 }],
    ['vipDiscountAmount', { vipDiscountAmount: 1 }],
    ['vipDiscountAmount=null', { vipDiscountAmount: null }],
    ['totalCouponDiscount', { totalCouponDiscount: 1 }],
    ['totalCouponDiscount=0', { totalCouponDiscount: 0 }],
    ['couponPerAmounts', { couponPerAmounts: [{ couponInstanceId: 'coupon_1', discountAmount: 1 }] }],
    ['couponPerAmounts=[]', { couponPerAmounts: [] }],
  ])('rejects dirty %s field because group-buy checkout is cash-only', async (_field, dirtyPayload) => {
    const { tx, service } = buildPrisma();

    await expect(service.createCheckout('user_1', {
      ...dto,
      ...dirtyPayload,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('rejects group-buy rebate deduction because group-buy checkout is cash-only', async () => {
    const { tx, service } = buildPrisma();

    await expect(service.createCheckout('user_1', {
      ...dto,
      groupBuyRebateDeductionAmount: 1,
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('rejects checkout when the user already has an occupying group-buy instance', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findFirst.mockResolvedValueOnce({ id: 'instance_1', status: 'SHARING' });

    await expect(service.createCheckout('user_1', dto as any)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.groupBuyInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user_1',
        activity: expect.objectContaining({
          status: { not: 'ENDED' },
          deletedAt: null,
          endAt: { gt: expect.any(Date) },
        }),
      }),
    }));
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('rejects checkout when a group-buy activity has no end time', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyActivity.findUnique.mockResolvedValueOnce({
      ...buildActivity(),
      endAt: null,
    });

    await expect(service.createCheckout('user_1', dto as any))
      .rejects.toThrow('团购活动结束时间配置异常');
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('uses configured monthly launch limit instead of a hard-coded value', async () => {
    const { tx, service } = buildPrisma();
    tx.ruleConfig.findUnique.mockResolvedValueOnce({
      key: 'GROUP_BUY_MAX_MONTHLY_LAUNCHES',
      value: { value: 2 },
    });
    tx.groupBuyInstance.count.mockResolvedValueOnce(2);

    await expect(service.createCheckout('user_1', dto as any))
      .rejects.toThrow('本月团购参与次数已用完');
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('rejects using the buyer own share code', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyCode.findUnique.mockResolvedValueOnce({
      id: 'code_1',
      code: 'GB123456',
      status: 'ACTIVE',
      instance: {
        id: 'instance_referrer',
        userId: 'user_1',
        activityId: 'activity_1',
        status: 'SHARING',
      },
    });

    await expect(service.createCheckout('user_1', {
      ...dto,
      shareCode: 'GB123456',
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('rejects checkout before payment when a share code has no remaining slots', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyCode.findUnique.mockResolvedValueOnce({
      id: 'code_1',
      code: 'GB123456',
      status: 'ACTIVE',
      instance: {
        id: 'instance_referrer',
        userId: 'user_2',
        activityId: 'activity_1',
        status: 'SHARING',
        tierSnapshot: [
          { sequence: 1, basisPoints: 1000, label: '第一位好友' },
          { sequence: 2, basisPoints: 2000, label: '第二位好友' },
          { sequence: 3, basisPoints: 7000, label: '第三位好友' },
        ],
      },
    });
    tx.groupBuyReferral.count.mockResolvedValueOnce(3);

    await expect(service.createCheckout('user_1', {
      ...dto,
      shareCode: 'GB123456',
    } as any)).rejects.toThrow('团购推荐码名额已满');
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('uses the referrer locked tier snapshot instead of the current activity tiers when checking share-code slots', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyActivity.findUnique.mockResolvedValueOnce({
      ...buildActivity(),
      tiers: [
        { sequence: 1, basisPoints: 5000, label: '第一位好友' },
        { sequence: 2, basisPoints: 5000, label: '第二位好友' },
      ],
    });
    tx.groupBuyCode.findUnique.mockResolvedValueOnce({
      id: 'code_1',
      code: 'GB123456',
      status: 'ACTIVE',
      instance: {
        id: 'instance_referrer',
        userId: 'user_2',
        activityId: 'activity_1',
        status: 'SHARING',
        tierSnapshot: [
          { sequence: 1, basisPoints: 1000, label: '第一位好友' },
          { sequence: 2, basisPoints: 2000, label: '第二位好友' },
          { sequence: 3, basisPoints: 7000, label: '第三位好友' },
        ],
      },
    });
    tx.groupBuyReferral.count.mockResolvedValueOnce(2);

    await service.createCheckout('user_1', {
      ...dto,
      shareCode: 'GB123456',
    } as any);

    expect(tx.checkoutSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bizMeta: expect.objectContaining({
          groupBuyCodeId: 'code_1',
          referredByInstanceId: 'instance_referrer',
        }),
      }),
    }));
  });

  it('uses referrer tier snapshot length for share-code capacity before payment', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyCode.findUnique.mockResolvedValueOnce({
      id: 'code_1',
      code: 'GB123456',
      status: 'ACTIVE',
      instance: {
        id: 'instance_referrer',
        userId: 'user_2',
        activityId: 'activity_1',
        status: 'SHARING',
        tierSnapshot: [
          { sequence: 1, basisPoints: 1000, label: '推荐人第一档' },
          { sequence: 2, basisPoints: 2000, label: '推荐人第二档' },
        ],
      },
    });
    tx.groupBuyReferral.count.mockResolvedValueOnce(2);

    await expect(service.createCheckout('user_1', {
      ...dto,
      shareCode: 'GB123456',
    } as any)).rejects.toThrow('团购推荐码名额已满');
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('creates a cash-only GROUP_BUY checkout session with locked activity snapshots', async () => {
    const { prisma, tx, service } = buildPrisma();
    const wechatPayService = {
      isAvailable: jest.fn().mockReturnValue(true),
      createAppOrder: jest.fn().mockResolvedValue({ prepayId: 'prepay_1' }),
    };
    service.setWechatPayService(wechatPayService as any);

    const result = await service.createCheckout('user_1', dto as any);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializableOptions);
    expect(tx.checkoutSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user_1',
        bizType: 'GROUP_BUY',
        goodsAmount: 1000,
        expectedTotal: 1000,
        shippingFee: 0,
        discountAmount: 0,
        vipDiscountAmount: 0,
        rewardId: null,
        deductionGroupId: null,
        couponInstanceIds: [],
        totalCouponDiscount: 0,
        bizMeta: expect.objectContaining({
          groupBuyActivityId: 'activity_1',
          groupBuyCodeId: null,
          groupBuyPriceSnapshot: 1000,
          freeShippingSnapshot: true,
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '第一位好友' },
            { sequence: 2, basisPoints: 2000, label: '第二位好友' },
            { sequence: 3, basisPoints: 7000, label: '第三位好友' },
          ],
        }),
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      sessionId: 'session_1',
      expectedTotal: 1000,
      goodsAmount: 1000,
      discountAmount: 0,
      paymentParams: { channel: 'wechat', prepayId: 'prepay_1' },
    }));
    expect(wechatPayService.createAppOrder).toHaveBeenCalledWith(expect.objectContaining({
      outTradeNo: expect.stringMatching(/^GB/),
      amount: 1000,
      description: expect.stringMatching(/^爱买买团购订单-/),
    }));
  });

  it('charges configured shipping for non-free-shipping group-buy activities', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyActivity.findUnique.mockResolvedValueOnce({
      ...buildActivity(),
      freeShipping: false,
    });
    const shippingRuleService = {
      calculateShippingDetail: jest.fn().mockResolvedValue({ fee: 12.34 }),
    };
    (service as any).setShippingRuleService(shippingRuleService);

    const result = await service.createCheckout('user_1', {
      ...dto,
      expectedTotal: 1012.34,
    } as any);

    expect(shippingRuleService.calculateShippingDetail).toHaveBeenCalledWith(
      1000,
      '110101',
      1500,
      tx,
    );
    expect(tx.checkoutSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        goodsAmount: 1000,
        shippingFee: 12.34,
        expectedTotal: 1012.34,
        bizMeta: expect.objectContaining({
          freeShippingSnapshot: false,
          shippingFeeSnapshot: 12.34,
        }),
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      expectedTotal: 1012.34,
      shippingFee: 12.34,
    }));
  });

  it('previews non-free-shipping payable amount before creating a payment session', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyActivity.findUnique.mockResolvedValueOnce({
      ...buildActivity(),
      freeShipping: false,
    });
    const shippingRuleService = {
      calculateShippingDetail: jest.fn().mockResolvedValue({ fee: 12.34 }),
    };
    service.setShippingRuleService(shippingRuleService as any);

    const result = await service.previewCheckout('user_1', {
      ...dto,
      expectedTotal: undefined,
    } as any);

    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      expectedTotal: 1012.34,
      goodsAmount: 1000,
      shippingFee: 12.34,
      discountAmount: 0,
    });
  });

  it('creates multi-item snapshots whose line totals equal the configured group-buy price', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyActivity.findUnique.mockResolvedValueOnce({
      ...buildActivity(),
      price: 999,
      freeShipping: false,
      items: [
        {
          productId: 'product_1',
          skuId: 'sku_1',
          quantity: 1,
          sortOrder: 0,
          product: {
            id: 'product_1',
            title: '大龙虾',
            companyId: PLATFORM_COMPANY_ID,
            status: 'ACTIVE',
            media: [{ url: 'https://example.com/lobster.jpg' }],
          },
          sku: {
            id: 'sku_1',
            title: '一只装',
            status: 'ACTIVE',
            price: 600,
            stock: 8,
            weightGram: 1500,
          },
        },
        {
          productId: 'product_2',
          skuId: 'sku_2',
          quantity: 2,
          sortOrder: 1,
          product: {
            id: 'product_2',
            title: '鲍鱼',
            companyId: PLATFORM_COMPANY_ID,
            status: 'ACTIVE',
            media: [{ url: 'https://example.com/abalone.jpg' }],
          },
          sku: {
            id: 'sku_2',
            title: '六只装',
            status: 'ACTIVE',
            price: 200,
            stock: 6,
            weightGram: 500,
          },
        },
      ],
    });
    const shippingRuleService = {
      calculateShippingDetail: jest.fn().mockResolvedValue({ fee: 20 }),
    };
    service.setShippingRuleService(shippingRuleService as any);

    await service.createCheckout('user_1', {
      ...dto,
      expectedTotal: 1019,
    } as any);

    expect(shippingRuleService.calculateShippingDetail).toHaveBeenCalledWith(
      999,
      '110101',
      2500,
      tx,
    );
    const createdData = tx.checkoutSession.create.mock.calls[0][0].data;
    expect(createdData.itemsSnapshot).toEqual([
      expect.objectContaining({
        skuId: 'sku_1',
        quantity: 1,
        unitPrice: 599.4,
      }),
      expect.objectContaining({
        skuId: 'sku_2',
        quantity: 2,
        unitPrice: 199.8,
      }),
    ]);
    const snapshotTotal = createdData.itemsSnapshot.reduce(
      (sum: number, item: any) => sum + item.unitPrice * item.quantity,
      0,
    );
    expect(Number(snapshotTotal.toFixed(2))).toBe(999);
    expect(createdData.goodsAmount).toBe(999);
    expect(createdData.expectedTotal).toBe(1019);
  });
});

describe('CheckoutService group-buy payment success integration', () => {
  const buildCheckoutHarness = (bizMetaOverrides: Record<string, unknown> = {}) => {
    const session = {
      id: 'session_1',
      userId: 'user_1',
      status: 'ACTIVE',
      bizType: 'GROUP_BUY',
      merchantOrderNo: 'GB_ORDER_1',
      providerTxnId: null,
      expectedTotal: 1000,
      goodsAmount: 1000,
      shippingFee: 0,
      discountAmount: 0,
      vipDiscountAmount: 0,
      totalCouponDiscount: 0,
      couponInstanceIds: [],
      couponPerAmounts: [],
      rewardId: null,
      deductionGroupId: null,
      buyerNote: null,
      addressSnapshot: { encrypted: true },
      bizMeta: {
        groupBuyActivityId: 'activity_1',
        groupBuyCodeId: null,
        referredByInstanceId: null,
        groupBuyPriceSnapshot: 1000,
        freeShippingSnapshot: true,
        shippingFeeSnapshot: 0,
        tierSnapshot: [
          { sequence: 1, basisPoints: 1000, label: '第一位好友' },
          { sequence: 2, basisPoints: 2000, label: '第二位好友' },
          { sequence: 3, basisPoints: 7000, label: '第三位好友' },
        ],
        ...bizMetaOverrides,
      },
      itemsSnapshot: [
        {
          skuId: 'sku_1',
          quantity: 1,
          isPrize: false,
          unitPrice: 1000,
          companyId: PLATFORM_COMPANY_ID,
          productSnapshot: {
            productId: 'product_1',
            title: '大龙虾',
            skuTitle: '一只装',
            image: '',
            price: 1000,
            isPrize: false,
          },
        },
      ],
    };

    const tx = {
      checkoutSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: session.id }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'order_1' }),
      },
      orderStatusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'history_1' }),
      },
      productSKU: {
        update: jest.fn().mockResolvedValue({ id: 'sku_1', stock: 7 }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      inventoryLedger: {
        create: jest.fn().mockResolvedValue({ id: 'ledger_1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      cart: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      cartItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      lotteryRecord: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      groupBuyCode: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      groupBuyInstance: {
        create: jest.fn().mockResolvedValue({ id: 'new_instance_1' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'referrer_instance_1',
          status: 'SHARING',
          activity: {
            id: 'activity_1',
            status: 'ACTIVE',
            startAt: null,
            endAt: new Date('2099-06-01T00:00:00.000Z'),
            deletedAt: null,
          },
          tierSnapshot: [
            { sequence: 1, basisPoints: 1000, label: '第一位好友' },
            { sequence: 2, basisPoints: 2000, label: '第二位好友' },
            { sequence: 3, basisPoints: 7000, label: '第三位好友' },
          ],
        }),
        update: jest.fn().mockResolvedValue({ id: 'referrer_instance_1' }),
      },
      groupBuyReferral: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'referral_1' }),
      },
      groupBuyActivity: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'activity_1',
          status: 'ACTIVE',
          startAt: null,
          endAt: new Date('2099-06-01T00:00:00.000Z'),
          deletedAt: null,
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const service = new CheckoutService(prisma as any, {} as any);
    const groupBuyRebateService = {
      createPendingReferralAfterPayment: jest.fn().mockResolvedValue({ status: 'PENDING_CREATED' }),
    };
    service.setGroupBuyRebateService(groupBuyRebateService as any);
    return { service, tx };
  };

  it('creates a group-buy order with an active own instance and share code after payment success', async () => {
    const { service, tx } = buildCheckoutHarness();
    const paidAt = '2026-06-29T08:00:00.000Z';

    const result = await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1', paidAt);

    expect(result.orderIds).toEqual(['order_1']);
    expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bizType: 'GROUP_BUY' }),
    }));
    const sessionPaidAt = tx.checkoutSession.updateMany.mock.calls[0][0].data.paidAt;
    const orderPaidAt = tx.order.create.mock.calls[0][0].data.paidAt;
    const instanceCreateData = tx.groupBuyInstance.create.mock.calls[0][0].data;
    expect(sessionPaidAt.toISOString()).toBe(paidAt);
    expect(orderPaidAt).toBe(sessionPaidAt);
    expect(instanceCreateData.activatedAt).toBe(sessionPaidAt);
    expect(instanceCreateData.code.create.activatedAt).toBe(sessionPaidAt);
    expect(tx.groupBuyInstance.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user_1',
        activityId: 'activity_1',
        initiatorOrderId: 'order_1',
        status: 'SHARING',
        activatedAt: expect.any(Date),
        priceSnapshot: 1000,
        freeShippingSnapshot: true,
        code: {
          create: expect.objectContaining({
            code: expect.any(String),
            status: 'ACTIVE',
            activatedAt: expect.any(Date),
          }),
        },
      }),
    }));
    expect(tx.groupBuyCode.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { code: expect.any(String) },
      select: { id: true },
    }));
  });

  it('does not create a second group-buy instance or code on payment callback retry', async () => {
    const { service, tx } = buildCheckoutHarness();
    let sessionStatus = 'ACTIVE';
    tx.checkoutSession.findUnique.mockImplementation(async ({ where }: any) => ({
      id: 'session_1',
      userId: 'user_1',
      status: sessionStatus,
      bizType: 'GROUP_BUY',
      merchantOrderNo: where?.merchantOrderNo ?? 'GB_ORDER_1',
      providerTxnId: sessionStatus === 'ACTIVE' ? null : 'provider_txn_1',
      expectedTotal: 1000,
      goodsAmount: 1000,
      shippingFee: 0,
      discountAmount: 0,
      vipDiscountAmount: 0,
      totalCouponDiscount: 0,
      couponInstanceIds: [],
      couponPerAmounts: [],
      rewardId: null,
      deductionGroupId: null,
      buyerNote: null,
      addressSnapshot: { encrypted: true },
      bizMeta: {
        groupBuyActivityId: 'activity_1',
        groupBuyCodeId: null,
        referredByInstanceId: null,
        groupBuyPriceSnapshot: 1000,
        freeShippingSnapshot: true,
        shippingFeeSnapshot: 0,
        tierSnapshot: [
          { sequence: 1, basisPoints: 1000, label: '第一位好友' },
          { sequence: 2, basisPoints: 2000, label: '第二位好友' },
          { sequence: 3, basisPoints: 7000, label: '第三位好友' },
        ],
      },
      itemsSnapshot: [
        {
          skuId: 'sku_1',
          quantity: 1,
          isPrize: false,
          unitPrice: 1000,
          companyId: PLATFORM_COMPANY_ID,
          productSnapshot: {
            productId: 'product_1',
            title: '大龙虾',
            skuTitle: '一只装',
            image: '',
            price: 1000,
            isPrize: false,
          },
        },
      ],
    }));
    tx.checkoutSession.updateMany.mockImplementation(async () => {
      if (sessionStatus !== 'ACTIVE') return { count: 0 };
      sessionStatus = 'PAID';
      return { count: 1 };
    });
    tx.checkoutSession.update.mockImplementation(async () => {
      sessionStatus = 'COMPLETED';
      return { id: 'session_1', status: 'COMPLETED' };
    });
    tx.order.findMany.mockResolvedValue([{ id: 'order_1' }]);

    await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');
    const retryResult = await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(retryResult.orderIds).toEqual(['order_1']);
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.groupBuyInstance.create).toHaveBeenCalledTimes(1);
    expect(tx.groupBuyCode.findUnique).toHaveBeenCalledTimes(1);
  });

  it('keeps the paid order but expires the own qualification when payment callback runs after activity end', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
    });
    tx.groupBuyActivity.findUnique.mockResolvedValueOnce({
      id: 'activity_1',
      status: 'ENDED',
      startAt: null,
      endAt: new Date('2026-06-01T00:00:00.000Z'),
      deletedAt: null,
    });

    const result = await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(result.orderIds).toEqual(['order_1']);
    expect(tx.groupBuyInstance.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'EXPIRED',
        expiredAt: expect.any(Date),
        invalidReason: 'ACTIVITY_ENDED',
      }),
    }));
    expect(tx.groupBuyReferral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'INVALID',
        candidateSequence: null,
        effectiveSequence: null,
        invalidReason: 'ACTIVITY_ENDED_AFTER_PAYMENT',
      }),
    }));
    expect(tx.groupBuyInstance.update).not.toHaveBeenCalled();
  });

  it('keeps paid qualification and referral candidate when payment callback runs after a temporary activity pause', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
    });
    tx.groupBuyActivity.findUnique.mockResolvedValueOnce({
      id: 'activity_1',
      status: 'PAUSED',
      startAt: null,
      endAt: new Date('2099-06-01T00:00:00.000Z'),
      deletedAt: null,
    });
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce({
      id: 'referrer_instance_1',
      status: 'SHARING',
      activity: {
        id: 'activity_1',
        status: 'PAUSED',
        startAt: null,
        endAt: new Date('2099-06-01T00:00:00.000Z'),
        deletedAt: null,
      },
      tierSnapshot: [
        { sequence: 1, basisPoints: 1000, label: '第一位好友' },
        { sequence: 2, basisPoints: 2000, label: '第二位好友' },
        { sequence: 3, basisPoints: 7000, label: '第三位好友' },
      ],
    });

    const result = await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(result.orderIds).toEqual(['order_1']);
    expect(tx.groupBuyInstance.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'QUALIFICATION_PENDING',
      }),
    }));
    expect(tx.groupBuyReferral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANDIDATE',
        candidateSequence: 1,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referrer_instance_1' },
      data: { candidateCount: { increment: 1 } },
    }));
  });

  it('creates a candidate referral when the paid checkout used a share code', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
    });

    await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(tx.groupBuyReferral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        instanceId: 'referrer_instance_1',
        codeId: 'code_1',
        status: 'CANDIDATE',
        referredUserId: 'user_1',
        referredOrderId: 'order_1',
        referredInstanceId: 'new_instance_1',
        candidateSequence: 1,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referrer_instance_1' },
      data: { candidateCount: { increment: 1 } },
    }));
  });

  it('reuses the lowest available candidate sequence after an earlier referral became invalid', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
    });
    tx.groupBuyReferral.count.mockResolvedValueOnce(1);
    tx.groupBuyReferral.findMany.mockResolvedValueOnce([
      { candidateSequence: 2 },
    ]);

    await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(tx.groupBuyReferral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANDIDATE',
        candidateSequence: 1,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referrer_instance_1' },
      data: { candidateCount: { increment: 1 } },
    }));
  });

  it('uses the referrer locked tier snapshot when assigning a candidate after activity tiers changed', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
      tierSnapshot: [
        { sequence: 1, basisPoints: 5000, label: '第一位好友' },
        { sequence: 2, basisPoints: 5000, label: '第二位好友' },
      ],
    });
    tx.groupBuyReferral.findMany.mockResolvedValueOnce([
      { candidateSequence: 1 },
      { candidateSequence: 2 },
    ]);

    await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(tx.groupBuyReferral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANDIDATE',
        candidateSequence: 3,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referrer_instance_1' },
      data: { candidateCount: { increment: 1 } },
    }));
  });

  it('records an invalid referral when the referrer terminated after checkout but before payment callback', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
    });
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce({
      id: 'referrer_instance_1',
      status: 'TERMINATED',
      tierSnapshot: [
        { sequence: 1, basisPoints: 1000, label: '第一位好友' },
        { sequence: 2, basisPoints: 2000, label: '第二位好友' },
        { sequence: 3, basisPoints: 7000, label: '第三位好友' },
      ],
    });

    await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(tx.groupBuyReferral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'INVALID',
        candidateSequence: null,
        effectiveSequence: null,
        invalidReason: 'REFERRER_NOT_SHARING_AFTER_PAYMENT',
      }),
    }));
    expect(tx.groupBuyInstance.update).not.toHaveBeenCalled();
  });

  it('keeps the paid group-buy order successful and records an invalid referral when share-code slots are filled before payment callback', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
    });
    tx.groupBuyReferral.findMany.mockResolvedValueOnce([
      { candidateSequence: 1 },
      { candidateSequence: 2 },
      { candidateSequence: 3 },
    ]);

    const result = await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(result.orderIds).toEqual(['order_1']);
    expect(tx.order.create).toHaveBeenCalled();
    expect(tx.groupBuyInstance.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user_1',
        status: 'QUALIFICATION_PENDING',
      }),
    }));
    expect(tx.groupBuyReferral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        instanceId: 'referrer_instance_1',
        codeId: 'code_1',
        status: 'INVALID',
        referredUserId: 'user_1',
        referredOrderId: 'order_1',
        referredInstanceId: 'new_instance_1',
        candidateSequence: null,
        effectiveSequence: null,
        invalidReason: 'SLOT_FULL_AFTER_PAYMENT',
      }),
    }));
    expect(tx.groupBuyInstance.update).not.toHaveBeenCalled();
  });

  it('retries the next available candidate sequence when candidate sequence races after payment callback', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
    });
    tx.groupBuyReferral.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ candidateSequence: 1 }]);
    tx.groupBuyReferral.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 'referral_2' });

    const result = await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(result.orderIds).toEqual(['order_1']);
    expect(tx.groupBuyReferral.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANDIDATE',
        candidateSequence: 1,
      }),
    }));
    expect(tx.groupBuyReferral.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        status: 'CANDIDATE',
        candidateSequence: 2,
      }),
    }));
    expect(tx.groupBuyInstance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'referrer_instance_1' },
      data: { candidateCount: { increment: 1 } },
    }));
  });

  it('records an invalid referral when a candidate sequence race leaves no remaining slot', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
    });
    tx.groupBuyReferral.findMany
      .mockResolvedValueOnce([{ candidateSequence: 1 }, { candidateSequence: 2 }])
      .mockResolvedValueOnce([
        { candidateSequence: 1 },
        { candidateSequence: 2 },
        { candidateSequence: 3 },
      ]);
    tx.groupBuyReferral.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ id: 'invalid_referral_1' });

    await service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1');

    expect(tx.groupBuyReferral.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        status: 'INVALID',
        candidateSequence: null,
        effectiveSequence: null,
        invalidReason: 'REFERRAL_SEQUENCE_CONFLICT_AFTER_PAYMENT',
      }),
    }));
    expect(tx.groupBuyInstance.update).not.toHaveBeenCalled();
  });

  it('uses referrer tier snapshot length for payment-time referral capacity', async () => {
    const { service, tx } = buildCheckoutHarness({
      groupBuyCodeId: 'code_1',
      referredByInstanceId: 'referrer_instance_1',
      tierSnapshot: [
        { sequence: 1, basisPoints: 1000, label: '当前第一档' },
        { sequence: 2, basisPoints: 2000, label: '当前第二档' },
        { sequence: 3, basisPoints: 7000, label: '当前第三档' },
      ],
    });
    tx.groupBuyInstance.findUnique.mockResolvedValueOnce({
      id: 'referrer_instance_1',
      tierSnapshot: [
        { sequence: 1, basisPoints: 1000, label: '推荐人第一档' },
        { sequence: 2, basisPoints: 2000, label: '推荐人第二档' },
      ],
    });
    tx.groupBuyReferral.count.mockResolvedValueOnce(2);

    await expect(service.handlePaymentSuccess('GB_ORDER_1', 'provider_txn_1'))
      .rejects.toThrow('团购推荐码名额已满');
    expect(tx.groupBuyReferral.create).not.toHaveBeenCalled();
  });
});
