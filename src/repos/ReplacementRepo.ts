/**
 * 换货仓储（Repo）— 买家端
 *
 * 后端接口：
 * - GET /api/v1/replacements → PaginationResult<Replacement>
 * - GET /api/v1/replacements/:id → Replacement
 * - POST /api/v1/replacements/:id/confirm → Replacement
 */
import { Result, PaginationResult } from '../types';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { normalizePagination } from './http/pagination';

export interface Replacement {
  id: string;
  orderId: string;
  orderItemId?: string;
  reason: string;
  photos: string[];
  status: 'REQUESTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SHIPPED' | 'COMPLETED';
  note?: string;
  rejectReason?: string;
  shipmentId?: string;
  createdAt: string;
  updatedAt: string;
}

export const ReplacementRepo = {
  /** 我的换货记录列表 */
  list: async (page = 1, pageSize = 20): Promise<Result<PaginationResult<Replacement>>> => {
    if (USE_MOCK) {
      return simulateRequest({
        items: [
          {
            id: 'rep-1',
            orderId: 'o-1',
            reason: '商品破损',
            photos: [],
            status: 'REQUESTED' as const,
            createdAt: '2026-02-25',
            updatedAt: '2026-02-25',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    }
    const r = await ApiClient.get<{ items: Replacement[]; total: number; page: number; pageSize: number }>(
      '/replacements',
      { page, pageSize },
    );
    if (!r.ok) return r;
    return { ok: true as const, data: normalizePagination(r.data) };
  },

  /** 换货详情 */
  getById: async (id: string): Promise<Result<Replacement>> => {
    if (USE_MOCK) {
      return simulateRequest({
        id,
        orderId: 'o-1',
        reason: '商品破损',
        photos: [],
        status: 'REQUESTED' as const,
        createdAt: '2026-02-25',
        updatedAt: '2026-02-25',
      });
    }
    return ApiClient.get<Replacement>(`/replacements/${id}`);
  },

  /** 确认收到换货商品 */
  confirm: async (id: string): Promise<Result<Replacement>> => {
    if (USE_MOCK) {
      return simulateRequest({
        id,
        orderId: 'o-1',
        reason: '商品破损',
        photos: [],
        status: 'COMPLETED' as const,
        createdAt: '2026-02-25',
        updatedAt: new Date().toISOString(),
      });
    }
    return ApiClient.post<Replacement>(`/replacements/${id}/confirm`);
  },
};
