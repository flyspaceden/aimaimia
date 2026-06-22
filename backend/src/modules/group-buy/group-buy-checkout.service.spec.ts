import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PLATFORM_COMPANY_ID } from '../bonus/engine/constants';
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
    endAt: null,
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
      couponInstanceIds: ['coupon_1'],
    } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.checkoutSession.create).not.toHaveBeenCalled();
  });

  it('rejects checkout when the user already has an occupying group-buy instance', async () => {
    const { tx, service } = buildPrisma();
    tx.groupBuyInstance.findFirst.mockResolvedValueOnce({ id: 'instance_1', status: 'SHARING' });

    await expect(service.createCheckout('user_1', dto as any)).rejects.toBeInstanceOf(ConflictException);
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
});
