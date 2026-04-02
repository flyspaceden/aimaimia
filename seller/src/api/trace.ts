import client from './client';
import type { PaginatedData, QueryParams } from '@/types';

export interface TraceBatch {
  id: string;
  companyId: string;
  batchCode: string;
  meta?: Record<string, string>;
  createdAt: string;
  _count?: { events: number; productTraceLinks: number };
  events?: TraceEvent[];
  productTraceLinks?: Array<{ product: { id: string; title: string } }>;
}

export interface TraceEvent {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  occurredAt: string;
}

export const getTraceBatches = (params?: QueryParams): Promise<PaginatedData<TraceBatch>> =>
  client.get('/seller/trace', { params });

export const getTraceBatch = (id: string): Promise<TraceBatch> =>
  client.get(`/seller/trace/${id}`);

export const createTraceBatch = (data: { batchCode: string; meta?: Record<string, string> }): Promise<TraceBatch> =>
  client.post('/seller/trace', data);

export const updateTraceBatch = (id: string, data: { batchCode?: string; meta?: Record<string, string> }): Promise<TraceBatch> =>
  client.put(`/seller/trace/${id}`, data);

export const deleteTraceBatch = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/seller/trace/${id}`);
