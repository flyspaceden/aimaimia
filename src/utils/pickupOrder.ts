import type { Order, PickupFulfillmentStatus } from '../types';

export type PickupOrderTone = 'warning' | 'brand' | 'success' | 'muted';

export type PickupOrderPresentation = {
  label: string;
  hint: string;
  tone: PickupOrderTone;
};

const PICKUP_STATUS_PRESENTATION: Record<PickupFulfillmentStatus, PickupOrderPresentation> = {
  PREPARING: {
    label: '备货中',
    hint: '商家正在备货，备好后请在微信小程序查看取货凭证',
    tone: 'warning',
  },
  READY: {
    label: '待自提',
    hint: '商品已备好，请在微信小程序查看一次性取货凭证',
    tone: 'brand',
  },
  PICKED_UP: {
    label: '已取货',
    hint: '取货凭证已核销，本单履约完成',
    tone: 'success',
  },
  VOID: {
    label: '凭证已失效',
    hint: '该取货凭证已永久失效，请联系订单客服',
    tone: 'muted',
  },
  CANCELED: {
    label: '自提已取消',
    hint: '本次自提已取消',
    tone: 'muted',
  },
};

export function isPickupOrder(order: Pick<Order, 'fulfillmentMode'>): boolean {
  return order.fulfillmentMode === 'PICKUP';
}

export function pickupOrderPresentation(
  order: Pick<Order, 'fulfillmentMode' | 'pickupFulfillment'>,
): PickupOrderPresentation | null {
  if (!isPickupOrder(order)) return null;
  if (!order.pickupFulfillment) {
    return {
      label: '自提信息异常',
      hint: '履约信息暂不可用，请联系订单客服处理',
      tone: 'muted',
    };
  }
  return PICKUP_STATUS_PRESENTATION[order.pickupFulfillment.status] ?? {
    label: '自提状态异常',
    hint: '履约状态暂不可识别，请联系订单客服处理',
    tone: 'muted',
  };
}

export function canCancelPickupOrder(
  order: Pick<Order, 'status' | 'bizType' | 'fulfillmentMode' | 'pickupFulfillment'>,
): boolean {
  return isPickupOrder(order)
    && order.status === 'PAID'
    && order.pickupFulfillment?.status === 'PREPARING'
    && order.bizType !== 'VIP_PACKAGE'
    && order.bizType !== 'GROUP_BUY';
}

export function formatPickupBusinessHours(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const lines = value.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item.trim()];
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const day = [row.day, row.label, row.weekday].find((part) => typeof part === 'string');
      const hours = [row.hours, row.time, row.period].find((part) => typeof part === 'string');
      return day || hours ? [`${day || ''}${day && hours ? ' ' : ''}${hours || ''}`] : [];
    });
    if (lines.length) return lines.join(' · ');
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const summary = [row.summary, row.text, row.label].find((part) => typeof part === 'string');
    if (typeof summary === 'string' && summary.trim()) return summary.trim();
    const lines = Object.entries(row)
      .filter(([, hours]) => typeof hours === 'string' && hours.trim())
      .slice(0, 7)
      .map(([day, hours]) => `${day} ${hours}`);
    if (lines.length) return lines.join(' · ');
  }
  return '营业时间以自提点通知为准';
}
