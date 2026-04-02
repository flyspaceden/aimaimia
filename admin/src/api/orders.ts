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

/** 发货 */
export const shipOrder = (id: string, data: {
  carrierCode: string;
  carrierName: string;
  trackingNo: string;
}): Promise<{ ok: boolean }> =>
  client.post(`/admin/orders/${id}/ship`, data);

/** 取消订单 */
export const cancelOrder = (id: string, reason: string): Promise<{ ok: boolean }> =>
  client.post(`/admin/orders/${id}/cancel`, { reason });
