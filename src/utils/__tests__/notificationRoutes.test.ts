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

  it('returns null for unsupported seller or admin route keys', () => {
    expect(resolveBuyerNotificationRoute({ routeKey: 'SELLER_ORDER_DETAIL', params: { id: 'order-1' } })).toBeNull();
    expect(resolveBuyerNotificationRoute({ routeKey: 'ADMIN_INVOICE_DETAIL', params: { id: 'invoice-1' } })).toBeNull();
  });

  it('returns null for an empty action', () => {
    expect(resolveBuyerNotificationRoute(undefined)).toBeNull();
    expect(resolveBuyerNotificationRoute(null)).toBeNull();
  });
});
