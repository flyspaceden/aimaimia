import client from './client';
import type { Order, PaginatedData, QueryParams, WaybillResult, VirtualCallResult } from '@/types';

export const getOrders = (params?: QueryParams): Promise<PaginatedData<Order>> =>
  client.get('/seller/orders', { params });

export const getOrder = (id: string): Promise<Order> =>
  client.get(`/seller/orders/${id}`);

export const shipOrder = (id: string): Promise<{ ok: boolean }> =>
  client.post(`/seller/orders/${id}/ship`, {});

export const batchShipOrders = (items: Array<{ orderId: string }>): Promise<{ results: Array<{ orderId: string; success: boolean; error?: string }> }> =>
  client.post('/seller/orders/batch-ship', { items });

/** 生成电子面单 */
export const generateWaybill = (orderId: string, carrierCode: string): Promise<WaybillResult> =>
  client.post(`/seller/orders/${orderId}/waybill`, { carrierCode });

/** 批量生成电子面单 */
export const batchGenerateWaybill = (items: Array<{ orderId: string; carrierCode: string }>): Promise<{ results: Array<{ orderId: string; success: boolean; waybillNo?: string; error?: string }> }> =>
  client.post('/seller/orders/batch-waybill', { items });

/** 取消面单 */
export const cancelWaybill = (orderId: string): Promise<{ ok: boolean }> =>
  client.delete(`/seller/orders/${orderId}/waybill`);

/** 绑定虚拟号 */
export const bindVirtualCall = (orderId: string): Promise<VirtualCallResult> =>
  client.post(`/seller/orders/${orderId}/virtual-call`);
