import { NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AfterSaleOperatorType, AfterSaleType } from '@prisma/client';
import { AFTER_SALE_CONFIG_KEYS } from './after-sale.constants';
import { AfterSaleController } from './after-sale.controller';
import { AfterSaleService } from './after-sale.service';

function makeService(order: any) {
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
    },
    product: {
      findUnique: jest.fn().mockResolvedValue({
        returnPolicy: 'RETURNABLE',
        categoryId: null,
      }),
    },
    category: {
      findUnique: jest.fn(),
    },
    ruleConfig: {
      findUnique: jest.fn(({ where }: any) => {
        const values: Record<string, number> = {
          [AFTER_SALE_CONFIG_KEYS.RETURN_WINDOW_DAYS]: 7,
          [AFTER_SALE_CONFIG_KEYS.NORMAL_RETURN_DAYS]: 7,
          [AFTER_SALE_CONFIG_KEYS.FRESH_RETURN_HOURS]: 24,
          [AFTER_SALE_CONFIG_KEYS.RETURN_NO_SHIP_THRESHOLD]: 50,
          [AFTER_SALE_CONFIG_KEYS.RETURN_SHIPPING_FEE_DEFAULT]: 10,
        };
        return Promise.resolve({ key: where.key, value: values[where.key] });
      }),
    },
  };

  return new AfterSaleService(prisma as any, {} as any, {} as any);
}

function makeServiceWithShippingRule(order: any, shippingRuleService: any) {
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
    },
    product: {
      findUnique: jest.fn().mockResolvedValue({
        returnPolicy: 'RETURNABLE',
        categoryId: null,
      }),
    },
    category: {
      findUnique: jest.fn(),
    },
    ruleConfig: {
      findUnique: jest.fn(({ where }: any) => {
        const values: Record<string, number> = {
          [AFTER_SALE_CONFIG_KEYS.RETURN_WINDOW_DAYS]: 7,
          [AFTER_SALE_CONFIG_KEYS.NORMAL_RETURN_DAYS]: 7,
          [AFTER_SALE_CONFIG_KEYS.FRESH_RETURN_HOURS]: 24,
          [AFTER_SALE_CONFIG_KEYS.RETURN_NO_SHIP_THRESHOLD]: 50,
          [AFTER_SALE_CONFIG_KEYS.RETURN_SHIPPING_FEE_DEFAULT]: 10,
        };
        return Promise.resolve({ key: where.key, value: values[where.key] });
      }),
    },
  };

  const service = new AfterSaleService(
    prisma as any,
    {} as any,
    {} as any,
  );
  service.setShippingRuleService(shippingRuleService);
  return service;
}

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    status: 'DELIVERED',
    bizType: 'NORMAL_GOODS',
    deliveredAt: new Date(),
    receivedAt: null,
    goodsAmount: 5,
    totalCouponDiscount: 0,
    discountAmount: 0,
    vipDiscountAmount: 0,
    shippingFee: 0,
    items: [
      {
        id: 'item-1',
        skuId: 'sku-1',
        sku: { productId: 'product-1' },
        productSnapshot: { title: '苹果' },
        unitPrice: 5,
        quantity: 1,
        isPrize: false,
        afterSaleRequests: [],
      },
    ],
    ...overrides,
  };
}

describe('AfterSaleService.getEligibility', () => {
  it('returns no self-service options for paid group-buy orders and tells buyer to contact support', async () => {
    const service = makeService(makeOrder({
      status: 'RECEIVED',
      bizType: 'GROUP_BUY',
    }));

    const result = await service.getEligibility('user-1', 'order-1');

    expect(result.eligible).toBe(false);
    expect(result.disabledReason).toContain('团购订单支付后不支持退换货');
    expect(result.disabledReason).toContain('收货后24小时内质量问题请联系客服补货');
    expect(result.items).toEqual([]);
  });

  it('returns group-buy support wording even when group-buy order status is not after-sale eligible', async () => {
    const service = makeService(makeOrder({
      status: 'PAID',
      bizType: 'GROUP_BUY',
    }));

    const result = await service.getEligibility('user-1', 'order-1');

    expect(result.eligible).toBe(false);
    expect(result.disabledReason).toBe(
      '团购订单支付后不支持退换货；收货后24小时内质量问题请联系客服补货。',
    );
    expect(result.items).toEqual([]);
  });

  it('无理由退货退款不足抵扣退货运费时不扣减退款并要求买家支付运费', async () => {
    const service = makeService(makeOrder());

    const result = await service.getEligibility('user-1', 'order-1');
    const option = result.items[0].options.find(
      (item: any) => item.afterSaleType === AfterSaleType.NO_REASON_RETURN,
    );

    expect(option.estimatedRefundAmount).toBe(5);
    expect(option.estimatedReturnShippingFee).toBe(10);
    expect(option.requiresBuyerShippingPayment).toBe(true);
  });

  it('无理由退货资格预估使用平台运费规则的地区和重量', async () => {
    const shippingRuleService = {
      calculateShippingDetail: jest.fn().mockResolvedValue({ fee: 12.345 }),
    };
    const service = makeServiceWithShippingRule(
      makeOrder({
        addressSnapshot: {
          regionCode: '440305',
          regionText: '广东省/深圳市/南山区',
        },
        goodsAmount: 5,
        items: [
          {
            id: 'item-1',
            skuId: 'sku-1',
            sku: { productId: 'product-1', weightGram: 800 },
            productSnapshot: { title: '苹果' },
            unitPrice: 5,
            quantity: 2,
            isPrize: false,
            afterSaleRequests: [],
          },
        ],
      }),
      shippingRuleService,
    );

    const result = await service.getEligibility('user-1', 'order-1');
    const option = result.items[0].options.find(
      (item: any) => item.afterSaleType === AfterSaleType.NO_REASON_RETURN,
    );

    expect(option.estimatedReturnShippingFee).toBe(12.35);
    expect(shippingRuleService.calculateShippingDetail).toHaveBeenCalledWith(
      0,
      '440305',
      1600,
      undefined,
    );
  });

  it('无理由退货资格预估对 bundle 商品优先使用订单快照重量', async () => {
    const shippingRuleService = {
      calculateShippingDetail: jest.fn().mockResolvedValue({ fee: 19.876 }),
    };
    const service = makeServiceWithShippingRule(
      makeOrder({
        addressSnapshot: {
          regionCode: '440305',
          regionText: '广东省/深圳市/南山区',
        },
        items: [
          {
            id: 'item-1',
            skuId: 'bundle-sku',
            sku: { productId: 'bundle-product', weightGram: 1 },
            productSnapshot: {
              title: '水果礼盒',
              productType: 'BUNDLE',
              bundleTotalWeightGram: 1300,
              bundleItems: [
                { skuId: 'component-apple', quantityPerBundle: 2, weightGram: 500 },
                { skuId: 'component-orange', quantityPerBundle: 1, weightGram: 300 },
              ],
            },
            unitPrice: 66,
            quantity: 2,
            isPrize: false,
            afterSaleRequests: [],
          },
        ],
      }),
      shippingRuleService,
    );

    const result = await service.getEligibility('user-1', 'order-1');
    const option = result.items[0].options.find(
      (item: any) => item.afterSaleType === AfterSaleType.NO_REASON_RETURN,
    );

    expect(option.estimatedReturnShippingFee).toBe(19.88);
    expect(shippingRuleService.calculateShippingDetail).toHaveBeenCalledWith(
      0,
      '440305',
      2600,
      undefined,
    );
  });

  it('完成无理由换货后只允许质量退货资格继续启用', async () => {
    const service = makeService(makeOrder({
      items: [
        {
          id: 'item-1',
          skuId: 'sku-1',
          sku: { productId: 'product-1' },
          productSnapshot: { title: '苹果' },
          unitPrice: 5,
          quantity: 1,
          isPrize: false,
          afterSaleRequests: [
            {
              status: 'COMPLETED',
              afterSaleType: AfterSaleType.NO_REASON_EXCHANGE,
            },
          ],
        },
      ],
    }));

    const result = await service.getEligibility('user-1', 'order-1');
    const qualityReturn = result.items[0].options.find(
      (item: any) => item.afterSaleType === AfterSaleType.QUALITY_RETURN,
    );
    const disabledOptions = result.items[0].options.filter(
      (item: any) => item.afterSaleType !== AfterSaleType.QUALITY_RETURN,
    );

    expect(qualityReturn.enabled).toBe(true);
    expect(disabledOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          afterSaleType: AfterSaleType.NO_REASON_RETURN,
          enabled: false,
          disabledReason: '该商品已完成换货，仅支持质量退货',
        }),
        expect.objectContaining({
          afterSaleType: AfterSaleType.NO_REASON_EXCHANGE,
          enabled: false,
          disabledReason: '该商品已完成换货，仅支持质量退货',
        }),
        expect.objectContaining({
          afterSaleType: AfterSaleType.QUALITY_EXCHANGE,
          enabled: false,
          disabledReason: '该商品已完成换货，仅支持质量退货',
        }),
      ]),
    );
  });
});

function makeTxService(tx: any) {
  const prisma = {
    $transaction: jest.fn((callback: any) => callback(tx)),
  };
  const afterSaleRewardService = {
    voidRewardsForOrder: jest.fn().mockResolvedValue(undefined),
  };

  return {
    prisma,
    afterSaleRewardService,
    service: new AfterSaleService(prisma as any, afterSaleRewardService as any, {} as any),
  };
}

function makeApplyTx(overrides: Partial<any> = {}) {
  const order = makeOrder({
    goodsAmount: 20,
    items: [
      {
        id: 'item-1',
        skuId: 'sku-original',
        sku: { productId: 'product-1' },
        productSnapshot: { title: '苹果' },
        unitPrice: 10,
        quantity: 2,
        isPrize: false,
      },
    ],
    ...overrides,
  });

  return {
    order: {
      findUnique: jest.fn().mockResolvedValue(order),
    },
    product: {
      findUnique: jest.fn().mockResolvedValue({
        returnPolicy: 'RETURNABLE',
        categoryId: null,
      }),
    },
    category: {
      findUnique: jest.fn(),
    },
    ruleConfig: {
      findUnique: jest.fn(({ where }: any) => {
        const values: Record<string, number> = {
          [AFTER_SALE_CONFIG_KEYS.RETURN_WINDOW_DAYS]: 7,
          [AFTER_SALE_CONFIG_KEYS.NORMAL_RETURN_DAYS]: 7,
          [AFTER_SALE_CONFIG_KEYS.FRESH_RETURN_HOURS]: 24,
          [AFTER_SALE_CONFIG_KEYS.RETURN_NO_SHIP_THRESHOLD]: 50,
          [AFTER_SALE_CONFIG_KEYS.RETURN_SHIPPING_FEE_DEFAULT]: 10,
        };
        return Promise.resolve({ key: where.key, value: values[where.key] });
      }),
    },
    afterSaleRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: any) => Promise.resolve({
        id: 'after-sale-1',
        ...data,
      })),
    },
    afterSaleStatusHistory: {
      create: jest.fn().mockResolvedValue({ id: 'after-sale-history-1' }),
    },
    orderStatusHistory: {
      create: jest.fn().mockResolvedValue({ id: 'history-1' }),
    },
  };
}

describe('AfterSaleService.apply', () => {
  it('rejects manually posted group-buy quality return or exchange requests', async () => {
    for (const afterSaleType of [AfterSaleType.QUALITY_RETURN, AfterSaleType.QUALITY_EXCHANGE]) {
      const tx = makeApplyTx({
        status: 'RECEIVED',
        bizType: 'GROUP_BUY',
      });
      const { service } = makeTxService(tx);

      await expect(service.apply('user-1', 'order-1', {
        orderItemId: 'item-1',
        afterSaleType,
        reasonType: 'QUALITY_ISSUE',
        photos: ['https://example.com/photo.jpg'],
      })).rejects.toThrow('团购订单支付后不支持退换货');
      expect(tx.afterSaleRequest.create).not.toHaveBeenCalled();
    }
  });

  it('creates no-reason exchange against the original sku and buyer return shipping payer', async () => {
    const tx = makeApplyTx();
    const { service } = makeTxService(tx);

    await service.apply('user-1', 'order-1', {
      orderItemId: 'item-1',
      afterSaleType: AfterSaleType.NO_REASON_EXCHANGE,
      photos: ['https://example.com/photo.jpg'],
    });

    expect(tx.afterSaleRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          afterSaleType: AfterSaleType.NO_REASON_EXCHANGE,
          targetSkuId: 'sku-original',
          targetQuantity: 2,
          returnShippingPayer: 'BUYER',
        }),
      }),
    );
  });

  it('writes an initial after-sale status history event without removing order history', async () => {
    const tx = makeApplyTx();
    const { service } = makeTxService(tx);

    await service.apply('user-1', 'order-1', {
      orderItemId: 'item-1',
      afterSaleType: AfterSaleType.QUALITY_RETURN,
      reasonType: 'QUALITY_ISSUE',
      photos: ['https://example.com/photo.jpg'],
    });

    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith({
      data: {
        afterSaleId: 'after-sale-1',
        fromStatus: null,
        toStatus: 'REQUESTED',
        reason: '买家申请售后: 质量问题',
        operatorType: AfterSaleOperatorType.BUYER,
        operatorId: 'user-1',
        meta: {
          type: 'AFTER_SALE_REQUESTED',
          afterSaleType: AfterSaleType.QUALITY_RETURN,
        },
      },
    });
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'order-1',
          meta: expect.objectContaining({
            type: 'AFTER_SALE_REQUESTED',
            afterSaleId: 'after-sale-1',
          }),
        }),
      }),
    );
  });
});

describe('AfterSaleService.escalate', () => {
  it('stores source status and writes buyer status history in the same transaction', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            userId: 'user-1',
            status: 'REJECTED',
          })
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            userId: 'user-1',
            status: 'PENDING_ARBITRATION',
            arbitrationSourceStatus: 'REJECTED',
            arbitrationSource: 'BUYER',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      afterSaleStatusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'history-1' }),
      },
    };
    const { service } = makeTxService(tx);

    await service.escalate('user-1', 'after-sale-1');

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'after-sale-1',
        userId: 'user-1',
        status: 'REJECTED',
      },
      data: {
        status: 'PENDING_ARBITRATION',
        arbitrationSourceStatus: 'REJECTED',
        arbitrationSource: 'BUYER',
      },
    });
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        afterSaleId: 'after-sale-1',
        fromStatus: 'REJECTED',
        toStatus: 'PENDING_ARBITRATION',
        operatorType: 'BUYER',
        operatorId: 'user-1',
      }),
    });
  });

  it('preserves seller rejected return as the source status when buyer escalates', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            userId: 'user-1',
            status: 'SELLER_REJECTED_RETURN',
          })
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            userId: 'user-1',
            status: 'PENDING_ARBITRATION',
            arbitrationSourceStatus: 'SELLER_REJECTED_RETURN',
            arbitrationSource: 'BUYER',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      afterSaleStatusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'history-1' }),
      },
    };
    const { service } = makeTxService(tx);

    await service.escalate('user-1', 'after-sale-1');

    expect(tx.afterSaleRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'after-sale-1',
        userId: 'user-1',
        status: 'SELLER_REJECTED_RETURN',
      },
      data: {
        status: 'PENDING_ARBITRATION',
        arbitrationSourceStatus: 'SELLER_REJECTED_RETURN',
        arbitrationSource: 'BUYER',
      },
    });
    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        afterSaleId: 'after-sale-1',
        fromStatus: 'SELLER_REJECTED_RETURN',
        toStatus: 'PENDING_ARBITRATION',
        operatorType: AfterSaleOperatorType.BUYER,
        operatorId: 'user-1',
      }),
    });
  });
});

describe('AfterSaleService buyer terminal actions', () => {
  it('writes after-sale status history when buyer confirms replacement receipt', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            orderId: 'order-1',
            userId: 'user-1',
            status: 'REPLACEMENT_SHIPPED',
            order: { id: 'order-1', status: 'RECEIVED' },
          })
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            status: 'COMPLETED',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'order-history-1' }),
      },
      afterSaleStatusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'after-sale-history-1' }),
      },
    };
    const { service } = makeTxService(tx);

    await service.confirmReceive('user-1', 'after-sale-1');

    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        afterSaleId: 'after-sale-1',
        fromStatus: 'REPLACEMENT_SHIPPED',
        toStatus: 'COMPLETED',
        reason: '买家确认收到换货商品',
        operatorType: AfterSaleOperatorType.BUYER,
        operatorId: 'user-1',
      }),
    });
  });

  it('writes after-sale status history when buyer accepts close', async () => {
    const tx = {
      afterSaleRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            userId: 'user-1',
            status: 'SELLER_REJECTED_RETURN',
          })
          .mockResolvedValueOnce({
            id: 'after-sale-1',
            status: 'CLOSED',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      afterSaleStatusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'after-sale-history-1' }),
      },
    };
    const { service } = makeTxService(tx);

    await service.acceptClose('user-1', 'after-sale-1');

    expect(tx.afterSaleStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        afterSaleId: 'after-sale-1',
        fromStatus: 'SELLER_REJECTED_RETURN',
        toStatus: 'CLOSED',
        reason: '买家接受卖家验收不通过，关闭售后',
        operatorType: AfterSaleOperatorType.BUYER,
        operatorId: 'user-1',
      }),
    });
  });
});

describe('AfterSaleService.getTimeline', () => {
  it('only returns owner timeline rows sorted ascending and mapped for the buyer app', async () => {
    const createdAt1 = new Date('2026-05-01T10:00:00.000Z');
    const createdAt2 = new Date('2026-05-01T10:05:00.000Z');
    const prisma = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'after-sale-1',
          userId: 'user-1',
        }),
      },
      afterSaleStatusHistory: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'history-1',
            fromStatus: 'REQUESTED',
            toStatus: 'REJECTED',
            reason: '卖家驳回',
            operatorType: 'SELLER_STAFF',
            createdAt: createdAt1,
            meta: { hidden: true },
          },
          {
            id: 'history-2',
            fromStatus: 'REJECTED',
            toStatus: 'PENDING_ARBITRATION',
            reason: '买家申请仲裁',
            operatorType: 'BUYER',
            createdAt: createdAt2,
            operatorId: 'user-1',
          },
        ]),
      },
    };
    const service = new AfterSaleService(prisma as any, {} as any, {} as any);

    expect(typeof (service as any).getTimeline).toBe('function');

    const result = await (service as any).getTimeline('user-1', 'after-sale-1');

    expect(prisma.afterSaleRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'after-sale-1' },
      select: { id: true, userId: true },
    });
    expect(prisma.afterSaleStatusHistory.findMany).toHaveBeenCalledWith({
      where: { afterSaleId: 'after-sale-1' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        operatorType: true,
        createdAt: true,
      },
    });
    expect(result).toEqual({
      items: [
        {
          id: 'history-1',
          fromStatus: 'REQUESTED',
          toStatus: 'REJECTED',
          reason: '卖家驳回',
          operatorType: 'SELLER_STAFF',
          createdAt: createdAt1,
        },
        {
          id: 'history-2',
          fromStatus: 'REJECTED',
          toStatus: 'PENDING_ARBITRATION',
          reason: '买家申请仲裁',
          operatorType: 'BUYER',
          createdAt: createdAt2,
        },
      ],
    });
  });

  it('rejects non-owner access without querying status history', async () => {
    const prisma = {
      afterSaleRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'after-sale-1',
          userId: 'user-1',
        }),
      },
      afterSaleStatusHistory: {
        findMany: jest.fn(),
      },
    };
    const service = new AfterSaleService(prisma as any, {} as any, {} as any);

    await expect(
      (service as any).getTimeline('user-2', 'after-sale-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.afterSaleStatusHistory.findMany).not.toHaveBeenCalled();
  });
});

describe('AfterSaleController timeline route', () => {
  it('declares GET :id/timeline before GET :id and delegates to service', async () => {
    const methodNames = Object.getOwnPropertyNames(AfterSaleController.prototype);
    const timelineIndex = methodNames.indexOf('getTimeline');
    const detailIndex = methodNames.indexOf('findById');

    expect(timelineIndex).toBeGreaterThan(-1);
    expect(timelineIndex).toBeLessThan(detailIndex);
    expect(Reflect.getMetadata(
      PATH_METADATA,
      (AfterSaleController.prototype as any).getTimeline,
    )).toBe(':id/timeline');

    const afterSaleService = {
      getTimeline: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new AfterSaleController(
      afterSaleService as any,
      {} as any,
      {} as any,
    );

    await expect(
      (controller as any).getTimeline('user-1', 'after-sale-1'),
    ).resolves.toEqual({ items: [] });
    expect(afterSaleService.getTimeline).toHaveBeenCalledWith(
      'user-1',
      'after-sale-1',
    );
  });
});
