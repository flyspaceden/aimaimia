import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

interface ReplacementQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
  companyId?: string;
}

export interface AdminReplacement {
  id: string;
  orderId: string;
  orderItemId?: string;
  reasonType?: string;
  reason: string;
  photos: string[];
  status: string;
  /** 审核人（卖家staff或管理员ID） */
  reviewerId?: string;
  /** 卖家/管理员审核意见 */
  reviewNote?: string;
  /** 审核时间 */
  reviewedAt?: string;
  /** 换货物流单号 */
  replacementShipmentId?: string;
  createdAt: string;
  updatedAt: string;
  /** 公司信息（后端从 orderItem → sku → product → company 提取） */
  company?: { id: string; name: string } | null;
  /** 换货金额（后端计算：unitPrice × quantity） */
  amount?: number;
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
    /** 订单商品项（获取companyId） */
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
    profile?: { nickname?: string };
    authIdentities?: { identifier: string }[];
  };
}

export type ReplacementStatsMap = Record<string, number>;

export const getReplacements = (params?: ReplacementQueryParams): Promise<PaginatedData<AdminReplacement>> =>
  client.get('/admin/replacements', { params });

export const getReplacementStats = (): Promise<ReplacementStatsMap> =>
  client.get('/admin/replacements/stats');

export const getReplacement = (id: string): Promise<AdminReplacement> =>
  client.get(`/admin/replacements/${id}`);

export const arbitrateReplacement = (
  id: string,
  data: { status: 'APPROVED' | 'REJECTED'; reason?: string },
): Promise<AdminReplacement> =>
  client.post(`/admin/replacements/${id}/arbitrate`, data);
