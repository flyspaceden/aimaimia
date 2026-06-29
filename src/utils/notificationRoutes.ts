type NotificationRouteInput =
  | {
      routeKey?: string;
      route?: string;
      params?: Record<string, unknown>;
    }
  | null
  | undefined;

export type BuyerNotificationRoute = {
  pathname: string;
  params?: Record<string, string>;
};

const BUYER_ROUTE_BY_KEY: Record<string, string> = {
  ORDER_DETAIL: '/orders/[id]',
  ORDER_TRACK: '/orders/track',
  AFTER_SALE_DETAIL: '/orders/after-sale-detail/[id]',
  INVOICE_DETAIL: '/invoices/[id]',
  WALLET: '/me/wallet',
  COUPONS: '/me/coupons',
  DIGITAL_ASSETS: '/me/digital-assets',
  GROUP_BUY_DETAIL: '/group-buy/[activityId]',
  CS_SESSION: '/cs',
  ORDER_RECEIVER_INFO: '/orders/receiver-info/[id]',
};

const LEGACY_BUYER_ROUTES = new Set([
  '/orders',
  '/orders/[id]',
  '/orders/track',
  '/orders/after-sale-detail/[id]',
  '/invoices/[id]',
  '/me/wallet',
  '/me/coupons',
  '/me/digital-assets',
  '/group-buy/[activityId]',
  '/cs',
  '/orders/receiver-info/[id]',
  '/company/[id]',
  '/product/[id]',
]);

const LEGACY_CONCRETE_ROUTE_PATTERNS = [
  /^\/orders\/[^/]+$/,
  /^\/orders\/after-sale-detail\/[^/]+$/,
  /^\/invoices\/[^/]+$/,
  /^\/group-buy\/[^/]+$/,
  /^\/orders\/receiver-info\/[^/]+$/,
  /^\/company\/[^/]+$/,
  /^\/product\/[^/]+$/,
];

const normalizeParams = (params: Record<string, unknown> | undefined): Record<string, string> | undefined => {
  if (!params) return undefined;

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const resolveBuyerNotificationRoute = (action: NotificationRouteInput): BuyerNotificationRoute | null => {
  if (!action || typeof action !== 'object') return null;

  const params = normalizeParams(action.params);
  if (action.routeKey) {
    const pathname = BUYER_ROUTE_BY_KEY[action.routeKey];
    return pathname ? { pathname, ...(params ? { params } : {}) } : null;
  }

  if (action.route && LEGACY_BUYER_ROUTES.has(action.route)) {
    return { pathname: action.route, ...(params ? { params } : {}) };
  }

  if (action.route && LEGACY_CONCRETE_ROUTE_PATTERNS.some((pattern) => pattern.test(action.route || ''))) {
    return { pathname: action.route, ...(params ? { params } : {}) };
  }

  return null;
};
