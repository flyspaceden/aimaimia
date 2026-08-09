import type { InboxAction, InboxCategory, MessageRoute } from './types';

const ROUTES_BY_KEY: Record<string, (params: Record<string, string>) => MessageRoute | null> = {
  ORDER_DETAIL: (params) => params.id ? { label: '查看订单', url: `/packages/orders/order-detail/index?id=${encodeURIComponent(params.id)}` } : null,
  ORDER_TRACK: (params) => {
    const orderId = params.orderId || params.id;
    return orderId ? { label: '查看物流', url: `/packages/orders/order-track/index?orderId=${encodeURIComponent(orderId)}` } : null;
  },
  AFTER_SALE_DETAIL: (params) => params.id
    ? { label: '查看售后详情', url: `/packages/after-sales/after-sale-detail/index?id=${encodeURIComponent(params.id)}` }
    : null,
  INVOICE_DETAIL: (params) => params.id
    ? { label: '查看发票', url: `/packages/invoices/invoice-detail/index?id=${encodeURIComponent(params.id)}` }
    : null,
  GROUP_BUY_DETAIL: (params) => params.activityId
    ? { label: '查看团购', url: `/packages/group-buy/activity-detail/index?activityId=${encodeURIComponent(params.activityId)}` }
    : null,
  WALLET: () => ({ label: '查看钱包', url: '/packages/member/wallet/index' }),
  COUPONS: () => ({ label: '查看红包', url: '/packages/member/coupons/index' }),
  DIGITAL_ASSETS: () => ({ label: '查看数字资产', url: '/packages/member/digital-assets/index' }),
  PRODUCT_DETAIL: (params) => params.id ? { label: '查看商品', url: `/packages/commerce/catalog-product/index?id=${encodeURIComponent(params.id)}` } : null,
  CS_SESSION: (params) => params.sessionId
    ? { label: '进入客服对话', url: `/packages/customer-service/chat/index?sessionId=${encodeURIComponent(params.sessionId)}` }
    : { label: '进入客服中心', url: '/packages/customer-service/session-list/index' },
  ORDER_RECEIVER_INFO: (params) => {
    const id = params.id || params.orderId;
    return id ? { label: '修改收货信息', url: `/packages/orders/receiver-info/index?id=${encodeURIComponent(id)}` } : null;
  },
};

function stringParams(value?: Record<string, unknown>): Record<string, string> {
  const entries = Object.entries(value || {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}

function resolveLegacy(action: InboxAction, params: Record<string, string>): MessageRoute | null {
  const route = action.route;
  if (!route) return null;
  if (route === '/orders/[id]' && params.id) return ROUTES_BY_KEY.ORDER_DETAIL(params);
  if (route === '/orders/track') return ROUTES_BY_KEY.ORDER_TRACK(params);
  if (route === '/orders/after-sale-detail/[id]') return ROUTES_BY_KEY.AFTER_SALE_DETAIL(params);
  if (route === '/invoices/[id]') return ROUTES_BY_KEY.INVOICE_DETAIL(params);
  if (route === '/group-buy/[activityId]') return ROUTES_BY_KEY.GROUP_BUY_DETAIL(params);
  if (route === '/me/wallet') return ROUTES_BY_KEY.WALLET(params);
  if (route === '/me/coupons' || route === '/coupon-center') return ROUTES_BY_KEY.COUPONS(params);
  if (route === '/me/digital-assets') return ROUTES_BY_KEY.DIGITAL_ASSETS(params);
  if (route === '/cs') return ROUTES_BY_KEY.CS_SESSION(params);
  if (route === '/orders/receiver-info/[id]') return ROUTES_BY_KEY.ORDER_RECEIVER_INFO(params);
  const productMatch = route.match(/^\/product\/([^/]+)$/);
  if (productMatch) return ROUTES_BY_KEY.PRODUCT_DETAIL({ id: productMatch[1] });
  const orderMatch = route.match(/^\/orders\/([^/]+)$/);
  if (orderMatch) return ROUTES_BY_KEY.ORDER_DETAIL({ id: orderMatch[1] });
  const afterSaleMatch = route.match(/^\/orders\/after-sale-detail\/([^/]+)$/);
  if (afterSaleMatch) return ROUTES_BY_KEY.AFTER_SALE_DETAIL({ id: afterSaleMatch[1] });
  const invoiceMatch = route.match(/^\/invoices\/([^/]+)$/);
  if (invoiceMatch) return ROUTES_BY_KEY.INVOICE_DETAIL({ id: invoiceMatch[1] });
  const groupBuyMatch = route.match(/^\/group-buy\/([^/]+)$/);
  if (groupBuyMatch) return ROUTES_BY_KEY.GROUP_BUY_DETAIL({ activityId: groupBuyMatch[1] });
  return null;
}

export function resolveMessageRoute(action?: InboxAction | null): MessageRoute | null {
  if (!action || typeof action !== 'object') return null;
  const params = stringParams(action.params);
  if (action.routeKey && ROUTES_BY_KEY[action.routeKey]) return ROUTES_BY_KEY[action.routeKey](params);
  return resolveLegacy(action, params);
}

export function formatMessageTime(value: string, detail = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return detail
    ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

export function categoryLabel(category: InboxCategory): string {
  if (category === 'interaction' || category === 'service') return '互动消息';
  if (['transaction', 'order', 'after_sale', 'wallet', 'group_buy'].includes(category)) return '交易消息';
  return '系统消息';
}

export function messageSeal(category: InboxCategory): string {
  if (category === 'interaction' || category === 'service') return '互';
  if (['transaction', 'order', 'after_sale', 'wallet', 'group_buy'].includes(category)) return '交';
  return '系';
}
