import { resolveBuyerNotificationRoute } from '../notificationRoutes';

describe('resolveBuyerNotificationRoute', () => {
  it('maps ORDER_DETAIL to the buyer order detail route', () => {
    expect(resolveBuyerNotificationRoute({ routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } })).toEqual({
      pathname: '/orders/[id]',
      params: { id: 'order-1' },
    });
  });

  it('maps ORDER_RECEIVER_INFO to the receiver info route', () => {
    expect(resolveBuyerNotificationRoute({ routeKey: 'ORDER_RECEIVER_INFO', params: { id: 'order-1' } })).toEqual({
      pathname: '/orders/receiver-info/[id]',
      params: { id: 'order-1' },
    });
  });

  it('maps CS_SESSION with sessionId so the客服页面 can restore the original conversation', () => {
    expect(resolveBuyerNotificationRoute({ routeKey: 'CS_SESSION', params: { sessionId: 'cs-1' } })).toEqual({
      pathname: '/cs',
      params: { sessionId: 'cs-1' },
    });
  });

  it('maps GROUP_BUY_DETAIL with activityId for the dynamic route', () => {
    expect(resolveBuyerNotificationRoute({ routeKey: 'GROUP_BUY_DETAIL', params: { activityId: 'activity-1' } })).toEqual({
      pathname: '/group-buy/[activityId]',
      params: { activityId: 'activity-1' },
    });
  });

  it('maps PRODUCT_DETAIL with a concrete product id', () => {
    expect(resolveBuyerNotificationRoute({ routeKey: 'PRODUCT_DETAIL', params: { id: 'product-1' } })).toEqual({
      pathname: '/product/[id]',
      params: { id: 'product-1' },
    });
  });

  it('rejects PRODUCT_DETAIL without a product id', () => {
    expect(resolveBuyerNotificationRoute({ routeKey: 'PRODUCT_DETAIL' })).toBeNull();
  });

  it('returns null for unsupported seller or admin route keys', () => {
    expect(resolveBuyerNotificationRoute({ routeKey: 'SELLER_ORDER_DETAIL', params: { id: 'order-1' } })).toBeNull();
    expect(resolveBuyerNotificationRoute({ routeKey: 'ADMIN_INVOICE_DETAIL', params: { id: 'invoice-1' } })).toBeNull();
  });

  it('allows known legacy concrete buyer routes', () => {
    expect(resolveBuyerNotificationRoute({ route: '/orders/o-005' })).toEqual({
      pathname: '/orders/o-005',
    });
    expect(resolveBuyerNotificationRoute({ route: '/product/p-005' })).toEqual({
      pathname: '/product/p-005',
    });
  });

  it('rejects unsupported legacy concrete routes', () => {
    expect(resolveBuyerNotificationRoute({ route: '/seller/orders/o-005' })).toBeNull();
    expect(resolveBuyerNotificationRoute({ route: '/admin/invoices/i-005' })).toBeNull();
  });

  it('returns null for an empty action', () => {
    expect(resolveBuyerNotificationRoute(undefined)).toBeNull();
    expect(resolveBuyerNotificationRoute(null)).toBeNull();
  });
});
