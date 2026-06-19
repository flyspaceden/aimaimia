import client from './client';
import type { TraceBatch, PaginatedData, PaginationParams } from '@/types';

interface TraceQueryParams extends PaginationParams {
  companyId?: string;
}

/** 溯源批次列表 */
export const getTraceBatches = (params?: TraceQueryParams): Promise<PaginatedData<TraceBatch>> =>
  client.get('/delivery-admin/trace', { params });

/** 溯源批次详情 */
export const getTraceBatch = (id: string): Promise<TraceBatch> =>
  client.get(`/delivery-admin/trace/${id}`);

/** 创建溯源批次 */
export const createTraceBatch = (data: {
  companyId: string;
  batchCode: string;
  meta?: Record<string, unknown>;
}): Promise<TraceBatch> =>
  client.post('/delivery-admin/trace', data);

/** 更新溯源批次 */
export const updateTraceBatch = (id: string, data: {
  batchCode?: string;
  meta?: Record<string, unknown>;
}): Promise<TraceBatch> =>
  client.put(`/delivery-admin/trace/${id}`, data);

/** 删除溯源批次 */
export const deleteTraceBatch = (id: string): Promise<void> =>
  client.delete(`/delivery-admin/trace/${id}`);
