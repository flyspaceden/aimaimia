import { AfterSaleType } from '@prisma/client';
import { AFTER_SALE_CONFIG_KEYS } from './after-sale.constants';
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

  return new AfterSaleService(prisma as any, {} as any);
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
