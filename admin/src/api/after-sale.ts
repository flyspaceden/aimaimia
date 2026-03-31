import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

interface AfterSaleQueryParams extends PaginationParams {
  status?: string;
  afterSaleType?: string;
  companyId?: string;
  keyword?: string;
}

export interface AdminAfterSale {
  id: string;
  orderId: string;
  orderItemId?: string;
  afterSaleType: string;
  reasonType?: string;
  reason: string;
  photos: string[];
  status: string;
  isPostReplacement: boolean;
  requiresReturn: boolean;
  arbitrationSource?: string;
  refundAmount?: number;
  refundId?: string;
  /** 审核人（卖家staff或管理员ID） */
  reviewerId?: string;
  /** 卖家/管理员审核意见 */
  reviewNote?: string;
  /** 审核时间 */
  reviewedAt?: string;
  approvedAt?: string;
  /** 买家退货物流 */
  returnWaybillNo?: string;
  /** 换货物流单号 */
  replacementWaybillNo?: string;
  replacementShipmentId?: string;
  createdAt: string;
  updatedAt: string;
  /** 公司信息（后端从 orderItem → sku → product → company 提取） */
  company?: { id: string; name: string } | null;
  order?: {
    id: string;
    status: string;
    totalAmount: number;
    /** 下单时地址快照 */
    addressSnapshot?: {
      receiverName?: string;
      receiverPhone?: string;
      province?: string;
      city?: string;
      district?: string;
      detail?: string;
      [key: string]: unknown;
    } | null;
    /** 订单商品项 */
    items?: { id: string; companyId?: string }[];
  };
  orderItem?: {
    id: string;
    productSnapshot: Record<string, unknown>;
    quantity: number;
    unitPrice?: number;
    companyId?: string;
  };
  user?: {
    id: string;
    nickname?: string;
    phone?: string;
  };
}

/** 售后状态统计 */
export interface AfterSaleStatsResponse {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

/** 售后列表 */
export const getAfterSales = (params?: AfterSaleQueryParams): Promise<PaginatedData<AdminAfterSale>> =>
  client.get('/admin/after-sale', { params });

/** 售后状态统计 */
export const getAfterSaleStats = (): Promise<AfterSaleStatsResponse> =>
  client.get('/admin/after-sale/stats');

/** 售后详情 */
export const getAfterSale = (id: string): Promise<AdminAfterSale> =>
  client.get(`/admin/after-sale/${id}`);

/** 管理员仲裁 */
export const arbitrateAfterSale = (
  id: string,
  data: { status: 'APPROVED' | 'REJECTED'; reason?: string },
): Promise<AdminAfterSale> =>
  client.post(`/admin/after-sale/${id}/arbitrate`, data);
