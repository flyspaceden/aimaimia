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
  PRODUCT_DETAIL: '/product/[id]',
  CS_SESSION: '/cs',
  ORDER_RECEIVER_INFO: '/orders/receiver-info/[id]',
};

const LEGACY_BUYER_ROUTES = new Set([
  '/(tabs)',
  '/me',
  '/orders',
  '/orders/[id]',
  '/orders/track',
  '/orders/after-sale-detail/[id]',
  '/invoices',
  '/invoices/[id]',
  '/me/wallet',
  '/me/coupons',
  '/me/digital-assets',
  '/group-buy',
  '/group-buy/[activityId]',
  '/cs',
  '/about',
  '/account-security',
  '/cart',
  '/checkout',
  '/checkout-address',
  '/checkout-coupon',
  '/coupon-center',
  '/inbox',
  '/lottery',
  '/notification-settings',
  '/privacy',
  '/referral',
  '/search',
  '/settings',
  '/terms',
  '/orders/receiver-info/[id]',
  '/company/[id]',
  '/product/[id]',
]);

const LEGACY_CONCRETE_ROUTE_PATTERNS = [
  /^\/orders\/[^/]+$/,
  /^\/orders\/after-sale-detail\/[^/]+$/,
  /^\/invoices\/[^/]+$/,
  /^\/me\/[^/]+$/,
  /^\/group-buy\/[^/]+$/,
  /^\/ai\/[^/]+$/,
  /^\/vip\/[^/]+$/,
  /^\/category\/[^/]+$/,
  /^\/group\/[^/]+$/,
  /^\/orders\/receiver-info\/[^/]+$/,
  /^\/company\/[^/]+$/,
  /^\/product\/[^/]+$/,
  /^\/user\/[^/]+$/,
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
    if (action.routeKey === 'PRODUCT_DETAIL' && !params?.id) return null;
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

const ACTION_LABEL_BY_ROUTE_KEY: Record<string, string> = {
  ORDER_DETAIL: '查看订单',
  ORDER_TRACK: '查看物流',
  AFTER_SALE_DETAIL: '查看售后详情',
  INVOICE_DETAIL: '查看发票',
  WALLET: '查看钱包',
  COUPONS: '查看红包',
  DIGITAL_ASSETS: '查看数字资产',
  GROUP_BUY_DETAIL: '查看团购',
  PRODUCT_DETAIL: '查看商品',
  CS_SESSION: '进入客服对话',
  ORDER_RECEIVER_INFO: '修改收货信息',
};

export const getBuyerNotificationActionLabel = (action: NotificationRouteInput): string | null => {
  const route = resolveBuyerNotificationRoute(action);
  if (!route) return null;

  if (action?.routeKey && ACTION_LABEL_BY_ROUTE_KEY[action.routeKey]) {
    return ACTION_LABEL_BY_ROUTE_KEY[action.routeKey];
  }
  if (route.pathname === '/cs') return '进入客服对话';
  if (route.pathname.startsWith('/product/')) return '查看商品';
  if (route.pathname.startsWith('/orders/')) return '查看订单';
  if (route.pathname.startsWith('/group-buy/')) return '查看团购';
  return '查看相关页面';
};
