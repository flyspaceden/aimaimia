import { SellerNotificationsController } from './seller-notifications.controller';

describe('SellerNotificationsController', () => {
  const makeController = () => {
    const messages = {
      list: jest.fn(),
      unreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };

    return {
      messages,
      controller: new SellerNotificationsController(messages as any),
    };
  };

  it('uses the seller userId for recipient keys because notification registry writes seller:<User.id>', () => {
    const { controller, messages } = makeController();

    controller.list(
      { sub: 'staff-1', userId: 'user-1' } as any,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(messages.list).toHaveBeenCalledWith('seller:user-1', undefined, false, 1, 20);
  });

  it('uses the seller userId for unread and read mutations', () => {
    const { controller, messages } = makeController();
    const user = { sub: 'staff-1', userId: 'user-1' } as any;

    controller.unreadCount(user);
    controller.markRead(user, 'message-1');
    controller.markAllRead(user);

    expect(messages.unreadCount).toHaveBeenCalledWith('seller:user-1');
    expect(messages.markRead).toHaveBeenCalledWith('seller:user-1', 'message-1');
    expect(messages.markAllRead).toHaveBeenCalledWith('seller:user-1');
  });
});
