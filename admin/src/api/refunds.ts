import client from './client';
import type { Refund, PaginatedData, PaginationParams } from '@/types';

interface RefundQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
}

/** 退款列表 */
export const getRefunds = (params?: RefundQueryParams): Promise<PaginatedData<Refund>> =>
  client.get('/admin/refunds', { params });

/** 退款详情 */
export const getRefund = (id: string): Promise<Refund> =>
  client.get(`/admin/refunds/${id}`);

/** 仲裁退款（强制同意/拒绝） */
export const arbitrateRefund = (id: string, data: {
  status: 'APPROVED' | 'REJECTED';
  reason?: string;
}): Promise<{ ok: boolean }> =>
  client.post(`/admin/refunds/${id}/arbitrate`, data);
