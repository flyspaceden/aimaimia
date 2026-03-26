import client from './client';
import type { Company, CompanyStaff, PaginatedData, PaginationParams, AiSearchProfile } from '@/types';

interface CompanyQueryParams extends PaginationParams {
  status?: string;
  keyword?: string;
}

/** 企业列表 */
export const getCompanies = (params?: CompanyQueryParams): Promise<PaginatedData<Company>> =>
  client.get('/admin/companies', { params });

/** 企业详情 */
export const getCompany = (id: string): Promise<Company> =>
  client.get(`/admin/companies/${id}`);

/** 更新企业 */
export const updateCompany = (id: string, data: {
  name?: string;
  shortName?: string;
  description?: string;
  servicePhone?: string;
  serviceWeChat?: string;
  address?: Record<string, any>;
  status?: string;
}): Promise<Company> =>
  client.put(`/admin/companies/${id}`, data);

/** 企业审核 */
export const auditCompany = (id: string, data: {
  status: 'APPROVED' | 'REJECTED';
  note?: string;
}): Promise<Company> =>
  client.post(`/admin/companies/${id}/audit`, data);

/** 获取企业亮点 */
export const getCompanyHighlights = (companyId: string): Promise<Record<string, string>> =>
  client.get(`/admin/companies/${companyId}/highlights`);

/** 更新企业亮点 */
export const updateCompanyHighlights = (companyId: string, highlights: Record<string, string>): Promise<void> =>
  client.put(`/admin/companies/${companyId}/highlights`, { highlights });

/** 审核资质文件 */
export const verifyDocument = (companyId: string, docId: string, data: {
  verifyStatus: 'VERIFIED' | 'REJECTED';
  verifyNote?: string;
}): Promise<void> =>
  client.post(`/admin/companies/${companyId}/documents/${docId}/verify`, data);

/** 企业员工列表 */
export const getCompanyStaff = (companyId: string): Promise<CompanyStaff[]> =>
  client.get(`/admin/companies/${companyId}/staff`);

/** 绑定企业创始人 */
export const bindCompanyOwner = (companyId: string, phone: string): Promise<CompanyStaff> =>
  client.post(`/admin/companies/${companyId}/bind-owner`, { phone });

/** 获取企业 AI 搜索资料 */
export const getCompanyAiSearchProfile = (companyId: string): Promise<AiSearchProfile> =>
  client.get(`/admin/companies/${companyId}/ai-search-profile`);

/** 更新企业 AI 搜索资料 */
export const updateCompanyAiSearchProfile = (companyId: string, data: AiSearchProfile): Promise<AiSearchProfile> =>
  client.put(`/admin/companies/${companyId}/ai-search-profile`, data);

/** 添加企业 */
export const createCompany = (data: {
  companyName: string;
  contactName: string;
  phone: string;
  category: string;
  description?: string;
}): Promise<{ companyId: string; staffId: string }> =>
  client.post('/admin/companies', data);
