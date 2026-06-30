import { AdminNotificationsController } from './admin-notifications.controller';

describe('AdminNotificationsController', () => {
  const makeController = () => {
    const messages = {
      list: jest.fn().mockResolvedValue([{ id: 'admin-msg-1' }]),
      unreadCount: jest.fn().mockResolvedValue(3),
      markRead: jest.fn().mockResolvedValue([{ id: 'admin-msg-1', unread: false }]),
      markAllRead: jest.fn().mockResolvedValue([]),
    };

    return {
      controller: new AdminNotificationsController(messages as any),
      messages,
    };
  };

  it('lists admin notifications for the current admin user', async () => {
    const { controller, messages } = makeController();

    await expect(controller.list({ sub: 'admin-1' } as any, undefined, undefined)).resolves.toEqual([
      { id: 'admin-msg-1' },
    ]);

    expect(messages.list).toHaveBeenCalledWith('admin:admin-1', undefined, false, 1, 20);
  });

  it('passes filters and pagination to admin notification list', async () => {
    const { controller, messages } = makeController();

    await controller.list({ sub: 'admin-1' } as any, 'RISK', 'true', '3', '10');

    expect(messages.list).toHaveBeenCalledWith('admin:admin-1', 'RISK', true, 3, 10);
  });

  it('counts admin unread notifications for the current admin user', async () => {
    const { controller, messages } = makeController();

    await expect(controller.unreadCount({ sub: 'admin-1' } as any)).resolves.toBe(3);

    expect(messages.unreadCount).toHaveBeenCalledWith('admin:admin-1');
  });

  it('marks one admin notification as read for the current admin user', async () => {
    const { controller, messages } = makeController();

    await expect(controller.markRead({ sub: 'admin-1' } as any, 'msg-1')).resolves.toEqual([
      { id: 'admin-msg-1', unread: false },
    ]);

    expect(messages.markRead).toHaveBeenCalledWith('admin:admin-1', 'msg-1');
  });

  it('marks all admin notifications as read for the current admin user', async () => {
    const { controller, messages } = makeController();

    await expect(controller.markAllRead({ sub: 'admin-1' } as any)).resolves.toEqual([]);

    expect(messages.markAllRead).toHaveBeenCalledWith('admin:admin-1');
  });
});
