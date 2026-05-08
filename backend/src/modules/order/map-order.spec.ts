import { OrderService } from './order.service';

describe('OrderService.mapOrder snapshot', () => {
  let service: OrderService;
  beforeAll(() => {
    // mapOrder 是纯函数（不依赖任何注入服务），直接 new + 占位依赖即可
    service = new OrderService({} as any, {} as any, {} as any, {} as any, {} as any);
  });

  it('snapshot returns extended fields', () => {
    const order = {
      id: 'o1', status: 'PAID', bizType: 'NORMAL_GOODS', totalAmount: 100,
      createdAt: new Date(), items: [{
        id: 'i1', skuId: 'sku1', unitPrice: 50, quantity: 1,
        companyId: 'c1', isPrize: false,
        productSnapshot: {
          productId: 'p1', title: '猕猴桃', skuTitle: '5斤装', image: 'http://img/1.jpg',
        },
      }], afterSaleRequests: [], refunds: [],
    };
    const out = (service as any).mapOrder(order);
    expect(out.items[0]).toMatchObject({
      skuTitle: '5斤装',
      companyId: 'c1',
      isPrize: false,
    });
  });

  it('mapOrder exposes paidAt/shippedAt/deliveredAt', () => {
    const now = new Date();
    const order = {
      id: 'o1', status: 'SHIPPED', bizType: 'NORMAL_GOODS', totalAmount: 100,
      createdAt: now, paidAt: now, deliveredAt: null,
      items: [], afterSaleRequests: [], refunds: [],
      shipments: [{ shippedAt: now, deliveredAt: null, trackingEvents: [] }],
    };
    const out = (service as any).mapOrder(order);
    expect(out.paidAt).toBe(now.toISOString());
    expect(out.shippedAt).toBe(now.toISOString());
    expect(out.deliveredAt).toBeNull();
  });

  it('mapOrder includes companyName from companyMap', () => {
    const order = {
      id: 'o1', status: 'PAID', bizType: 'NORMAL_GOODS', totalAmount: 100,
      createdAt: new Date(), items: [{
        id: 'i1', skuId: 'sku1', unitPrice: 50, quantity: 1,
        companyId: 'c1', isPrize: false, productSnapshot: {},
      }], afterSaleRequests: [], refunds: [],
    };
    const companyMap = new Map([['c1', { id: 'c1', name: '青禾农场', logoUrl: 'http://logo' }]]);
    const out = (service as any).mapOrder(order, companyMap);
    expect(out.items[0].companyName).toBe('青禾农场');
    expect(out.items[0].companyLogo).toBe('http://logo');
  });

  it('mapOrder includes autoReceiveAt and logisticsSummary', () => {
    const now = new Date();
    const order = {
      id: 'o1', status: 'SHIPPED', bizType: 'NORMAL_GOODS', totalAmount: 100,
      createdAt: now, autoReceiveAt: now,
      items: [], afterSaleRequests: [], refunds: [],
      shipments: [{
        status: 'IN_TRANSIT',
        trackingEvents: [
          { occurredAt: new Date(now.getTime() - 1000), message: '已揽收', location: '上海' },
          { occurredAt: now, message: '运输中', location: '北京' },
        ],
      }],
    };
    const out = (service as any).mapOrder(order);
    expect(out.autoReceiveAt).toBe(now.toISOString());
    expect(out.logisticsSummary).toEqual({
      status: 'IN_TRANSIT',
      latestEventMessage: '运输中',
      latestEventTime: now.toISOString(),
    });
  });

  it('mapOrder exposes all discount fields used by after-sale estimate', () => {
    const order = {
      id: 'o1',
      status: 'DELIVERED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 65,
      goodsAmount: 100,
      shippingFee: 0,
      discountAmount: 20,
      vipDiscountAmount: 5,
      totalCouponDiscount: 10,
      createdAt: new Date(),
      items: [],
      afterSaleRequests: [],
      refunds: [],
      shipments: [],
    };
    const out = (service as any).mapOrder(order);

    expect(out.goodsAmount).toBe(100);
    expect(out.shippingFee).toBe(0);
    expect(out.discountAmount).toBe(20);
    expect(out.vipDiscountAmount).toBe(5);
    expect(out.totalCouponDiscount).toBe(10);
  });

  it('mapOrder exposes skuId and lightweight repurchasable for completed normal orders', () => {
    const order = {
      id: 'o-received',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 100,
      createdAt: new Date(),
      items: [{
        id: 'i-normal',
        skuId: 'sku-normal',
        unitPrice: 50,
        quantity: 2,
        companyId: 'c1',
        isPrize: false,
        productSnapshot: { productId: 'p1', title: '苹果', skuTitle: '5斤装', image: 'http://img/apple.jpg' },
      }],
      afterSaleRequests: [],
      refunds: [],
      shipments: [],
    };

    const out = (service as any).mapOrder(order);

    expect(out.repurchasable).toBe(true);
    expect(out.items[0]).toMatchObject({
      skuId: 'sku-normal',
      productId: 'p1',
      isPrize: false,
    });
  });

  it('mapOrder marks all-prize completed orders as not repurchasable', () => {
    const order = {
      id: 'o-prize-only',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 0,
      createdAt: new Date(),
      items: [{
        id: 'i-prize',
        skuId: 'sku-prize',
        unitPrice: 0,
        quantity: 1,
        companyId: 'platform',
        isPrize: true,
        productSnapshot: { productId: 'p-prize', title: '奖品', skuTitle: '默认', image: '' },
      }],
      afterSaleRequests: [],
      refunds: [],
      shipments: [],
    };

    const out = (service as any).mapOrder(order);

    expect(out.repurchasable).toBe(false);
  });
});
