import { OrderService } from './order.service';

describe('OrderService.mapOrder snapshot', () => {
  let service: OrderService;
  beforeAll(() => {
    // mapOrder 是纯函数（不依赖任何注入服务），直接 new + 占位依赖即可
    service = new OrderService({} as any, {} as any, {} as any);
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
});
