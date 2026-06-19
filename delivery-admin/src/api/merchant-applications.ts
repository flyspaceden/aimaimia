import client from './client';
import type { PaginatedData, PaginationParams } from '@/types';

export interface MerchantApplication {
  id: string;
  companyName: string;
  category: string;
  contactName: string;
  phone: string;
  email: string | null;
  licenseFileUrl: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantApplicationDetail extends MerchantApplication {
  history: MerchantApplication[];
}

interface ApplicationQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
}

/** 入驻申请列表 */
export const getMerchantApplications = (params?: ApplicationQueryParams): Promise<PaginatedData<MerchantApplication>> =>
  client.get('/admin/merchant-applications', { params });

/** 入驻申请详情 */
export const getMerchantApplication = (id: string): Promise<MerchantApplicationDetail> =>
  client.get(`/admin/merchant-applications/${id}`);

/** 审核通过 */
export const approveMerchantApplication = (id: string): Promise<{ companyId: string; staffId: string }> =>
  client.post(`/admin/merchant-applications/${id}/approve`);

/** 审核拒绝 */
export const rejectMerchantApplication = (id: string, reason: string): Promise<void> =>
  client.post(`/admin/merchant-applications/${id}/reject`, { reason });

/** 待审核数量 */
export const getMerchantApplicationPendingCount = (): Promise<number> =>
  client.get('/admin/merchant-applications/pending-count');
