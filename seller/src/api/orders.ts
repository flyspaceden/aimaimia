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

export interface MarkPickupReadyResult {
  orderId: string;
  status: 'READY';
  readyAt: string;
  alreadyReady: boolean;
}

/** 将自提订单从备货中推进为待自提。后端使用来源状态校验并保证幂等。 */
export const markPickupReady = (orderId: string): Promise<MarkPickupReadyResult> =>
  client.post(`/seller/orders/${orderId}/pickup/ready`, {});

export type VerifyPickupPayload =
  | { pickupCode: string; qrPayload?: never }
  | { pickupCode?: never; qrPayload: string };

export interface VerifyPickupResult {
  orderId: string;
  status: 'PICKED_UP';
  pickedUpAt: string;
  alreadyPickedUp: boolean;
}

/** 核销一次性取货凭证；短码与二维码内容二选一。 */
export const verifyPickup = (
  orderId: string,
  data: VerifyPickupPayload,
): Promise<VerifyPickupResult> =>
  client.post(`/seller/orders/${orderId}/pickup/verify`, data);
