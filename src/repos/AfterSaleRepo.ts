/**
 * 统一售后仓储（Repo）— 买家端
 *
 * 后端接口：
 * - POST /api/v1/after-sale/orders/:orderId → AfterSaleRequest（申请售后）
 * - GET  /api/v1/after-sale → PaginationResult<AfterSaleRequest>（我的售后列表）
 * - GET  /api/v1/after-sale/:id → AfterSaleRequest（售后详情）
 * - POST /api/v1/after-sale/:id/cancel → AfterSaleRequest（撤销申请）
 * - POST /api/v1/after-sale/:id/return-shipping → AfterSaleRequest（填写退货物流）
 * - POST /api/v1/after-sale/:id/confirm → AfterSaleRequest（确认收货/完成）
 * - POST /api/v1/after-sale/:id/escalate → AfterSaleRequest（升级平台仲裁）
 * - POST /api/v1/after-sale/:id/accept-close → AfterSaleRequest（接受关闭）
 * - GET  /api/v1/after-sale/return-policy → ReturnPolicy（退货政策）
 * - POST /api/v1/after-sale/agree-policy → void（同意退货政策）
 */
import { Result, PaginationResult } from '../types';
import { AfterSaleRequest } from '../types/domain/Order';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { normalizePagination } from './http/pagination';

// ─── 申请售后 DTO ────────────────────────────────────

export interface ApplyAfterSaleDto {
  orderItemId: string;
  afterSaleType: 'NO_REASON_RETURN' | 'QUALITY_RETURN' | 'QUALITY_EXCHANGE';
  reasonType?: string;
  reason?: string;
  photos?: string[];
}

// ─── 填写退货物流 DTO ────────────────────────────────

export interface FillReturnShippingDto {
  carrierName: string;
  waybillNo: string;
}

// ─── 退货政策 ────────────────────────────────────────

export interface ReturnPolicy {
  noReasonReturnDays: number;
  qualityReturnDays: number;
  qualityExchangeDays: number;
  policyText?: string;
}

// ─── Mock 数据 ───────────────────────────────────────

const mockAfterSale: AfterSaleRequest = {
  id: 'as-1',
  orderId: 'o-1',
  orderItemId: 'oi-1',
  afterSaleType: 'QUALITY_RETURN',
  reason: '商品有质量问题',
  photos: [],
  status: 'REQUESTED',
  requiresReturn: true,
  isPostReplacement: false,
  refundAmount: 99.0,
  createdAt: '2026-03-28',
  updatedAt: '2026-03-28',
};

export const AfterSaleRepo = {
  /** 申请售后 */
  apply: async (orderId: string, dto: ApplyAfterSaleDto): Promise<Result<AfterSaleRequest>> => {
    if (USE_MOCK) {
      return simulateRequest({
        ...mockAfterSale,
        orderId,
        orderItemId: dto.orderItemId,
        afterSaleType: dto.afterSaleType,
        reason: dto.reason,
        photos: dto.photos ?? [],
      });
    }
    return ApiClient.post<AfterSaleRequest>(`/after-sale/orders/${orderId}`, dto);
  },

  /** 我的售后记录列表 */
  list: async (page = 1, pageSize = 20): Promise<Result<PaginationResult<AfterSaleRequest>>> => {
    if (USE_MOCK) {
      return simulateRequest({
        items: [mockAfterSale],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    }
    const r = await ApiClient.get<{ items: AfterSaleRequest[]; total: number; page: number; pageSize: number }>(
      '/after-sale',
      { page, pageSize },
    );
    if (!r.ok) return r;
    return { ok: true as const, data: normalizePagination(r.data) };
  },

  /** 售后详情 */
  getById: async (id: string): Promise<Result<AfterSaleRequest>> => {
    if (USE_MOCK) {
      return simulateRequest({ ...mockAfterSale, id });
    }
    return ApiClient.get<AfterSaleRequest>(`/after-sale/${id}`);
  },

  /** 撤销售后申请 */
  cancel: async (id: string): Promise<Result<AfterSaleRequest>> => {
    if (USE_MOCK) {
      return simulateRequest({ ...mockAfterSale, id, status: 'CANCELED' as const });
    }
    return ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/cancel`);
  },

  /** 填写退货物流信息 */
  fillReturnShipping: async (id: string, dto: FillReturnShippingDto): Promise<Result<AfterSaleRequest>> => {
    if (USE_MOCK) {
      return simulateRequest({
        ...mockAfterSale,
        id,
        status: 'RETURN_SHIPPING' as const,
        returnCarrierName: dto.carrierName,
        returnWaybillNo: dto.waybillNo,
        returnShippedAt: new Date().toISOString(),
      });
    }
    return ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/return-shipping`, dto);
  },

  /** 确认收货（换货场景） */
  confirmReceive: async (id: string): Promise<Result<AfterSaleRequest>> => {
    if (USE_MOCK) {
      return simulateRequest({ ...mockAfterSale, id, status: 'COMPLETED' as const });
    }
    return ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/confirm`);
  },

  /** 升级平台仲裁 */
  escalate: async (id: string): Promise<Result<AfterSaleRequest>> => {
    if (USE_MOCK) {
      return simulateRequest({ ...mockAfterSale, id, status: 'PENDING_ARBITRATION' as const });
    }
    return ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/escalate`);
  },

  /** 接受关闭（卖家驳回后买家接受） */
  acceptClose: async (id: string): Promise<Result<AfterSaleRequest>> => {
    if (USE_MOCK) {
      return simulateRequest({ ...mockAfterSale, id, status: 'CLOSED' as const });
    }
    return ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/accept-close`);
  },

  /** 获取退货政策配置 */
  getReturnPolicy: async (): Promise<Result<ReturnPolicy>> => {
    if (USE_MOCK) {
      return simulateRequest({
        noReasonReturnDays: 7,
        qualityReturnDays: 15,
        qualityExchangeDays: 15,
        policyText: '自签收之日起7天内支持无理由退货，15天内支持质量问题退换货。',
      });
    }
    return ApiClient.get<ReturnPolicy>('/after-sale/return-policy');
  },

  /** 同意退货政策（首次申请前需确认） */
  agreePolicy: async (): Promise<Result<void>> => {
    if (USE_MOCK) {
      return simulateRequest(undefined as unknown as void);
    }
    return ApiClient.post<void>('/after-sale/agree-policy');
  },
};
