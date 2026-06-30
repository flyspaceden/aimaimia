import client from './client';

export type NotificationAction = {
  routeKey: string;
  params?: Record<string, string>;
};

export type NotificationItem = {
  id: string;
  category: string;
  type: string;
  title: string;
  content: string;
  unread: boolean;
  createdAt: string;
  action?: NotificationAction;
  target?: NotificationAction;
};

export const NotificationsApi = {
  list: (): Promise<NotificationItem[]> =>
    client.get('/admin/notifications'),
  unreadCount: (): Promise<number> =>
    client.get('/admin/notifications/unread-count'),
  markRead: (id: string): Promise<NotificationItem[]> =>
    client.post(`/admin/notifications/${id}/read`, {}),
};
