/**
 * 统一售后仓储（Repo）— 买家端
 *
 * 后端接口：
 * - POST /api/v1/after-sale/orders/:orderId → AfterSaleRequest（申请售后）
 * - GET  /api/v1/after-sale → PaginationResult<AfterSaleRequest>（我的售后列表）
 * - GET  /api/v1/after-sale/:id → AfterSaleRequest（售后详情）
 * - GET  /api/v1/after-sale/orders/:orderId/eligibility → AfterSaleEligibilityResponse（售后资格）
 * - POST /api/v1/after-sale/:id/cancel → AfterSaleRequest（撤销申请）
 * - POST /api/v1/after-sale/:id/return-shipping → AfterSaleRequest（填写退货物流）
 * - POST /api/v1/after-sale/:id/return-shipping-payment → AfterSaleShippingPayment（退货运费支付）
 * - POST /api/v1/after-sale/:id/return-waybill → AfterSaleRequest（生成退货面单）
 * - POST /api/v1/after-sale/:id/confirm → AfterSaleRequest（确认收货/完成）
 * - POST /api/v1/after-sale/:id/escalate → AfterSaleRequest（升级平台仲裁）
 * - POST /api/v1/after-sale/:id/accept-close → AfterSaleRequest（接受关闭）
 * - GET  /api/v1/after-sale/:id/timeline → AfterSaleTimelineResponse（售后状态时间线）
 * - GET  /api/v1/after-sale/return-policy → ReturnPolicy（退货政策）
 * - POST /api/v1/after-sale/agree-policy → void（同意退货政策）
 */
import { Result, PaginationResult } from '../types';
import {
  AfterSaleDetailStatus,
  AfterSaleRequest,
  AfterSaleType,
  ReturnShippingPayer,
  ReturnShippingPaymentStatus,
} from '../types/domain/Order';
import { ApiClient } from './http/ApiClient';
import { simulateRequest } from './helpers';
import { USE_MOCK } from './http/config';
import { normalizePagination } from './http/pagination';

// ─── 申请售后 DTO ────────────────────────────────────

export interface ApplyAfterSaleDto {
  orderItemId: string;
  afterSaleType: AfterSaleType;
  reasonType?: string;
  reason?: string;
  photos?: string[];
}

// ─── 填写退货物流 DTO ────────────────────────────────

export interface FillReturnShippingDto {
  returnCarrierName: string;
  returnWaybillNo: string;
}

// ─── 退货政策 ────────────────────────────────────────

export interface ReturnPolicy {
  noReasonReturnDays: number;
  qualityReturnDays: number;
  qualityExchangeDays: number;
  policyText?: string;
}

export interface AfterSaleEligibilityOption {
  afterSaleType: AfterSaleType;
  enabled: boolean;
  disabledReason?: string | null;
  deadlineAt?: string | null;
  requiresReturn: boolean;
  returnShippingPayer?: ReturnShippingPayer;
  estimatedRefundAmount?: number | null;
  estimatedReturnShippingFee?: number | null;
  requiresBuyerShippingPayment?: boolean;
}

export interface AfterSaleEligibilityItem {
  orderItemId: string;
  skuId?: string;
  productId?: string;
  productTitle: string;
  productSnapshot?: any;
  quantity: number;
  unitPrice: number;
  itemAmount: number;
  returnPolicy?: unknown;
  options: AfterSaleEligibilityOption[];
}

export interface AfterSaleEligibilityResponse {
  orderId: string;
  orderStatus: string;
  eligible: boolean;
  disabledReason?: string | null;
  items: AfterSaleEligibilityItem[];
}

export interface AfterSaleShippingPayment {
  id: string;
  afterSaleId: string;
  merchantPaymentNo: string;
  amount: number;
  status: Exclude<ReturnShippingPaymentStatus, 'NOT_REQUIRED'>;
  paymentParams?: {
    channel?: 'alipay' | 'wechat';
    orderStr?: string;
    appId?: string;
    partnerId?: string;
    timestamp?: string;
    nonceStr?: string;
    prepayId?: string;
    packageVal?: string;
    signType?: string;
    paySign?: string;
  };
}

export interface AfterSaleReturnWaybillResult {
  ok: boolean;
  carrierCode: string;
  carrierName: string;
  waybillNo: string;
  waybillUrl?: string | null;
  returnLabelUrl?: string | null;
}

export interface AfterSaleTimelineItem {
  id: string;
  fromStatus?: AfterSaleDetailStatus | null;
  toStatus: AfterSaleDetailStatus;
  reason?: string | null;
  operatorType?: string | null;
  createdAt: string;
}

export interface AfterSaleTimelineResponse {
  items: AfterSaleTimelineItem[];
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

  /** 查询订单售后资格 */
  getEligibility: async (orderId: string): Promise<Result<AfterSaleEligibilityResponse>> => {
    if (USE_MOCK) {
      return simulateRequest({
        orderId,
        orderStatus: 'RECEIVED',
        eligible: true,
        disabledReason: null,
        items: [
          {
            orderItemId: mockAfterSale.orderItemId,
            productTitle: 'Mock 商品',
            quantity: 1,
            unitPrice: 99,
            itemAmount: 99,
            options: [
              {
                afterSaleType: 'NO_REASON_RETURN',
                enabled: true,
                disabledReason: null,
                requiresReturn: true,
                returnShippingPayer: 'BUYER',
                estimatedRefundAmount: 99,
                estimatedReturnShippingFee: 10,
                requiresBuyerShippingPayment: false,
              },
              {
                afterSaleType: 'QUALITY_RETURN',
                enabled: true,
                disabledReason: null,
                requiresReturn: true,
                returnShippingPayer: 'SELLER',
                estimatedRefundAmount: 99,
                estimatedReturnShippingFee: 0,
                requiresBuyerShippingPayment: false,
              },
              {
                afterSaleType: 'QUALITY_EXCHANGE',
                enabled: true,
                disabledReason: null,
                requiresReturn: true,
                returnShippingPayer: 'SELLER',
                estimatedRefundAmount: null,
                estimatedReturnShippingFee: 0,
                requiresBuyerShippingPayment: false,
              },
            ],
          },
        ],
      });
    }
    return ApiClient.get<AfterSaleEligibilityResponse>(`/after-sale/orders/${orderId}/eligibility`);
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
        returnCarrierName: dto.returnCarrierName,
        returnWaybillNo: dto.returnWaybillNo,
        returnShippedAt: new Date().toISOString(),
      });
    }
    return ApiClient.post<AfterSaleRequest>(`/after-sale/${id}/return-shipping`, dto);
  },

  /** 发起买家退货运费支付 */
  createReturnShippingPayment: async (id: string): Promise<Result<AfterSaleShippingPayment>> => {
    if (USE_MOCK) {
      return simulateRequest({
        id: `asp-${id}`,
        afterSaleId: id,
        merchantPaymentNo: `AS_SHIP_PAY_${id}`,
        amount: 10,
        status: 'UNPAID' as const,
        paymentParams: { channel: 'alipay', orderStr: 'mock-return-shipping-order-str' },
      });
    }
    return ApiClient.post<AfterSaleShippingPayment>(`/after-sale/${id}/return-shipping-payment`);
  },

  /** 生成买家退货顺丰面单 */
  createReturnWaybill: async (id: string): Promise<Result<AfterSaleReturnWaybillResult>> => {
    if (USE_MOCK) {
      return simulateRequest({
        ok: true,
        carrierCode: 'SF',
        returnCarrierName: '顺丰速运',
        carrierName: '顺丰速运',
        waybillNo: `SF${Date.now()}`,
        waybillUrl: null,
        returnLabelUrl: null,
      });
    }
    return ApiClient.post<AfterSaleReturnWaybillResult>(`/after-sale/${id}/return-waybill`);
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

  /** 售后状态时间线 */
  getTimeline: async (id: string): Promise<Result<AfterSaleTimelineResponse>> => {
    if (USE_MOCK) {
      return simulateRequest({
        items: [
          {
            id: `timeline-${id}`,
            fromStatus: null,
            toStatus: 'REQUESTED' as const,
            reason: '提交售后申请',
            operatorType: 'BUYER',
            createdAt: mockAfterSale.createdAt,
          },
        ],
      });
    }
    return ApiClient.get<AfterSaleTimelineResponse>(`/after-sale/${id}/timeline`);
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
