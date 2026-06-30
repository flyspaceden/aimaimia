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

export type NotificationListParams = {
  page?: number;
  pageSize?: number;
  category?: string;
  unreadOnly?: boolean;
};

export const NotificationsApi = {
  list: (params?: NotificationListParams): Promise<NotificationItem[]> =>
    client.get('/seller/notifications', { params }),
  unreadCount: (): Promise<number> =>
    client.get('/seller/notifications/unread-count'),
  markRead: (id: string): Promise<NotificationItem[]> =>
    client.post(`/seller/notifications/${id}/read`, {}),
};
