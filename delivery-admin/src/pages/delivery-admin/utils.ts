import dayjs from 'dayjs';
import type {
  DeliveryOrderDetail,
  DeliveryOrderSubOrderSummary,
  JsonValue,
} from '@/types/delivery-management';

export function formatMoney(cents?: number | null) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) {
    return '-';
  }
  return `¥${(cents / 100).toFixed(2)}`;
}

export function formatBps(bps?: number | null) {
  if (bps === null || bps === undefined || Number.isNaN(bps)) {
    return '-';
  }
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : value;
}

export function formatDate(value?: string | null) {
  if (!value) {
    return '-';
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : value;
}

export function formatAddress(input?: {
  provinceName?: string | null;
  cityName?: string | null;
  districtName?: string | null;
  detailAddress?: string | null;
}) {
  if (!input) {
    return '-';
  }
  return [
    input.provinceName,
    input.cityName,
    input.districtName,
    input.detailAddress,
  ]
    .filter(Boolean)
    .join(' ');
}

export function safeStringify(value: JsonValue | unknown) {
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function parseJsonText(text?: string) {
  if (!text?.trim()) {
    return null;
  }
  return JSON.parse(text) as JsonValue;
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return '请求失败';
}

export function calcMargin(buyerAmountCents?: number | null, sellerAmountCents?: number | null) {
  if (buyerAmountCents === null || buyerAmountCents === undefined) {
    return null;
  }
  if (sellerAmountCents === null || sellerAmountCents === undefined) {
    return null;
  }
  return buyerAmountCents - sellerAmountCents;
}

export function sumNumbers(values: Array<number | null | undefined>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function calcSubOrderSettlementAmount(subOrder?: {
  supplyAmountCents?: number | null;
  shippingFeeShareCents?: number | null;
}) {
  if (subOrder?.supplyAmountCents === null || subOrder?.supplyAmountCents === undefined) {
    return null;
  }
  return subOrder.supplyAmountCents + (subOrder.shippingFeeShareCents ?? 0);
}

export function calcSubOrderPlatformDiff(subOrder?: {
  totalAmountCents?: number | null;
  supplyAmountCents?: number | null;
}) {
  if (subOrder?.totalAmountCents === null || subOrder?.totalAmountCents === undefined) {
    return null;
  }
  if (subOrder?.supplyAmountCents === null || subOrder?.supplyAmountCents === undefined) {
    return null;
  }
  return subOrder.totalAmountCents - subOrder.supplyAmountCents;
}

export function calcOrderSettlementAmount(order: Pick<DeliveryOrderDetail, 'subOrders'>) {
  if (!order.subOrders.length) {
    return null;
  }
  if (order.subOrders.some((item) => item.supplyAmountCents === null || item.supplyAmountCents === undefined)) {
    return null;
  }
  return sumNumbers(
    order.subOrders.map((item) => (item.supplyAmountCents ?? 0) + (item.shippingFeeShareCents ?? 0)),
  );
}

export function calcOrderPlatformDiff(order: Pick<DeliveryOrderDetail, 'subOrders' | 'totalAmountCents'>) {
  if (order.totalAmountCents === null || order.totalAmountCents === undefined) {
    return null;
  }
  if (!order.subOrders.length) {
    return null;
  }
  if (order.subOrders.some((item) => item.supplyAmountCents === null || item.supplyAmountCents === undefined)) {
    return null;
  }
  return order.totalAmountCents - sumNumbers(order.subOrders.map((item) => item.supplyAmountCents ?? 0));
}

export function getOrderAmountSummary(order: {
  totalAmountCents?: number | null;
  subOrders: DeliveryOrderSubOrderSummary[];
}) {
  const sellerKnown = order.subOrders.length > 0 && order.subOrders.every((item) => item.supplyAmountCents !== undefined);
  const sellerAmountCents = sellerKnown ? sumNumbers(order.subOrders.map((item) => item.supplyAmountCents ?? 0)) : null;
  return {
    buyerAmountCents: order.totalAmountCents ?? null,
    sellerAmountCents,
    marginAmountCents: calcMargin(order.totalAmountCents ?? null, sellerAmountCents),
  };
}

export function statusColor(status?: string | null) {
  switch (status) {
    case 'ACTIVE':
    case 'APPROVED':
    case 'OPEN':
    case 'PUBLISHED':
    case 'COMPLETED':
    case 'DELIVERED':
    case 'SETTLED':
    case 'SUCCESS':
      return 'success';
    case 'PENDING':
    case 'PENDING_SHIPMENT':
    case 'SHIPPED':
    case 'IN_PROGRESS':
      return 'processing';
    case 'SUSPENDED':
    case 'REJECTED':
    case 'FAILED':
    case 'CLOSED':
    case 'INACTIVE':
      return 'error';
    case 'DRAFT':
      return 'default';
    default:
      return 'default';
  }
}

export const merchantStatusOptions = ['PENDING', 'ACTIVE', 'SUSPENDED'];
export const merchantApplicationStatusOptions = ['PENDING', 'APPROVED', 'REJECTED'];
export const productStatusOptions = ['DRAFT', 'ACTIVE', 'INACTIVE'];
export const productAuditStatusOptions = ['PENDING', 'APPROVED', 'REJECTED'];
export const pricingScopeOptions = ['PLATFORM', 'MERCHANT', 'PRODUCT', 'SKU'];
export const pricingRuleTypeOptions = ['FIXED_PRICE', 'MARKUP_RATE'];
export const orderStatusOptions = [
  'PENDING_SHIPMENT',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELED',
];
export const settlementStatusOptions = ['PENDING', 'SETTLED'];
export const conversationStatusOptions = ['OPEN', 'CLOSED'];
export const configScopeOptions = ['SYSTEM', 'CUSTOMER_SERVICE', 'MANIFEST', 'UNIT'];
export const unitStatusOptions = ['ACTIVE', 'DISABLED'];
export const unitFieldTypeOptions = ['TEXT', 'TEXTAREA', 'SELECT'];
