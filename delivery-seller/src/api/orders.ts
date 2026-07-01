import client from './client';
import type { Order, PaginatedData, PickupBatch, QueryParams } from '@/types';

export const getOrders = (params?: QueryParams): Promise<PaginatedData<Order>> =>
  client.get('/delivery-seller/orders', { params });

export const getOrder = (id: string): Promise<Order> =>
  client.get(`/delivery-seller/orders/${id}`);

export const shipOrder = (id: string): Promise<{ ok: boolean }> =>
  client.post(`/delivery-seller/orders/${id}/ship`, {});

export const getPickupBatches = (params?: QueryParams): Promise<PaginatedData<PickupBatch>> =>
  client.get('/delivery-seller/pickup-batches', { params });

export const getPickupBatch = (id: string): Promise<PickupBatch> =>
  client.get(`/delivery-seller/pickup-batches/${id}`);

export const markPickupBatchReady = (id: string): Promise<PickupBatch> =>
  client.post(`/delivery-seller/pickup-batches/${id}/mark-ready`, {});

export const markPickupBatchLoaded = (id: string): Promise<PickupBatch> =>
  client.post(`/delivery-seller/pickup-batches/${id}/mark-loaded`, {});

export const reportPickupBatchException = (id: string, message: string): Promise<PickupBatch> =>
  client.post(`/delivery-seller/pickup-batches/${id}/report-exception`, { message });
