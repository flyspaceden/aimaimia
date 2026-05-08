import client from './client';
import type { Order, OrderQueryParams, OrderStatsMap, PaginatedData } from '@/types';

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

/** 取消订单 */
export const cancelOrder = (id: string, reason: string): Promise<{ ok: boolean }> =>
  client.post(`/admin/orders/${id}/cancel`, { reason });

/** 手动重试退款 */
export const retryRefund = (
  orderId: string,
  refundId: string,
): Promise<{ ok: boolean; message?: string }> =>
  client.post(`/admin/orders/${orderId}/refunds/${refundId}/retry`);
