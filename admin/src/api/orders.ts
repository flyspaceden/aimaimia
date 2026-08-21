import client from './client';
import type {
  Order,
  OrderQueryParams,
  OrderStatsMap,
  PaginatedData,
  PickupFulfillmentEvent,
} from '@/types';

export type UpdateOrderReceiverInfoPayload = {
  recipientName: string;
  phone: string;
  regionCode: string;
  regionText: string;
  detail: string;
};

/** 订单列表 */
export const getOrders = (params?: OrderQueryParams): Promise<PaginatedData<Order>> =>
  client.get('/admin/orders', { params });

/** 订单状态统计 */
export const getOrderStats = (): Promise<OrderStatsMap> =>
  client.get('/admin/orders/stats');

/** 订单详情 */
export const getOrder = (id: string): Promise<Order> =>
  client.get(`/admin/orders/${id}`);

/**
 * 发货（Bug 86）
 *
 * - useCarrierAuto=true：自动取号模式，调顺丰丰桥 + 生成电子面单
 *   只需 carrierCode（默认 'SF'），后端自动填 carrierName/waybillNo/waybillUrl
 * - useCarrierAuto=false / 不传：手填模式（兼容现有），需 carrierCode + carrierName + trackingNo
 */
export const shipOrder = (id: string, data: {
  useCarrierAuto?: boolean;
  carrierCode: string;
  carrierName?: string;
  trackingNo?: string;
}): Promise<{ ok: boolean; waybillNo?: string; waybillUrl?: string | null }> =>
  client.post(`/admin/orders/${id}/ship`, data);

/** 修改未生成面单订单的配送信息 */
export const updateOrderReceiverInfo = (
  id: string,
  data: UpdateOrderReceiverInfoPayload,
): Promise<Order> =>
  client.patch(`/admin/orders/${id}/receiver-info`, data);

/** 取消订单 */
export const cancelOrder = (id: string, reason: string): Promise<{ ok: boolean }> =>
  client.post(`/admin/orders/${id}/cancel`, { reason });

/** 普通商品自提异常：平台受控取消并按原支付渠道退款。 */
export const cancelPickupAndRefund = (
  id: string,
  reason: string,
): Promise<{
  ok: boolean;
  affectedOrderIds?: string[];
  refunds?: Array<{
    id: string;
    orderId: string;
    status: string;
    providerRefundId?: string | null;
    updatedAt: string;
  }>;
}> =>
  client.post(`/admin/orders/${id}/pickup-cancel-refund`, { reason });

/** 手动重试退款 */
export const retryRefund = (
  orderId: string,
  refundId: string,
): Promise<{ ok: boolean; message?: string }> =>
  client.post(`/admin/orders/${orderId}/refunds/${refundId}/retry`);

/** 将当前订单所属微信支付单的最新发货快照重新加入异步上报队列 */
export const retryWechatShipping = (
  orderId: string,
): Promise<{ ok: boolean; status: 'PENDING' }> =>
  client.post(`/admin/orders/${orderId}/wechat-shipping/retry`);

/** 自提履约只读事件；接口不会返回明文取货码或二维码 token。 */
export const getPickupEvents = (
  orderId: string,
): Promise<{ items: PickupFulfillmentEvent[] }> =>
  client.get(`/admin/orders/${orderId}/pickup-events`);

export const markPickupReady = (
  orderId: string,
): Promise<{ orderId: string; status: 'READY'; readyAt: string; alreadyReady: boolean }> =>
  client.post(`/admin/orders/${orderId}/pickup/ready`, {});

export type PickupCredentialPayload =
  | { pickupCode: string; qrPayload?: never }
  | { pickupCode?: never; qrPayload: string };

export interface PickupCredentialPreview {
  orderId: string;
  status: 'READY' | 'PICKED_UP';
  alreadyPickedUp: boolean;
  companies: Array<{ id: string; name: string }>;
  pickupPoint: {
    id: string | null;
    companyId: string | null;
    kind: 'MERCHANT' | 'PLATFORM_HUB';
    isPlatformHub: boolean;
    name: string;
    regionText: string;
    detail: string;
    businessHours?: Record<string, unknown> | null;
  };
  recipient: {
    name: string;
    phoneMasked: string;
  };
  items: Array<{
    title: string;
    skuTitle: string;
    quantity: number;
    skuCode: string | null;
    barcode: string | null;
  }>;
}

export const verifyPickup = (
  orderId: string,
  data: PickupCredentialPayload,
): Promise<{ orderId: string; status: 'PICKED_UP'; pickedUpAt: string; alreadyPickedUp: boolean }> =>
  client.post(`/admin/orders/${orderId}/pickup/verify`, data);

/** 平台核销台先识别凭证并返回最小订单摘要，不改变履约状态。 */
export const resolvePickupCredential = (
  data: PickupCredentialPayload,
): Promise<PickupCredentialPreview> =>
  client.post('/admin/pickup/resolve', data);

/** 平台操作员二次确认后核销，后端复用 Serializable/CAS 主链。 */
export const verifyPickupCredential = (
  data: PickupCredentialPayload,
): Promise<{ orderId: string; status: 'PICKED_UP'; pickedUpAt: string; alreadyPickedUp: boolean }> =>
  client.post('/admin/pickup/verify', data);
