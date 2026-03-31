import client from './client';
import type { PaginatedData, QueryParams, WaybillResult } from '@/types';

// 售后申请类型
export interface AfterSale {
  id: string;
  orderId: string;
  orderItemId?: string | null;
  afterSaleType: 'NO_REASON_RETURN' | 'QUALITY_RETURN' | 'QUALITY_EXCHANGE';
  reasonType?: string;
  reason?: string;
  photos: string[];
  status: string;
  requiresReturn: boolean;
  refundAmount?: number | null;
  reviewNote?: string;
  reviewerId?: string;
  reviewedAt?: string;
  approvedAt?: string;
  sellerReceivedAt?: string;
  // 卖家拒收信息
  sellerRejectReason?: string;
  sellerRejectPhotos?: string[];
  sellerReturnWaybillNo?: string;
  // 退货物流
  returnCarrierName?: string;
  returnWaybillNo?: string;
  returnShippedAt?: string;
  // 换货物流
  replacementCarrierName?: string;
  replacementWaybillNo?: string;
  replacementWaybillPrintUrl?: string;
  replacementShipmentId?: string;
  createdAt: string;
  buyerAlias: string;
  order?: {
    id: string;
    status: string;
    totalAmount: number;
  } | null;
  orderItem?: {
    id: string;
    productSnapshot: any;
    quantity: number;
    unitPrice: number;
  } | null;
}

/** 售后列表 */
export const getAfterSales = (params?: QueryParams): Promise<PaginatedData<AfterSale>> =>
  client.get('/seller/after-sale', { params });

/** 按状态统计 */
export const getAfterSaleStats = (): Promise<Record<string, number>> =>
  client.get('/seller/after-sale/stats');

/** 售后详情 */
export const getAfterSale = (id: string): Promise<AfterSale> =>
  client.get(`/seller/after-sale/${id}`);

/** 开始审核 */
export const reviewAfterSale = (id: string): Promise<AfterSale> =>
  client.post(`/seller/after-sale/${id}/review`);

/** 审核通过 */
export const approveAfterSale = (id: string, note?: string): Promise<AfterSale> =>
  client.post(`/seller/after-sale/${id}/approve`, { note });

/** 驳回 */
export const rejectAfterSale = (id: string, reason: string): Promise<AfterSale> =>
  client.post(`/seller/after-sale/${id}/reject`, { reason });

/** 确认收到退货 */
export const confirmReceiveReturn = (id: string): Promise<AfterSale> =>
  client.post(`/seller/after-sale/${id}/receive`);

/** 拒收退货（验收不合格） */
export const rejectReturn = (
  id: string,
  data: { reason: string; photos: string[]; returnWaybillNo: string },
): Promise<AfterSale> =>
  client.post(`/seller/after-sale/${id}/reject-return`, data);

/** 换货发货 */
export const shipAfterSale = (id: string): Promise<AfterSale> =>
  client.post(`/seller/after-sale/${id}/ship`);

/** 生成换货电子面单 */
export const generateAfterSaleWaybill = (id: string, carrierCode: string): Promise<WaybillResult> =>
  client.post(`/seller/after-sale/${id}/waybill`, { carrierCode });

/** 取消换货电子面单 */
export const cancelAfterSaleWaybill = (id: string): Promise<{ ok: boolean }> =>
  client.delete(`/seller/after-sale/${id}/waybill`);
