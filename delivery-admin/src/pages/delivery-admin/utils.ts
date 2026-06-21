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

function hasMoney(value?: number | null) {
  return value !== null && value !== undefined && !Number.isNaN(value);
}

export function calcSubOrderBuyerAmount(subOrder?: {
  totalAmountCents?: number | null;
}) {
  const totalAmountCents = subOrder?.totalAmountCents;
  if (!hasMoney(totalAmountCents)) {
    return null;
  }
  return totalAmountCents;
}

export function calcSubOrderSupplyAmount(subOrder?: {
  supplyAmountCents?: number | null;
}) {
  const supplyAmountCents = subOrder?.supplyAmountCents;
  if (!hasMoney(supplyAmountCents)) {
    return null;
  }
  return supplyAmountCents;
}

export function calcSubOrderSettlementAmount(subOrder?: {
  supplyAmountCents?: number | null;
  shippingFeeShareCents?: number | null;
}) {
  const supplyAmountCents = subOrder?.supplyAmountCents;
  const shippingFeeShareCents = subOrder?.shippingFeeShareCents;
  if (supplyAmountCents === null || supplyAmountCents === undefined) {
    return null;
  }
  if (shippingFeeShareCents === null || shippingFeeShareCents === undefined) {
    return null;
  }
  return supplyAmountCents + shippingFeeShareCents;
}

export function calcSubOrderPlatformDiff(subOrder?: {
  totalAmountCents?: number | null;
  supplyAmountCents?: number | null;
  shippingFeeShareCents?: number | null;
}) {
  const totalAmountCents = subOrder?.totalAmountCents;
  if (totalAmountCents === null || totalAmountCents === undefined) {
    return null;
  }
  const settlementAmountCents = calcSubOrderSettlementAmount(subOrder);
  if (settlementAmountCents === null) {
    return null;
  }
  return totalAmountCents - settlementAmountCents;
}

export function calcOrderSupplyAmount(order: Pick<DeliveryOrderDetail, 'subOrders'>) {
  if (!order.subOrders.length) {
    return null;
  }
  if (order.subOrders.some((item) => !hasMoney(item.supplyAmountCents))) {
    return null;
  }
  return sumNumbers(order.subOrders.map((item) => item.supplyAmountCents ?? 0));
}

export function calcOrderSettlementAmount(order: Pick<DeliveryOrderDetail, 'subOrders'>) {
  if (!order.subOrders.length) {
    return null;
  }
  if (order.subOrders.some((item) => !hasMoney(item.supplyAmountCents) || !hasMoney(item.shippingFeeShareCents))) {
    return null;
  }
  return sumNumbers(order.subOrders.map((item) => (item.supplyAmountCents ?? 0) + (item.shippingFeeShareCents ?? 0)));
}

export function calcOrderPlatformDiff(order: Pick<DeliveryOrderDetail, 'subOrders' | 'totalAmountCents'>) {
  if (!hasMoney(order.totalAmountCents)) {
    return null;
  }
  const settlementAmountCents = calcOrderSettlementAmount(order);
  if (settlementAmountCents === null) {
    return null;
  }
  return order.totalAmountCents - settlementAmountCents;
}

export function getOrderAmountSummary(order: {
  totalAmountCents?: number | null;
  subOrders: DeliveryOrderSubOrderSummary[];
}) {
  const supplyAmountCents = order.subOrders.length > 0
    && order.subOrders.every((item) => hasMoney(item.supplyAmountCents))
    ? sumNumbers(order.subOrders.map((item) => item.supplyAmountCents ?? 0))
    : null;
  const settlementAmountCents = order.subOrders.length > 0
    && order.subOrders.every((item) => hasMoney(item.supplyAmountCents) && hasMoney(item.shippingFeeShareCents))
    ? sumNumbers(order.subOrders.map((item) => (item.supplyAmountCents ?? 0) + (item.shippingFeeShareCents ?? 0)))
    : null;
  return {
    buyerAmountCents: order.totalAmountCents ?? null,
    supplyAmountCents,
    settlementAmountCents,
    platformDiffAmountCents: settlementAmountCents === null
      ? null
      : calcMargin(order.totalAmountCents ?? null, settlementAmountCents),
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

const deliveryDisplayTextMap: Record<string, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
  DISABLED: '停用',
  SUSPENDED: '已暂停',
  DRAFT: '草稿',
  PENDING: '待处理',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  OPEN: '处理中',
  CLOSED: '已关闭',
  PUBLISHED: '已发布',
  COMPLETED: '已完成',
  DELIVERED: '已送达',
  SETTLED: '已结算',
  SUCCESS: '成功',
  FAILED: '失败',
  PENDING_SHIPMENT: '待发货',
  SHIPPED: '已发货',
  CANCELED: '已取消',
  IN_PROGRESS: '处理中',
  PLATFORM: '全平台',
  MERCHANT: '指定商家',
  PRODUCT: '指定商品',
  SKU: '指定规格',
  FIXED_PRICE: '固定售价',
  MARKUP_RATE: '加价率',
  SYSTEM: '系统设置',
  CUSTOMER_SERVICE: '客服中心',
  MANIFEST: '清单模板',
  UNIT: '配送单位',
  TEXT: '单行文本',
  TEXTAREA: '多行文本',
  SELECT: '下拉选项',
  BUYER_FULL: '买家整单清单',
  SELLER_FULFILLMENT: '卖家配货清单',
};

export function formatDeliveryDisplayText(value?: string | null) {
  if (!value) {
    return '-';
  }
  if (deliveryDisplayTextMap[value]) {
    return deliveryDisplayTextMap[value];
  }
  return /^[A-Z0-9_]+$/.test(value) ? '未知状态' : value;
}

export function deliveryValueEnum(options: string[]) {
  return Object.fromEntries(options.map((item) => [item, { text: formatDeliveryDisplayText(item) }]));
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
