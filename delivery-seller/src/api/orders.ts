import client from './client';
import type { Order, PaginatedData, QueryParams } from '@/types';

export const getOrders = (params?: QueryParams): Promise<PaginatedData<Order>> =>
  client.get('/delivery-seller/orders', { params });

export const getOrder = (id: string): Promise<Order> =>
  client.get(`/delivery-seller/orders/${id}`);

export const shipOrder = (id: string): Promise<{ ok: boolean }> =>
  client.post(`/delivery-seller/orders/${id}/ship`, {});
