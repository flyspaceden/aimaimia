import client from './client';
import type { Refund, PaginatedData, QueryParams } from '@/types';

export const getRefunds = (params?: QueryParams): Promise<PaginatedData<Refund>> =>
  client.get('/seller/refunds', { params });

export const getRefund = (id: string): Promise<Refund> =>
  client.get(`/seller/refunds/${id}`);
