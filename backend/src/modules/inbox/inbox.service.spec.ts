import { InboxService } from './inbox.service';

describe('InboxService', () => {
  const makeService = () => {
    const prisma = {
      notificationMessage: {
        create: jest.fn(),
      },
    };
    const notificationMessages = {
      list: jest.fn(),
      unreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };

    return {
      prisma,
      notificationMessages,
      service: new InboxService(prisma as any, notificationMessages as any),
    };
  };

  it('delegates buyer inbox list and read operations to notification messages', async () => {
    const { service, notificationMessages } = makeService();
    notificationMessages.list.mockResolvedValueOnce([{ id: 'message-1' }]);
    notificationMessages.unreadCount.mockResolvedValueOnce(2);
    notificationMessages.markRead.mockResolvedValueOnce([{ id: 'message-1', unread: false }]);
    notificationMessages.markAllRead.mockResolvedValueOnce([]);

    await expect(service.list('buyer-1', 'order', true)).resolves.toEqual([{ id: 'message-1' }]);
    await expect(service.getUnreadCount('buyer-1')).resolves.toBe(2);
    await expect(service.markRead('message-1', 'buyer-1')).resolves.toEqual([{ id: 'message-1', unread: false }]);
    await expect(service.markAllRead('buyer-1')).resolves.toEqual([]);

    expect(notificationMessages.list).toHaveBeenCalledWith('buyer:buyer-1', 'order', true);
    expect(notificationMessages.unreadCount).toHaveBeenCalledWith('buyer:buyer-1');
    expect(notificationMessages.markRead).toHaveBeenCalledWith('buyer:buyer-1', 'message-1');
    expect(notificationMessages.markAllRead).toHaveBeenCalledWith('buyer:buyer-1');
  });

  it('adapts deprecated send calls to NotificationMessage rows with a unique idempotency key', async () => {
    const { service, prisma } = makeService();
    const createdAt = new Date('2026-06-29T12:00:00.000Z');
    prisma.notificationMessage.create.mockResolvedValueOnce({
      id: 'message-1',
      category: 'transaction',
      eventType: 'order_update',
      title: '订单更新',
      body: '订单已发货',
      createdAt,
      readAt: null,
      action: { routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } },
    });

    await expect(
      service.send({
        userId: 'buyer-1',
        category: 'transaction',
        type: 'order_update',
        title: '订单更新',
        content: '订单已发货',
        target: { routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } },
      }),
    ).resolves.toEqual({
      id: 'message-1',
      category: 'transaction',
      type: 'order_update',
      title: '订单更新',
      content: '订单已发货',
      createdAt: '2026-06-29T12:00:00.000Z',
      unread: true,
      action: { routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } },
      target: { routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } },
    });

    expect(prisma.notificationMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recipientKind: 'BUYER_USER',
        recipientKey: 'buyer:buyer-1',
        audience: 'BUYER_APP',
        category: 'transaction',
        eventType: 'order_update',
        title: '订单更新',
        body: '订单已发货',
        severity: 'INFO',
        entityType: 'inbox',
        entityId: 'buyer-1',
        action: { routeKey: 'ORDER_DETAIL', params: { id: 'order-1' } },
        idempotencyKey: expect.stringMatching(/^legacy-inbox:buyer-1:order_update:/),
      }),
    });
  });
});
