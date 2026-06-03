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

  it('mapOrder exposes invoiceStatus only in list shape', () => {
    const out = (service as any).mapOrder({
      id: 'o1',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 100,
      createdAt: new Date(),
      items: [],
      shipments: [],
      afterSaleRequests: [],
      refunds: [],
      invoice: { status: 'REQUESTED' },
    });

    expect(out.invoiceStatus).toBe('REQUESTED');
    expect(out.invoiceEligible).toBe(false);
    expect(out.invoice).toBeUndefined();
  });

  it('mapOrderDetail exposes safe invoice detail without tax number leakage', () => {
    const now = new Date();
    const out = (service as any).mapOrderDetail({
      id: 'o1',
      userId: 'u1',
      status: 'RECEIVED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 100,
      goodsAmount: 100,
      shippingFee: 0,
      createdAt: now,
      items: [],
      shipments: [],
      statusHistory: [],
      payments: [],
      refunds: [],
      afterSaleRequests: [],
      invoice: {
        id: 'inv1',
        status: 'ISSUED',
        invoiceNo: 'MOCK-1',
        pdfUrl: 'http://localhost/inv.pdf',
        requestedAt: now,
        issuedAt: now,
        failReason: null,
        profileSnapshot: {
          type: 'COMPANY',
          title: '某公司',
          taxNo: '9144',
          phone: '13800000000',
          email: 'buyer@example.com',
        },
      },
    });

    expect(out.invoice).toMatchObject({ id: 'inv1', status: 'ISSUED', invoiceNo: 'MOCK-1' });
    expect(out.invoice.profileSnapshot).toEqual({ type: 'COMPANY', title: '某公司' });
    expect(JSON.stringify(out.invoice)).not.toContain('9144');
    expect(JSON.stringify(out.invoice)).not.toContain('13800000000');
    expect(JSON.stringify(out.invoice)).not.toContain('buyer@example.com');
    expect(out.invoiceEligible).toBe(false);
  });

  it('maps active afterSaleSummary with id and shipping payment status', () => {
    const mapped = (service as any).mapOrder({
      id: 'order_1',
      status: 'DELIVERED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 100,
      createdAt: new Date(),
      items: [],
      refunds: [],
      afterSaleRequests: [{
        id: 'as_1',
        status: 'APPROVED',
        afterSaleType: 'NO_REASON_EXCHANGE',
        reason: '尺码不合适',
        reasonType: null,
        requiresReturn: true,
        refundAmount: null,
        shippingPayment: { status: 'UNPAID' },
      }],
    } as any);

    expect(mapped.afterSaleSummary).toMatchObject({
      id: 'as_1',
      status: 'APPROVED',
      type: 'NO_REASON_EXCHANGE',
      requiresReturn: true,
      requiresBuyerShippingPayment: true,
      returnShippingPaymentStatus: 'UNPAID',
    });
  });

  it('maps legacy manual return logistics without requiring shipping payment', () => {
    const mapped = (service as any).mapOrder({
      id: 'order_legacy',
      status: 'DELIVERED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 100,
      createdAt: new Date(),
      items: [],
      refunds: [],
      afterSaleRequests: [{
        id: 'as_legacy',
        status: 'RETURN_SHIPPING',
        afterSaleType: 'QUALITY_RETURN',
        reason: '质量问题',
        reasonType: null,
        requiresReturn: true,
        returnShippingPayer: null,
        returnCarrierName: '顺丰速运',
        returnWaybillNo: 'SFOLD123',
        returnSfOrderId: null,
        shippingPayment: null,
      }],
    } as any);

    expect(mapped.afterSaleSummary).toMatchObject({
      id: 'as_legacy',
      returnShippingPaymentStatus: 'NOT_REQUIRED',
      returnShippingPayer: 'SELLER',
      isLegacyManualReturnShipping: true,
    });
  });

  it('maps no-reason exchange compatibility type as exchange', () => {
    const mapped = (service as any).mapOrder({
      id: 'order_exchange',
      status: 'DELIVERED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 100,
      createdAt: new Date(),
      items: [],
      refunds: [],
      afterSaleRequests: [{
        id: 'as_exchange',
        status: 'REQUESTED',
        afterSaleType: 'NO_REASON_EXCHANGE',
        reason: '',
        reasonType: null,
        requiresReturn: false,
        refundAmount: null,
        shippingPayment: null,
      }],
    } as any);

    expect(mapped.afterSaleType).toBe('exchange');
    expect(mapped.afterSaleSummary).toMatchObject({
      id: 'as_exchange',
      type: 'NO_REASON_EXCHANGE',
    });
  });

  it.each([
    {
      name: 'terminal closed no-reason exchange',
      afterSale: {
        status: 'CLOSED',
        afterSaleType: 'NO_REASON_EXCHANGE',
        requiresReturn: true,
        returnShippingPayer: 'BUYER',
        shippingPayment: { status: 'CLOSED' },
      },
      expectedPaymentStatus: 'CLOSED',
    },
    {
      name: 'refunded no-reason return with refunded shipping payment',
      afterSale: {
        status: 'REFUNDED',
        afterSaleType: 'NO_REASON_RETURN',
        requiresReturn: true,
        returnShippingPayer: 'BUYER',
        shippingPayment: { status: 'REFUNDED' },
      },
      expectedPaymentStatus: 'REFUNDED',
    },
    {
      name: 'fee deducted no-reason return',
      afterSale: {
        status: 'APPROVED',
        afterSaleType: 'NO_REASON_RETURN',
        requiresReturn: true,
        returnShippingPayer: 'BUYER',
        returnShippingFeeDeducted: true,
        shippingPayment: null,
      },
      expectedPaymentStatus: 'NOT_REQUIRED',
    },
    {
      name: 'already paid by returnShippingPaidAt',
      afterSale: {
        status: 'APPROVED',
        afterSaleType: 'NO_REASON_RETURN',
        requiresReturn: true,
        returnShippingPayer: 'BUYER',
        returnShippingPaidAt: new Date(),
        shippingPayment: null,
      },
      expectedPaymentStatus: 'PAID',
    },
    {
      name: 'legacy manual buyer return',
      afterSale: {
        status: 'RETURN_SHIPPING',
        afterSaleType: 'NO_REASON_RETURN',
        requiresReturn: true,
        returnShippingPayer: 'BUYER',
        returnWaybillNo: 'SFOLD456',
        returnSfOrderId: null,
        shippingPayment: null,
      },
      expectedPaymentStatus: 'NOT_REQUIRED',
    },
  ])('does not require buyer shipping payment for $name', ({ afterSale, expectedPaymentStatus }) => {
    const mapped = (service as any).mapOrder({
      id: 'order_no_pay',
      status: 'DELIVERED',
      bizType: 'NORMAL_GOODS',
      totalAmount: 100,
      createdAt: new Date(),
      items: [],
      refunds: [],
      afterSaleRequests: [{
        id: 'as_no_pay',
        reason: '',
        reasonType: null,
        refundAmount: null,
        ...afterSale,
      }],
    } as any);

    expect(mapped.afterSaleSummary).toMatchObject({
      requiresBuyerShippingPayment: false,
      returnShippingPaymentStatus: expectedPaymentStatus,
    });
  });
});
