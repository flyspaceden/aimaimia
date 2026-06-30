import {
  buildNotificationMessageCreateInput,
  legacyRouteToAction,
  runMigrateInboxToNotifications,
} from './migrate-inbox-to-notifications';

describe('migrate-inbox-to-notifications script', () => {
  it('maps legacy buyer routes to notification actions', () => {
    expect(legacyRouteToAction({ route: '/orders/o-003' })).toEqual({
      routeKey: 'ORDER_DETAIL',
      params: { id: 'o-003' },
    });
    expect(legacyRouteToAction({ route: '/me/rewards' })).toEqual({ routeKey: 'WALLET' });
    expect(legacyRouteToAction({ route: '/me/bookings' })).toBeUndefined();
    expect(legacyRouteToAction({ routeKey: 'COUPONS' })).toEqual({ routeKey: 'COUPONS' });
    expect(legacyRouteToAction({ route: '/orders/' })).toBeUndefined();
  });

  it('builds a buyer notification message from a legacy inbox row', () => {
    const createdAt = new Date('2026-06-29T10:00:00.000Z');
    const updatedAt = new Date('2026-06-29T11:00:00.000Z');

    expect(buildNotificationMessageCreateInput({
      id: 'msg-1',
      userId: 'buyer-1',
      category: 'unknown',
      type: 'order',
      title: '订单已发货',
      content: '您的订单已发货',
      unread: false,
      target: { route: '/orders/order-1' },
      createdAt,
      updatedAt,
    })).toEqual(expect.objectContaining({
      recipientKind: 'BUYER_USER',
      recipientKey: 'buyer:buyer-1',
      audience: 'BUYER_APP',
      category: 'system',
      eventType: 'order',
      title: '订单已发货',
      body: '您的订单已发货',
      severity: 'INFO',
      entityType: 'legacyInbox',
      entityId: 'msg-1',
      action: { routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } },
      idempotencyKey: 'legacy-inbox:msg-1',
      readAt: updatedAt,
      createdAt,
    }));
  });

  it('upserts migrated rows by buyer recipient and legacy idempotency key', async () => {
    const row = {
      id: 'msg-1',
      userId: 'buyer-1',
      category: 'system',
      type: 'coupon',
      title: '红包到账',
      content: '您收到一张红包',
      unread: true,
      target: { route: '/me/coupons' },
      createdAt: new Date('2026-06-29T10:00:00.000Z'),
      updatedAt: new Date('2026-06-29T10:00:00.000Z'),
    };
    const deps = {
      findLegacyInboxRows: jest.fn().mockResolvedValue([row]),
      upsertNotificationMessage: jest.fn().mockResolvedValue(undefined),
    };
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(runMigrateInboxToNotifications({ deps })).resolves.toEqual({ migrated: 1 });
    } finally {
      logSpy.mockRestore();
    }

    expect(deps.upsertNotificationMessage).toHaveBeenCalledWith(
      'buyer:buyer-1',
      'legacy-inbox:msg-1',
      expect.objectContaining({
        action: { routeKey: 'COUPONS' },
        readAt: null,
      }),
    );
  });
});
