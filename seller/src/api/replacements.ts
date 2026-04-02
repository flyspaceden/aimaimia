import client from './client';
import type { PaginatedData, QueryParams, VirtualCallResult, WaybillResult } from '@/types';

// 换货申请类型
export interface Replacement {
  id: string;
  orderId: string;
  status: 'REQUESTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SHIPPED' | 'COMPLETED';
  reasonType?: string;
  reason?: string; // 仅 OTHER 类型时有内容
  photos: string[];
  buyerAlias: string;
  createdAt: string;
  reviewNote?: string;
  reviewerId?: string;
  reviewedAt?: string;
  replacementCarrierName?: string;
  replacementWaybillNo?: string;
  replacementWaybillPrintUrl?: string;
  replacementShipmentId?: string;
  order?: {
    id: string;
    totalAmount: number;
  };
  orderItem?: {
    id: string;
    unitPrice: number;
    quantity: number;
  };
}

/** 换货列表 */
export const getReplacements = (params?: QueryParams): Promise<PaginatedData<Replacement>> =>
  client.get('/seller/replacements', { params });

/** 换货详情 */
export const getReplacement = (id: string): Promise<Replacement> =>
  client.get(`/seller/replacements/${id}`);

/** 审核通过 */
export const approveReplacement = (id: string, note?: string): Promise<Replacement> =>
  client.post(`/seller/replacements/${id}/approve`, { note });

/** 开始审核 */
export const reviewReplacement = (id: string, note?: string): Promise<Replacement> =>
  client.post(`/seller/replacements/${id}/review`, { note });

/** 驳回 */
export const rejectReplacement = (id: string, reason: string): Promise<Replacement> =>
  client.post(`/seller/replacements/${id}/reject`, { reason });

/** 发货 */
export const shipReplacement = (id: string): Promise<Replacement> =>
  client.post(`/seller/replacements/${id}/ship`, {});

/** 生成换货电子面单 */
export const generateReplacementWaybill = (id: string, carrierCode: string): Promise<WaybillResult> =>
  client.post(`/seller/replacements/${id}/waybill`, { carrierCode });

/** 取消换货电子面单 */
export const cancelReplacementWaybill = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/seller/replacements/${id}/waybill`);

/** 绑定虚拟号（换货） */
export const bindVirtualCallForReplacement = (replacementId: string): Promise<VirtualCallResult> =>
  client.post(`/seller/replacements/${replacementId}/virtual-call`);
