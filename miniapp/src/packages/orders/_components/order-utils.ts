import type { Order, OrderItem, OrderStatus, RepurchaseResult, Shipment, TrackingEvent } from '@/types';

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; hint: string; tone: string }> = {
  PENDING_PAYMENT: { label: '历史待支付', hint: '该记录仅供查看，不再提供支付入口', tone: 'muted' },
  PAID: { label: '待发货', hint: '商家正在备货，发货前可修收货信息', tone: 'gold' },
  SHIPPED: { label: '已发货', hint: '好物已从产地出发', tone: 'brand' },
  DELIVERED: { label: '待收货', hint: '包裹已送达，请核对后确认收货', tone: 'brand' },
  RECEIVED: { label: '已完成', hint: '这笔订单已完成履约', tone: 'success' },
  CANCELED: { label: '已取消', hint: '订单已取消，若已付款将按原路径处理', tone: 'muted' },
  REFUNDED: { label: '已退款', hint: '订单款项已退回原支付渠道', tone: 'muted' },
};

export function formatMoney(value?: number | null): string {
  return Number(value || 0).toFixed(2);
}

export function formatOrderTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function shortOrderNo(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export function parsePaymentSuccessOrderIds(raw?: string): string[] {
  if (!raw || raw.length > 8_192) return [];
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return [];
  }
  return [...new Set(decoded.split(',').map((item) => item.trim()).filter(
    (item) => /^[A-Za-z0-9_-]{1,128}$/.test(item),
  ))].slice(0, 50);
}

export function groupOrderItems(items: OrderItem[]): Array<{ key: string; companyName: string; items: OrderItem[] }> {
  const groups = new Map<string, { companyName: string; items: OrderItem[] }>();
  for (const item of items) {
    const key = item.companyId || item.companyName || 'platform';
    const current = groups.get(key) || { companyName: item.companyName || '商家', items: [] };
    current.items.push(item);
    groups.set(key, current);
  }
  return Array.from(groups, ([key, value]) => ({ key, ...value }));
}

export function canCancelPaidOrder(order: Order): boolean {
  return order.status === 'PAID'
    && order.bizType !== 'VIP_PACKAGE'
    && order.bizType !== 'GROUP_BUY'
    && order.receiverInfoEditable !== false;
}

export function canConfirmOrder(order: Order): boolean {
  return order.status === 'SHIPPED' || order.status === 'DELIVERED';
}

export function canRepurchaseOrder(order: Order): boolean {
  return order.status === 'RECEIVED' && order.repurchasable !== false && order.bizType === 'NORMAL_GOODS';
}

export function canConfirmReplacementOrder(order: Order): boolean {
  return order.afterSaleStatus === 'shipped' && Boolean(order.afterSaleSummary?.id);
}

export function paymentSuccessPresentation(orders: Order[]): {
  title: string;
  copy: string;
  primaryLabel: string;
  destination: 'VIP_CENTER' | 'ORDER_DETAIL' | 'ORDER_LIST';
} {
  const isVip = orders.length > 0 && orders.every((order) => order.bizType === 'VIP_PACKAGE');
  if (isVip) {
    return {
      title: 'VIP 开通成功',
      copy: 'VIP 礼包订单已生成',
      primaryLabel: '查看 VIP 中心',
      destination: 'VIP_CENTER',
    };
  }
  if (orders.length === 1) {
    return {
      title: '支付成功',
      copy: '订单已生成，可查看发货与物流状态。',
      primaryLabel: '查看订单',
      destination: 'ORDER_DETAIL',
    };
  }
  return {
    title: '支付成功',
    copy: `已为您创建 ${orders.length} 笔商家订单`,
    primaryLabel: '查看全部订单',
    destination: 'ORDER_LIST',
  };
}

export function maskTrackingNo(value?: string | null): string {
  if (!value) return '暂无运单号';
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export function dedupeTrackingEvents(events: TrackingEvent[]): TrackingEvent[] {
  const latestByContent = new Map<string, TrackingEvent>();
  for (const event of events) {
    const key = `${event.message || '物流更新'}|${event.location || ''}`;
    const previous = latestByContent.get(key);
    if (!previous || new Date(event.occurredAt).getTime() > new Date(previous.occurredAt).getTime()) {
      latestByContent.set(key, event);
    }
  }
  return Array.from(latestByContent.values()).sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

export function shipmentPackages(shipment: (Shipment & { shipments?: Shipment[] }) | null): Shipment[] {
  if (!shipment) return [];
  return shipment.shipments?.length ? shipment.shipments : [shipment];
}

export function repurchasePresentation(result: RepurchaseResult): { title: string; lines: string[]; canOpenCart: boolean } {
  const lines: string[] = [];
  if (result.addedQuantity > 0) lines.push(`已将 ${result.addedQuantity} 件商品加入购物车`);
  for (const item of result.items) {
    if (item.reason === 'LOW_STOCK_ADJUSTED') {
      lines.push(`${item.title}：库存不足，数量已调整为 ${item.adjustedQuantity ?? item.quantity}`);
    } else if (item.status === 'SKIPPED' || item.virtual) {
      lines.push(`${item.title}：${item.message || '当前不可购买'}`);
    } else if (item.priceChanged) {
      lines.push(`${item.title}：价格已按当前售价更新`);
    }
  }
  const partial = result.skippedItemCount > 0 || result.items.some((item) => item.reason === 'LOW_STOCK_ADJUSTED' || item.virtual);
  return {
    title: result.addedQuantity <= 0 ? '暂无可加购商品' : partial ? '部分商品已加购' : '已加入购物车',
    lines: lines.slice(0, 6),
    canOpenCart: result.addedQuantity > 0,
  };
}
