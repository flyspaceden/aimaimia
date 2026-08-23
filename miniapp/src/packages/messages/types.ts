export type InboxCategory = 'interaction' | 'transaction' | 'system' | 'order' | 'after_sale' | 'wallet' | 'group_buy' | 'service' | 'risk';
export type InboxAction = {
  routeKey?: string;
  route?: string;
  params?: Record<string, unknown>;
};
export type InboxMessage = {
  id: string;
  category: InboxCategory;
  type: string;
  title: string;
  content: string;
  createdAt: string;
  unread: boolean;
  severity?: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  metadata?: Record<string, unknown>;
  target?: InboxAction;
  action?: InboxAction;
};
export type InboxFilter = 'all' | 'interaction' | 'transaction' | 'system';
export type InboxDeleteResult = { id?: string; deletedCount?: number; restoredCount?: number };
export type MessageRoute = { label: string; url: string; mode?: 'navigate' | 'switchTab' };
