import { NotificationRegistry } from './notification.registry';

describe('NotificationRegistry', () => {
  const registry = new NotificationRegistry();

  it('builds buyer order shipped notification with a registered route key', () => {
    const result = registry.resolve({
      eventType: 'order.shipped',
      aggregateType: 'order',
      aggregateId: 'order-1',
      actor: { kind: 'system' },
      payload: { orderId: 'order-1', buyerUserId: 'buyer-1' },
    });

    expect(result.messages).toEqual([
      expect.objectContaining({
        recipientKind: 'BUYER_USER',
        recipientKey: 'buyer:buyer-1',
        audience: 'BUYER_APP',
        category: 'order',
        eventType: 'order.shipped',
        action: { routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } },
      }),
    ]);
  });

  it('throws for unregistered event types', () => {
    expect(() =>
      registry.resolve({
        eventType: 'unknown.event',
        aggregateType: 'unknown',
        aggregateId: 'x',
        actor: { kind: 'system' },
        payload: {},
      }),
    ).toThrow('未注册的通知事件');
  });
});
