import type {
  AfterSaleRequest,
  AfterSaleStatus,
  AfterSaleType,
  EligibilityItem,
  EligibilityOption,
  ReturnShippingPayer,
  ReturnShippingPaymentStatus,
  SfTracking,
} from './types';

export const AFTER_SALE_TYPE_LABELS: Record<AfterSaleType, string> = {
  NO_REASON_RETURN: '七天无理由退货', NO_REASON_EXCHANGE: '七天无理由换货',
  QUALITY_RETURN: '质量问题退货', QUALITY_EXCHANGE: '质量问题换货',
};
export const AFTER_SALE_STATUS_LABELS: Record<AfterSaleStatus, string> = {
  REQUESTED: '已申请', UNDER_REVIEW: '审核中', APPROVED: '已通过', REJECTED: '已驳回',
  PENDING_ARBITRATION: '平台仲裁中', RETURN_SHIPPING: '退货运输中', RECEIVED_BY_SELLER: '卖家验收中',
  SELLER_REJECTED_RETURN: '退货验收不通过', REFUNDING: '退款中', REFUNDED: '已退款',
  REPLACEMENT_SHIPPED: '换货已发出', COMPLETED: '已完成', CLOSED: '已关闭', CANCELED: '已撤销',
};
export const QUALITY_REASONS = [
  ['QUALITY_ISSUE', '质量问题'], ['WRONG_ITEM', '发错商品'], ['DAMAGED', '运输损坏'],
  ['NOT_AS_DESCRIBED', '与描述不符'], ['SIZE_ISSUE', '规格不符'], ['EXPIRED', '临期/过期'], ['OTHER', '其他'],
] as const;

export function formatMoney(value?: number | null): string { return Number(value || 0).toFixed(2); }
export function formatTime(value?: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }); }
export function productSnapshot(request: AfterSaleRequest) { return request.orderItem?.productSnapshot; }
export function sortedTracking(tracking?: SfTracking | null) { return [...(tracking?.events || [])].sort((a, b) => String(b.time).localeCompare(String(a.time))); }
export type EligibilityShippingDisplay = {
  returnRequirement: string;
  payer?: string;
  estimatedFee?: string;
  paymentHandling?: string;
  summary: string;
};

export function eligibilityShippingDisplay(option: EligibilityOption): EligibilityShippingDisplay {
  if (!option.requiresReturn) {
    return { returnRequirement: '无需寄回', summary: '无需寄回' };
  }

  const estimatedFee = option.estimatedReturnShippingFee != null && option.estimatedReturnShippingFee > 0
    ? `¥${formatMoney(option.estimatedReturnShippingFee)}`
    : undefined;
  const payer = option.returnShippingPayer === 'BUYER'
    ? '由你承担'
    : option.returnShippingPayer === 'SELLER'
      ? '由商家承担'
      : option.returnShippingPayer === 'PLATFORM'
        ? '由平台承担'
        : '审核通过后确认';

  let paymentHandling: string | undefined;
  if (option.returnShippingPayer === 'BUYER') {
    if (option.requiresBuyerShippingPayment) {
      paymentHandling = '审核通过后需先支付';
    } else if (estimatedFee) {
      paymentHandling = '已从预计退款中扣除';
    } else {
      paymentHandling = '无需另付';
    }
  }

  const summary = [
    '需要寄回',
    `退货运费${payer}`,
    estimatedFee ? `预计 ${estimatedFee}` : undefined,
    paymentHandling,
  ].filter(Boolean).join(' · ');

  return {
    returnRequirement: '需要寄回',
    payer,
    estimatedFee,
    paymentHandling,
    summary,
  };
}

export function eligibilityItemDisabledReason(item: EligibilityItem): string | undefined {
  if (item.options.some((option) => option.enabled)) return undefined;
  const reasons = Array.from(new Set(
    item.options
      .map((option) => option.disabledReason?.trim())
      .filter((reason): reason is string => Boolean(reason)),
  ));
  return reasons.length ? reasons.join('；') : '当前商品暂不支持申请售后';
}
export function isRefundPolling(request?: AfterSaleRequest | null): boolean { return Boolean(request && (request.status === 'REFUNDING' || request.refundStatus === 'REFUNDING')); }
export function canCancel(status: AfterSaleStatus): boolean { return status === 'REQUESTED' || status === 'UNDER_REVIEW'; }
export function canArbitrate(status: AfterSaleStatus): boolean { return status === 'REJECTED' || status === 'SELLER_REJECTED_RETURN'; }
export function canConfirmReplacement(status: AfterSaleStatus): boolean { return status === 'REPLACEMENT_SHIPPED'; }
export function resolvedReturnPayer(request: AfterSaleRequest): ReturnShippingPayer {
  return request.returnShippingPayer || (request.afterSaleType.startsWith('NO_REASON_') ? 'BUYER' : 'SELLER');
}
export function returnPaymentStatus(request: AfterSaleRequest): ReturnShippingPaymentStatus {
  if (!request.requiresReturn || resolvedReturnPayer(request) !== 'BUYER' || request.returnShippingFeeDeducted) return 'NOT_REQUIRED';
  if (request.returnShippingPaidAt) return 'PAID';
  return request.returnShippingPaymentStatus || (request.status === 'APPROVED' ? 'UNPAID' : 'NOT_REQUIRED');
}
export function canCreateWaybill(request: AfterSaleRequest): boolean {
  return request.status === 'APPROVED' && request.requiresReturn && ['NOT_REQUIRED', 'PAID'].includes(returnPaymentStatus(request));
}
