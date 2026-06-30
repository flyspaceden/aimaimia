import { SellerNotificationsController } from './seller-notifications.controller';

describe('SellerNotificationsController', () => {
  const makeController = () => {
    const messages = {
      list: jest.fn().mockResolvedValue([{ id: 'seller-msg-1' }]),
      unreadCount: jest.fn().mockResolvedValue(2),
      markRead: jest.fn().mockResolvedValue([{ id: 'seller-msg-1', unread: false }]),
      markAllRead: jest.fn().mockResolvedValue([]),
    };

    return {
      controller: new SellerNotificationsController(messages as any),
      messages,
    };
  };

  it('lists seller notifications for the current staff user', async () => {
    const { controller, messages } = makeController();

    await expect(controller.list({ sub: 'seller-user-1' } as any, undefined, undefined)).resolves.toEqual([
      { id: 'seller-msg-1' },
    ]);

    expect(messages.list).toHaveBeenCalledWith('seller:seller-user-1', undefined, false, 1, 20);
  });

  it('passes filters and pagination to seller notification list', async () => {
    const { controller, messages } = makeController();

    await controller.list({ sub: 'seller-user-1' } as any, 'ORDER', 'true', '2', '30');

    expect(messages.list).toHaveBeenCalledWith('seller:seller-user-1', 'ORDER', true, 2, 30);
  });

  it('counts seller unread notifications for the current staff user', async () => {
    const { controller, messages } = makeController();

    await expect(controller.unreadCount({ sub: 'seller-user-1' } as any)).resolves.toBe(2);

    expect(messages.unreadCount).toHaveBeenCalledWith('seller:seller-user-1');
  });

  it('marks one seller notification as read for the current staff user', async () => {
    const { controller, messages } = makeController();

    await expect(controller.markRead({ sub: 'seller-user-1' } as any, 'msg-1')).resolves.toEqual([
      { id: 'seller-msg-1', unread: false },
    ]);

    expect(messages.markRead).toHaveBeenCalledWith('seller:seller-user-1', 'msg-1');
  });

  it('marks all seller notifications as read for the current staff user', async () => {
    const { controller, messages } = makeController();

    await expect(controller.markAllRead({ sub: 'seller-user-1' } as any)).resolves.toEqual([]);

    expect(messages.markAllRead).toHaveBeenCalledWith('seller:seller-user-1');
  });
});
