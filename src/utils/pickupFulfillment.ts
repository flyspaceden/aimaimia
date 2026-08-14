import type { Order, PickupFulfillmentStatus } from '../types';

export const pickupStatusLabels: Record<PickupFulfillmentStatus, string> = {
  PREPARING: '备货中',
  READY: '待自提',
  PICKED_UP: '已取货',
  VOID: '凭证已失效',
  CANCELED: '自提已取消',
};

export function isPickupOrder(order: Pick<Order, 'fulfillmentMode'>): boolean {
  return order.fulfillmentMode === 'PICKUP';
}

export function pickupOrderStatusLabel(order: Pick<Order, 'fulfillmentMode' | 'pickupFulfillment'>): string | undefined {
  if (order.fulfillmentMode !== 'PICKUP') return undefined;
  if (!order.pickupFulfillment) return '自提信息异常';
  return pickupStatusLabels[order.pickupFulfillment.status];
}

export function pickupOrderStatusHint(order: Pick<Order, 'fulfillmentMode' | 'pickupFulfillment'>): string | undefined {
  if (order.fulfillmentMode !== 'PICKUP') return undefined;
  if (!order.pickupFulfillment) return '履约信息暂不可用，请联系客服处理';
  const hints: Record<PickupFulfillmentStatus, string> = {
    PREPARING: '商家正在备货，备好后会生成一次性取货凭证',
    READY: '商品已备好，请到店出示取货凭证',
    PICKED_UP: '取货凭证已核销，本单履约完成',
    VOID: '该取货凭证已经永久失效',
    CANCELED: '本次自提已经取消',
  };
  return hints[order.pickupFulfillment.status];
}

export function formatPickupBusinessHours(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item.trim()];
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const day = [record.day, record.label, record.weekday]
        .find((part) => typeof part === 'string');
      const hours = [record.hours, record.time, record.period]
        .find((part) => typeof part === 'string');
      return day || hours ? [`${day || ''}${day && hours ? ' ' : ''}${hours || ''}`] : [];
    });
    if (parts.length) return parts.join(' · ');
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const summary = [record.summary, record.text, record.label].find((item) => typeof item === 'string');
    if (typeof summary === 'string' && summary.trim()) return summary.trim();
    const parts = Object.entries(record)
      .filter(([, hours]) => typeof hours === 'string' && Boolean(hours.trim()))
      .map(([day, hours]) => `${day} ${hours}`);
    if (parts.length) return parts.join(' · ');
  }
  return '营业时间以门店通知为准';
}
