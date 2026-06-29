export type NotificationRecipientKind = 'BUYER_USER' | 'SELLER_STAFF' | 'ADMIN_USER';
export type NotificationAudience = 'BUYER_APP' | 'SELLER_CENTER' | 'ADMIN_CENTER';
export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';

export type NotificationRouteKey =
  | 'ORDER_DETAIL'
  | 'ORDER_TRACK'
  | 'AFTER_SALE_DETAIL'
  | 'INVOICE_DETAIL'
  | 'WALLET'
  | 'COUPONS'
  | 'DIGITAL_ASSETS'
  | 'GROUP_BUY_DETAIL'
  | 'CS_SESSION'
  | 'SELLER_ORDER_DETAIL'
  | 'SELLER_AFTER_SALE_DETAIL'
  | 'SELLER_PRODUCT_DETAIL'
  | 'ADMIN_AFTER_SALE_DETAIL'
  | 'ADMIN_INVOICE_DETAIL'
  | 'ADMIN_WITHDRAW_DETAIL'
  | 'ADMIN_CS_WORKSTATION';

export type NotificationEvent = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyKey?: string;
  actor: { kind: 'buyer' | 'seller' | 'admin' | 'system'; id?: string };
  payload: Record<string, unknown>;
};

export type NotificationAction = {
  routeKey: NotificationRouteKey;
  params?: Record<string, string>;
};

export type NotificationMessageDraft = {
  recipientKind: NotificationRecipientKind;
  recipientKey: string;
  audience: NotificationAudience;
  category: string;
  eventType: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  entityType: string;
  entityId: string;
  action?: NotificationAction;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
};

export type NotificationResolveResult = {
  messages: NotificationMessageDraft[];
};
